import { formatSectionTime } from '../new-section/sectionTime.ts'
import { isFromPreviousSection } from './comparisonRules.ts'
import type {
  ComparisonRegion,
  ComparisonResult,
  ComparisonState,
  ComparisonStatus,
  PerformanceSource,
  SavedPerformance,
} from './model.ts'

export type Section = Pick<
  SavedPerformance,
  'rangeStartSeconds' | 'rangeEndSeconds'
>

export interface ViewRegion extends ComparisonRegion {
  // Null for a place the server could not compare: only differences are
  // numbered, so the numbers on screen match the count of differences.
  readonly number: number | null
  readonly songStartSeconds: number
  readonly songEndSeconds: number
  readonly startRatio: number
  readonly endRatio: number
}

function isDifference(region: Pick<ComparisonRegion, 'kind'>) {
  return region.kind !== 'unavailable'
}

function byTime(a: ComparisonRegion, b: ComparisonRegion) {
  return a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds
}

export function viewRegions(
  regions: readonly ComparisonRegion[],
  section: Section,
): readonly ViewRegion[] {
  const { rangeStartSeconds, rangeEndSeconds } = section
  const sectionSeconds = rangeEndSeconds - rangeStartSeconds
  const toRatio = (seconds: number) =>
    sectionSeconds > 0 ? Math.min(Math.max(seconds / sectionSeconds, 0), 1) : 0

  return regions.toSorted(byTime).map((region, index, sorted) => ({
    ...region,
    number: isDifference(region)
      ? sorted.slice(0, index + 1).filter(isDifference).length
      : null,
    songStartSeconds: rangeStartSeconds + region.startSeconds,
    songEndSeconds: rangeStartSeconds + region.endSeconds,
    startRatio: toRatio(region.startSeconds),
    endRatio: toRatio(region.endSeconds),
  }))
}

function songTimeLabel(seconds: number) {
  return formatSectionTime(Math.round(seconds * 10))
}

export function regionTimeLabel(
  region: Pick<ViewRegion, 'songStartSeconds' | 'songEndSeconds'>,
): string {
  return `${songTimeLabel(region.songStartSeconds)} – ${songTimeLabel(region.songEndSeconds)}`
}

export function regionLegend(
  regions: readonly Pick<ComparisonRegion, 'kind'>[],
): { readonly differences: number; readonly unavailable: number } {
  const differences = regions.filter(isDifference).length
  return { differences, unavailable: regions.length - differences }
}

export interface PerformanceOption {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly fromPreviousSection: boolean
}

const SOURCE_LABELS: Record<PerformanceSource, string> = {
  recording: '녹음',
  upload: '파일',
}

// The list is newest first, so a take's number is how many takes of its source
// remain from it to the end: a new take never renumbers the older ones.
export function performanceOptions(
  performances: readonly SavedPerformance[],
  section: Section,
): readonly PerformanceOption[] {
  return performances.map((performance, index) => {
    const number = performances
      .slice(index)
      .filter((other) => other.source === performance.source).length
    const fromPreviousSection = isFromPreviousSection(performance, section)
    return {
      id: performance.id,
      label: `${SOURCE_LABELS[performance.source]} #${number}`,
      detail: fromPreviousSection
        ? `${performance.createdAtLabel} · 이전 구간`
        : performance.createdAtLabel,
      fromPreviousSection,
    }
  })
}

export type ComparisonPanel =
  | 'empty'
  | 'running'
  | 'failed'
  | 'not-comparable'
  | 'loading-result'
  | 'result'

export function isComparisonRunning(state: ComparisonState): boolean {
  return state === 'queued' || state === 'processing'
}

export function comparisonPanel(
  status: Pick<ComparisonStatus, 'state'> | null,
  result: Pick<ComparisonResult, 'comparisonId'> | null,
): ComparisonPanel {
  if (status === null) return 'empty'
  if (isComparisonRunning(status.state)) return 'running'
  if (status.state === 'failed') return 'failed'
  if (status.state === 'not-comparable') return 'not-comparable'
  return result === null ? 'loading-result' : 'result'
}

// A place the server could not compare is nothing to check off (CMP-05).
export function withRegionChecked(
  result: ComparisonResult,
  regionId: string,
  checked: boolean,
): ComparisonResult {
  const target = result.regions.find((region) => region.id === regionId)
  if (target === undefined || !isDifference(target)) return result
  return {
    ...result,
    regions: result.regions.map((region) =>
      region === target ? { ...region, checked } : region,
    ),
  }
}
