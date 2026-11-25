// What the mock decides about a take in the server's place: whether it can be
// compared at all, and which places it reports for the demo.

import { checkPerformanceLength } from './comparisonRules.ts'
import type { ComparisonRegion, ComparisonRegionKind } from './model.ts'
import type { ComparisonOutcome } from './mockComparisonRun.ts'

// The server treats a take this much longer than the section as slow.
const SLOW_RATIO = 1.1

export type MockRegion = Omit<ComparisonRegion, 'checked'>

// Shares of the section, in the proportions of Figma 90:4125.
const DEMO_REGIONS: readonly {
  readonly kind: ComparisonRegionKind
  readonly start: number
  readonly end: number
}[] = [
  { kind: 'pitch-difference', start: 0.154, end: 0.214 },
  { kind: 'missing-note', start: 0.39, end: 0.46 },
  { kind: 'timing-difference', start: 0.73, end: 0.78 },
  { kind: 'unavailable', start: 0.84, end: 0.92 },
]

// The API reports whole milliseconds.
function roundToMillisecond(seconds: number) {
  return Math.round(seconds * 1_000) / 1_000
}

// The length checks the server makes before aligning (B28).
export function mockOutcomesFor(
  durationSeconds: number,
  sectionSeconds: number,
): readonly ComparisonOutcome[] {
  const length = checkPerformanceLength(durationSeconds, sectionSeconds)
  if (length === 'too-short')
    return [
      { kind: 'not-comparable', stage: 'align', reason: 'RERECORD_TOO_SHORT' },
    ]
  if (length === 'too-long')
    return [
      { kind: 'not-comparable', stage: 'align', reason: 'RERECORD_TOO_LONG' },
    ]
  if (length === 'unreadable')
    return [
      {
        kind: 'failed',
        stage: 'align',
        code: 'PERFORMANCE_INVALID_AUDIO',
        retryable: false,
      },
    ]
  return [{ kind: 'success' }]
}

export function mockRegions(
  comparisonId: string,
  sectionSeconds: number,
  performanceSeconds: number,
): readonly MockRegion[] {
  return DEMO_REGIONS.map((region, index) => ({
    id: `${comparisonId}-region-${index + 1}`,
    kind: region.kind,
    startSeconds: roundToMillisecond(region.start * sectionSeconds),
    endSeconds: roundToMillisecond(region.end * sectionSeconds),
    performanceStartSeconds: roundToMillisecond(
      region.start * performanceSeconds,
    ),
    performanceEndSeconds: roundToMillisecond(region.end * performanceSeconds),
    unavailableReason: region.kind === 'unavailable' ? 'LOW_CONFIDENCE' : null,
  }))
}

export function isMockSlowTake(
  performanceSeconds: number,
  sectionSeconds: number,
) {
  return performanceSeconds / sectionSeconds >= SLOW_RATIO
}
