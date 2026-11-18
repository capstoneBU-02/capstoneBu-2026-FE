import type { ComparisonRegion } from './model.ts'

// Converts between the baseline sound and the performance file. The server
// reports only the region boundaries, so times between them follow a straight
// line from one known pair to the next. The waveform and track switching share
// this map, so what is drawn and what is heard stay at the same place.

type RegionTimes = Pick<
  ComparisonRegion,
  | 'startSeconds'
  | 'endSeconds'
  | 'performanceStartSeconds'
  | 'performanceEndSeconds'
  | 'unavailableReason'
>

interface Anchor {
  readonly baseline: number
  readonly performance: number
}

type Clock = keyof Anchor

export interface TimeMap {
  toPerformance(baselineSeconds: number): number
  toBaseline(performanceSeconds: number): number
}

const SAME_TIME: TimeMap = {
  toPerformance: (seconds) => seconds,
  toBaseline: (seconds) => seconds,
}

function isLength(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0
}

// The API counts whole milliseconds, while the section and file lengths are
// measured apart from it, so the same edge can differ by one.
function isSameMoment(a: number, b: number) {
  return Math.round(Math.abs(a - b) * 1_000) <= 1
}

// A place the server could not align says nothing about where the two meet.
// Regions may overlap, so the boundaries are ordered one by one.
function regionAnchors(regions: readonly RegionTimes[]): readonly Anchor[] {
  return regions
    .filter((region) => region.unavailableReason !== 'UNCLEAR_ALIGNMENT')
    .flatMap((region) => [
      {
        baseline: region.startSeconds,
        performance: region.performanceStartSeconds,
      },
      {
        baseline: region.endSeconds,
        performance: region.performanceEndSeconds,
      },
    ])
    .sort((a, b) => a.baseline - b.baseline || a.performance - b.performance)
}

// Regions that touch share one pair.
function withoutRepeats(anchors: readonly Anchor[]): readonly Anchor[] {
  return anchors.filter((anchor, index) => {
    const previous = anchors[index - 1]
    return (
      previous?.baseline !== anchor.baseline ||
      previous.performance !== anchor.performance
    )
  })
}

function isIncreasing(anchors: readonly Anchor[]) {
  return anchors.every((anchor, index) => {
    const previous = anchors[index - 1]
    return (
      !previous ||
      (anchor.baseline > previous.baseline &&
        anchor.performance > previous.performance)
    )
  })
}

// A region at the section edge knows that edge better than the file length.
function anchorsFor(
  regions: readonly RegionTimes[],
  sectionSeconds: number,
  performanceSeconds: number,
): readonly Anchor[] {
  const start: Anchor = { baseline: 0, performance: 0 }
  const end: Anchor = {
    baseline: sectionSeconds,
    performance: performanceSeconds,
  }
  const inner = regionAnchors(regions)
  const first = inner[0]
  const last = inner.at(-1)
  const reachesStart =
    first &&
    (isSameMoment(first.baseline, start.baseline) ||
      isSameMoment(first.performance, start.performance))
  const reachesEnd =
    last &&
    (isSameMoment(last.baseline, end.baseline) ||
      isSameMoment(last.performance, end.performance))
  const anchors = withoutRepeats([
    ...(reachesStart ? [] : [start]),
    ...inner,
    ...(reachesEnd ? [] : [end]),
  ])
  return isIncreasing(anchors) ? anchors : [start, end]
}

function convert(
  anchors: readonly Anchor[],
  from: Clock,
  to: Clock,
  seconds: number,
) {
  if (Number.isNaN(seconds)) return anchors[0][to]
  const next = anchors.findIndex((anchor) => anchor[from] >= seconds)
  if (next === 0) return anchors[0][to]
  if (next < 0) return anchors[anchors.length - 1][to]
  const before = anchors[next - 1]
  const after = anchors[next]
  const progress = (seconds - before[from]) / (after[from] - before[from])
  return before[to] + progress * (after[to] - before[to])
}

export function createTimeMap(
  regions: readonly RegionTimes[],
  sectionSeconds: number,
  performanceSeconds: number,
): TimeMap {
  if (!isLength(sectionSeconds) || !isLength(performanceSeconds))
    return SAME_TIME
  const anchors = anchorsFor(regions, sectionSeconds, performanceSeconds)
  return {
    toPerformance: (seconds) =>
      convert(anchors, 'baseline', 'performance', seconds),
    toBaseline: (seconds) =>
      convert(anchors, 'performance', 'baseline', seconds),
  }
}
