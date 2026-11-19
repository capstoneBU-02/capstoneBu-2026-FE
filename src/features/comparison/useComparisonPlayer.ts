import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SourceSwitch } from '../player/PlayerBar.tsx'
import {
  useSectionPlayer,
  type SectionPlayback,
} from '../player/useSectionPlayer.ts'
import type { AudioTimeOf, WaveformPeaks } from '../waveform/peaks.ts'
import type { SongAudio } from '../waveform/useSongAudio.ts'
import {
  alternateTurnAt,
  baselineTrackKind,
  firstListenMode,
  listenClock,
  listenOptions,
  regionListenRange,
  type ListenMode,
  type ListenTrack,
} from './comparisonListening.ts'
import type {
  ComparisonPlayback,
  ComparisonRegion,
  ComparisonResult,
  PlaybackTrack,
} from './model.ts'
import type { ComparisonRepository } from './repository.ts'
import { createTimeMap, type TimeMap } from './timeMap.ts'
import { useAlternateTurns } from './useAlternateTurns.ts'
import {
  useComparisonTracks,
  type ComparisonTrackAudio,
} from './useComparisonTracks.ts'

export interface ComparisonLane {
  readonly peaks: WaveformPeaks
  // Where a baseline second from the section start falls in this sound.
  readonly timeOf: AudioTimeOf
}

export interface ComparisonListening {
  // A result is open with at least one sound listed to play.
  readonly active: boolean
  // Runs on the baseline's clock, so switching sounds never moves the time.
  readonly playback: SectionPlayback
  readonly source: SourceSwitch
  // Baseline seconds from the section start where playback's time begins.
  readonly lead: number
  readonly selectedRegionId: string | null
  selectRegion(regionId: string): void
  readonly lanes: Readonly<Record<ListenTrack, ComparisonLane | null>>
  // A sound that could not load, with the way to load it again.
  readonly failure: { readonly label: string; readonly audio: SongAudio } | null
}

const NO_REGIONS: readonly ComparisonRegion[] = []
const NO_TRACKS: readonly PlaybackTrack[] = []

function audiosOf(audio: ComparisonTrackAudio, mode: ListenMode) {
  return mode === 'alternate'
    ? [audio.baseline, audio.performance]
    : [audio[mode]]
}

function readyOf(audio: SongAudio | null) {
  return audio?.state.status === 'ready' ? audio.state : null
}

function hasFailed(audio: SongAudio | null) {
  return audio?.state.status === 'failed'
}

function isFailing(audio: SongAudio | null): audio is SongAudio {
  return audio !== null && (hasFailed(audio) || audio.retrying)
}

function takeTimeOf(map: TimeMap, offsetSeconds: number): AudioTimeOf {
  return (seconds) => map.toPerformance(seconds) + offsetSeconds
}

// Kept stable so the time on screen repaints only when the clock really moves.
function useListenClock(
  track: ListenTrack,
  start: number,
  end: number,
  map: TimeMap,
  offsetSeconds: number,
) {
  return useMemo(
    () => listenClock(track, { start, end }, map, offsetSeconds),
    [track, start, end, map, offsetSeconds],
  )
}

