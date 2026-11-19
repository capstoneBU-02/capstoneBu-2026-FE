import type {
  ComparisonPlayback,
  ComparisonRegion,
  ComparisonResult,
  PlaybackTrackKind,
} from './model.ts'
import type { SectionRange } from '../waveform/timeline.ts'
import type { TimeMap } from './timeMap.ts'

export type ListenMode = 'baseline' | 'performance' | 'alternate'

export type ListenTrack = 'baseline' | 'performance'

interface ListenOption {
  readonly id: ListenMode
  readonly label: string
  readonly enabled: boolean
}

// Baseline seconds from the section start.
export interface ListenRange {
  readonly start: number
  readonly end: number
}

interface AlternateTurn {
  readonly passIndex: number
  readonly elapsedInRange: number
  readonly rangeSeconds: number
  readonly regionSelected: boolean
}

export const REGION_LOOP_PADDING_SECONDS = 0.5

export const ALTERNATE_TURN_SECONDS = 4

// Converting between clocks can move a position back by less than this.
const WRAP_TOLERANCE_SECONDS = 0.05

// A take hands over this long before it runs out, ahead of the player's wrap.
const TAKE_END_MARGIN_SECONDS = 0.1

// One sound of a range, on the player's clock: seconds into `range`.
export interface ListenClock {
  // Tenths of the sound's file, widened to hold the whole range.
  readonly range: SectionRange
  // Baseline seconds from the section start.
  toBaseline(playerSeconds: number): number
  toPlayer(baselineSeconds: number): number
}

export const NO_TRACK_NOTICE = '재생할 수 있는 음원이 없어요.'

function partialNotice(name: string) {
  return `${name} 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.`
}

function positiveOrZero(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function baselineTrackKind(
  baseline: ComparisonResult['baseline'],
): PlaybackTrackKind {
  return baseline === 'original-song' ? 'original' : 'stem'
}

export function listenOptions(
  playback: Pick<ComparisonPlayback, 'tracks'>,
  baseline: ComparisonResult['baseline'],
): readonly ListenOption[] {
  const canPlay = (kind: PlaybackTrackKind) =>
    playback.tracks.some((track) => track.kind === kind && track.available)
  const baselineEnabled = canPlay(baselineTrackKind(baseline))
  const performanceEnabled = canPlay('performance')
  return [
    {
      id: 'baseline',
      label: baseline === 'original-song' ? '원곡' : '올린 음원',
      enabled: baselineEnabled,
    },
    { id: 'performance', label: '내 연주', enabled: performanceEnabled },
    {
      id: 'alternate',
      label: '번갈아',
      enabled: baselineEnabled && performanceEnabled,
    },
  ]
}

function optionOf(options: readonly ListenOption[], id: ListenMode) {
  return options.find((option) => option.id === id)
}

export function firstListenMode(
  options: readonly ListenOption[],
): ListenMode | null {
  if (optionOf(options, 'performance')?.enabled) return 'performance'
  if (optionOf(options, 'baseline')?.enabled) return 'baseline'
  return null
}

export function listenPartialNotice(
  options: readonly ListenOption[],
): string | null {
  const baseline = optionOf(options, 'baseline')
  const take = optionOf(options, 'performance')
  if (!baseline?.enabled && !take?.enabled) return NO_TRACK_NOTICE
  if (baseline?.enabled === false) return partialNotice(`${baseline.label}을`)
  if (take?.enabled === false) return partialNotice('내 연주를')
  return null
}

export function regionListenRange(
  region: Pick<ComparisonRegion, 'startSeconds' | 'endSeconds'>,
  sectionSeconds: number,
): ListenRange {
  const limit = positiveOrZero(sectionSeconds)
  const clamped = (seconds: number) => Math.min(positiveOrZero(seconds), limit)
  return {
    start: clamped(region.startSeconds - REGION_LOOP_PADDING_SECONDS),
    end: clamped(region.endSeconds + REGION_LOOP_PADDING_SECONDS),
  }
}

export function trackRange(
  track: ListenTrack,
  range: ListenRange,
  map: TimeMap,
): ListenRange {
  if (track === 'baseline') return range
  return {
    start: map.toPerformance(range.start),
    end: map.toPerformance(range.end),
  }
}

export function trackElapsed(
  track: ListenTrack,
  baselineSeconds: number,
  map: TimeMap,
): number {
  return track === 'baseline'
    ? baselineSeconds
    : map.toPerformance(baselineSeconds)
}

export function baselineElapsed(
  track: ListenTrack,
  trackSeconds: number,
  map: TimeMap,
): number {
  return track === 'baseline' ? trackSeconds : map.toBaseline(trackSeconds)
}

export function listenClock(
  track: ListenTrack,
  range: ListenRange,
  map: TimeMap,
  offsetSeconds: number,
): ListenClock {
  const inTrack = trackRange(track, range, map)
  const startTenths = Math.floor((inTrack.start + offsetSeconds) * 10 + 1e-6)
  const endTenths = Math.ceil((inTrack.end + offsetSeconds) * 10 - 1e-6)
  // Where the player's zero sits on the track's own clock.
  const origin = startTenths / 10 - offsetSeconds
  return {
    range: { startTenths, endTenths },
    toBaseline: (seconds) => baselineElapsed(track, origin + seconds, map),
    toPlayer: (seconds) =>
      Math.max(0, trackElapsed(track, seconds, map) - origin),
  }
}

// A position that moved back without a seek has wrapped around the range.
export function nextListenPass(
  passIndex: number,
  previousSeconds: number | null,
  seconds: number,
): number {
  return previousSeconds !== null &&
    seconds < previousSeconds - WRAP_TOLERANCE_SECONDS
    ? passIndex + 1
    : passIndex
}

// A take stopped early has no sound for the baseline seconds past its end.
export function takeReaches(
  map: TimeMap,
  baselineSeconds: number,
  rangeSeconds: number,
): boolean {
  const ahead = Math.min(
    baselineSeconds + TAKE_END_MARGIN_SECONDS,
    rangeSeconds,
  )
  return (
    map.toBaseline(map.toPerformance(ahead)) >= ahead - WRAP_TOLERANCE_SECONDS
  )
}

function trackOfTurn(turn: number): ListenTrack {
  return turn % 2 === 0 ? 'baseline' : 'performance'
}

export function alternateTrack(input: AlternateTurn): ListenTrack {
  const pass = Math.floor(positiveOrZero(input.passIndex))
  if (input.regionSelected) return trackOfTurn(pass)
  const turnsPerPass = Math.max(
    1,
    Math.ceil(positiveOrZero(input.rangeSeconds) / ALTERNATE_TURN_SECONDS),
  )
  const turnInPass = Math.min(
    Math.floor(positiveOrZero(input.elapsedInRange) / ALTERNATE_TURN_SECONDS),
    turnsPerPass - 1,
  )
  // Turns keep counting across passes: with an odd number per pass, restarting
  // the count would play the same sound twice in a row at the loop point.
  return trackOfTurn(pass * turnsPerPass + turnInPass)
}
