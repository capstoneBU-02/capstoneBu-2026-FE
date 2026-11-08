import {
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SectionRange } from '../waveform/timeline.ts'
import {
  createSectionPlayer,
  playableRange,
  type PlayRange,
  type SectionPlayer,
} from './sectionPlayer.ts'

export interface SectionPlayback {
  // The decoded audio covers some of the section.
  readonly available: boolean
  // Seconds that play: the section, cut where the decoded audio ends.
  readonly length: number
  readonly playing: boolean
  readonly repeat: boolean
  // 0 to 1; muting keeps it for unmuting.
  readonly volume: number
  readonly muted: boolean
  toggle(): void
  restart(): void
  setRepeat(repeat: boolean): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  // Seconds since the section start, read on demand so that playback time
  // never re-renders anything by itself.
  elapsed(): number
}

const DEFAULT_VOLUME = 0.8

function playRange(
  startTenths: number | null,
  endTenths: number | null,
): PlayRange | null {
  return startTenths === null || endTenths === null
    ? null
    : { start: startTenths / 10, end: endTenths / 10 }
}

function lengthOf(range: PlayRange | null): number {
  return range ? range.end - range.start : 0
}

function openAudioContext(): AudioContext {
  return new AudioContext()
}

// Playback of the selected section while a screen is open. The output opens
// on the first play and closes when the audio changes or the screen goes.
export function useSectionPlayer(
  buffer: AudioBuffer | null,
  range: SectionRange | null,
): SectionPlayback {
  const [playing, setPlaying] = useState(false)
  const [repeat, setRepeatState] = useState(true)
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME)
  const [muted, setMutedState] = useState(false)
  const playerRef = useRef<SectionPlayer | null>(null)
  const startTenths = range?.startTenths ?? null
  const endTenths = range?.endTenths ?? null
  const requested = playRange(startTenths, endTenths)
  const playable = buffer && playableRange(requested, buffer.duration)

  const open = useEffectEvent((audio: AudioBuffer) => {
    const player = createSectionPlayer(audio, {
      createContext: openAudioContext,
      onStop: () => setPlaying(false),
      repeat,
      volume: muted ? 0 : volume,
    })
    player.setRange(playRange(startTenths, endTenths))
    return player
  })

  // Layout effects, so the player has the new section before the time
  // display reads it in the same commit.
  useLayoutEffect(() => {
    if (!buffer) return
    const player = open(buffer)
    playerRef.current = player
    return () => {
      player.dispose()
      playerRef.current = null
      setPlaying(false)
    }
  }, [buffer])

  useLayoutEffect(() => {
    playerRef.current?.setRange(playRange(startTenths, endTenths))
  }, [startTenths, endTenths])

  const elapsed = useCallback(() => playerRef.current?.elapsed() ?? 0, [])

  return {
    available: Boolean(playable),
    // Before the audio loads, the section as chosen.
    length: lengthOf(buffer ? playable : requested),
    playing,
    repeat,
    volume,
    muted,
    toggle() {
      const player = playerRef.current
      if (!player) return
      if (player.playing()) player.pause()
      else player.play()
      setPlaying(player.playing())
    },
    restart() {
      playerRef.current?.restart()
    },
    setRepeat(next) {
      setRepeatState(next)
      playerRef.current?.setRepeat(next)
    },
    setVolume(next) {
      setVolumeState(next)
      setMutedState(false)
      playerRef.current?.setVolume(next)
    },
    setMuted(next) {
      setMutedState(next)
      playerRef.current?.setVolume(next ? 0 : volume)
    },
    elapsed,
  }
}