// Plays the sounds of an open comparison through one player, on one timeline.
export function useComparisonPlayer({
  repository,
  result,
  playback,
  performanceSeconds,
  sectionSeconds,
  visible,
  onExpired,
}: {
  repository: ComparisonRepository | null
  result: ComparisonResult | null
  playback: ComparisonPlayback | null
  // Measured when the take was added; the decoded file knows better.
  performanceSeconds: number | null
  sectionSeconds: number
  visible: boolean
  onExpired: () => void
}): ComparisonListening {
  const comparisonId = result?.comparisonId ?? null
  const baseline = result?.baseline ?? 'original-song'
  const baselineKind = baselineTrackKind(baseline)
  const tracks = playback?.tracks ?? NO_TRACKS
  const regions = result?.regions ?? NO_REGIONS
  const listed = listenOptions({ tracks }, baseline)
  const active =
    repository !== null &&
    comparisonId !== null &&
    firstListenMode(listed) !== null

  const audio = useComparisonTracks({
    repository,
    comparisonId: active ? comparisonId : null,
    baselineKind,
    tracks,
    visible,
    onExpired,
  })

  const [chosenMode, setChosenMode] = useState<ListenMode | null>(null)
  const [turn, setTurn] = useState<ListenTrack>('baseline')
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  // Another take starts over with nothing chosen.
  const [shownId, setShownId] = useState(comparisonId)
  if (shownId !== comparisonId) {
    setShownId(comparisonId)
    setChosenMode(null)
    setTurn('baseline')
    setSelectedRegionId(null)
  }

  // A sound still loading keeps its place; a failed one gives way until it is
  // back, even while it loads again.
  const usable = listed.map((option) => ({
    ...option,
    enabled: option.enabled && !audiosOf(audio, option.id).some(isFailing),
  }))
  const fallback =
    firstListenMode(usable) ?? firstListenMode(listed) ?? 'performance'
  const mode =
    chosenMode !== null &&
    usable.some((option) => option.id === chosenMode && option.enabled)
      ? chosenMode
      : fallback
  const track: ListenTrack = mode === 'alternate' ? turn : mode

  const takeBuffer = readyOf(audio.performance)?.buffer ?? null
  const takeSeconds = takeBuffer?.duration ?? performanceSeconds ?? 0
  const map = useMemo(
    () => createTimeMap(regions, sectionSeconds, takeSeconds),
    [regions, sectionSeconds, takeSeconds],
  )

  const offsetOf = (kind: PlaybackTrack['kind']) =>
    tracks.find((candidate) => candidate.kind === kind)?.offsetSeconds ?? 0
  const baselineOffset = offsetOf(baselineKind)
  const takeOffset = offsetOf('performance')
  const offset = track === 'baseline' ? baselineOffset : takeOffset

  const region = regions.find(({ id }) => id === selectedRegionId) ?? null
  const { start: rangeStart, end: rangeEnd } = region
    ? regionListenRange(region, sectionSeconds)
    : { start: 0, end: sectionSeconds }

  const clock = useListenClock(track, rangeStart, rangeEnd, map, offset)

  // Baseline seconds to land on once the next sound or range is in place.
  const landingRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    landingRef.current = 0
  }, [comparisonId])
  // A sound that takes over by itself, as a take loaded again does, keeps the
  // place in the music too. The place is read before the player below
  // switches its audio, which can move a time that falls outside the new one.
  const heardTrackRef = useRef(track)
  const positionRef = useRef<() => number>(() => 0)
  useLayoutEffect(() => {
    if (heardTrackRef.current === track) return
    heardTrackRef.current = track
    landingRef.current ??= positionRef.current()
  })

  const player = useSectionPlayer(
    readyOf(audio[track])?.buffer ?? null,
    clock.range,
  )
  const { elapsed: playerElapsed } = player

  useLayoutEffect(() => {
    const landing = landingRef.current
    if (landing === null || !player.available) return
    landingRef.current = null
    player.seek(clock.toPlayer(landing))
  })

  const position = useCallback(
    () => clock.toBaseline(playerElapsed()),
    [clock, playerElapsed],
  )
  useLayoutEffect(() => {
    positionRef.current = position
  })
  const elapsed = useCallback(
    () => Math.max(0, position() - rangeStart),
    [position, rangeStart],
  )

  const rangeSeconds = rangeEnd - rangeStart
  const turns = useAlternateTurns({
    active: mode === 'alternate',
    playback: {
      playing: player.playing,
      elapsed,
      subscribeSeek: player.subscribeSeek,
    },
    turn,
    map,
    rangeSeconds,
    regionSelected: region !== null,
    resetKey: `${comparisonId}:${rangeStart}:${rangeEnd}`,
    onTurn(next) {
      landingRef.current = position()
      setTurn(next)
    },
  })

  // In 번갈아 a move lands straight on the sound whose turn it is there, so
  // the one heard before never starts there first.
  function moveTo(seconds: number, move: () => void) {
    const next =
      mode === 'alternate' && player.available ? turns.turnAt(seconds) : track
    if (next === track) {
      move()
      return
    }
    landingRef.current = rangeStart + seconds
    setTurn(next)
  }

  const listening: SectionPlayback = {
    ...player,
    length: player.available
      ? Math.min(rangeSeconds, clock.toBaseline(player.length) - rangeStart)
      : rangeSeconds,
    elapsed,
    restart: () => moveTo(0, player.restart),
    seek: (seconds) =>
      moveTo(seconds, () => player.seek(clock.toPlayer(rangeStart + seconds))),
  }

  function chooseMode(id: string) {
    const next = listed.find((option) => option.id === id)?.id
    if (next === undefined || next === mode) return
    const at = position()
    const nextTrack =
      next === 'alternate' ? turns.turnAt(at - rangeStart) : next
    if (nextTrack !== track) landingRef.current = at
    if (next === 'alternate') setTurn(nextTrack)
    setChosenMode(next)
  }

  function selectRegion(regionId: string) {
    const next = regionId === selectedRegionId ? null : regionId
    const place = regions.find(({ id }) => id === next)
    if (place) {
      // A place starts on its first pass, the baseline's.
      landingRef.current = regionListenRange(place, sectionSeconds).start
      setTurn('baseline')
      setSelectedRegionId(next)
      return
    }
    // Letting go keeps the place, on the section's turn there.
    const at = position()
    const nextTurn = alternateTurnAt(map, {
      passIndex: 0,
      elapsedInRange: at,
      rangeSeconds: sectionSeconds,
      regionSelected: false,
    })
    if (mode === 'alternate' && nextTurn !== track) landingRef.current = at
    setTurn(nextTurn)
    setSelectedRegionId(next)
  }

  const baselinePeaks = readyOf(audio.baseline)?.peaks ?? null
  const takePeaks = readyOf(audio.performance)?.peaks ?? null
  const lanes = useMemo(
    () => ({
      baseline: baselinePeaks && {
        peaks: baselinePeaks,
        timeOf: (seconds: number) => seconds + baselineOffset,
      },
      performance: takePeaks && {
        peaks: takePeaks,
        timeOf: takeTimeOf(map, takeOffset),
      },
    }),
    [baselinePeaks, baselineOffset, takePeaks, takeOffset, map],
  )

  const baselineLabel =
    listed.find((option) => option.id === 'baseline')?.label ?? ''
  const failure = isFailing(audio.baseline)
    ? { label: baselineLabel, audio: audio.baseline }
    : isFailing(audio.performance)
      ? { label: '내 연주', audio: audio.performance }
      : null

  return {
    active,
    playback: listening,
    source: {
      options: listed.map((option) => ({
        id: option.id,
        label: option.label,
        enabled:
          option.enabled &&
          audiosOf(audio, option.id).every((item) => readyOf(item) !== null),
      })),
      value: mode,
      onChange: chooseMode,
    },
    lead: rangeStart,
    selectedRegionId,
    selectRegion,
    lanes,
    failure,
  }
}
