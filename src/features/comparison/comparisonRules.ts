import type { ComparisonRegion, SavedPerformance } from './model.ts'

// The server's first values, not yet verified, and the server has the final
// say. They are kept here so a change touches one place.
const MIN_LENGTH_RATIO = 0.5
const MAX_LENGTH_RATIO = 2

export type PerformanceLengthCheck =
  'valid' | 'too-short' | 'too-long' | 'unreadable'

function isLength(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0
}

export function checkPerformanceLength(
  durationSeconds: number,
  sectionSeconds: number,
): PerformanceLengthCheck {
  if (!isLength(durationSeconds) || !isLength(sectionSeconds))
    return 'unreadable'
  if (durationSeconds < sectionSeconds * MIN_LENGTH_RATIO) return 'too-short'
  if (durationSeconds > sectionSeconds * MAX_LENGTH_RATIO) return 'too-long'
  return 'valid'
}

// Recording runs past the section so a slow take is not cut off (CMP-02).
export function recordingLimitSeconds(sectionSeconds: number) {
  return sectionSeconds * MAX_LENGTH_RATIO
}

export interface RegionCheckProgress {
  readonly checked: number
  readonly total: number
}

// Counts the places that sounded different. A place the server could not
// compare is nothing the user can finish checking (CMP-05). Null when there is
// nothing to count, so the screen never shows 0/0.
export function regionCheckProgress(
  regions: readonly Pick<ComparisonRegion, 'kind' | 'checked'>[],
): RegionCheckProgress | null {
  const differences = regions.filter((region) => region.kind !== 'unavailable')
  if (differences.length === 0) return null
  return {
    checked: differences.filter((region) => region.checked).length,
    total: differences.length,
  }
}

type SectionRange = Pick<
  SavedPerformance,
  'rangeStartSeconds' | 'rangeEndSeconds'
>

export function isFromPreviousSection(
  performance: SectionRange,
  section: SectionRange,
) {
  return (
    performance.rangeStartSeconds !== section.rangeStartSeconds ||
    performance.rangeEndSeconds !== section.rangeEndSeconds
  )
}
