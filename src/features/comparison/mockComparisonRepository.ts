import type { SongInputKind } from '../workspace/model.ts'
import { waitForMockRequest } from '../workspace/mockServer.ts'
import { isFromPreviousSection } from './comparisonRules.ts'
import type {
  ComparisonRef,
  ComparisonResult,
  ComparisonStatus,
  PlaybackTrack,
  PlaybackTrackKind,
  SavedPerformance,
} from './model.ts'
import {
  isMockSlowTake,
  mockOutcomesFor,
  mockRegions,
  type MockRegion,
} from './mockComparisonOutcome.ts'
import { isMockSilentTake } from './mockTakeLevel.ts'
import {
  comparisonRunState,
  DEMO_COMPARISON_TIMING,
  outcomeFromStage,
  type ComparisonOutcome,
  type ComparisonRun,
  type ComparisonTiming,
} from './mockComparisonRun.ts'
import {
  ComparisonRepositoryError,
  type ComparisonRepository,
} from './repository.ts'

// CMP: three retries after the first run.
const RETRY_LIMIT = 3

const TRACK_KINDS: readonly PlaybackTrackKind[] = [
  'original',
  'stem',
  'performance',
]

// What the comparison needs to know about a task from the workspace.
export interface MockComparisonSection {
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
  readonly hasSeparatedAudio: boolean
  readonly inputKind: SongInputKind
}

interface MockComparisonOptions {
  readonly sectionOf: (taskId: string) => MockComparisonSection | undefined
  readonly loadBaselineAudio: (
    taskId: string,
    kind: Exclude<PlaybackTrackKind, 'performance'>,
    signal: AbortSignal,
  ) => Promise<Blob>
  // The session clock and the pace of a comparison; tests pass their own.
  readonly now?: () => number
  readonly timing?: ComparisonTiming
  readonly requestDelayMs?: number
  // One outcome per attempt; the last one repeats for later retries.
  readonly outcomesFor?: (
    performance: SavedPerformance,
  ) => readonly ComparisonOutcome[]
  readonly unavailableTracks?: readonly PlaybackTrackKind[]
}

type KeptPerformance = Omit<SavedPerformance, 'latestComparison'>

interface KeptComparison {
  readonly id: string
  readonly performanceId: string
  readonly baseline: ComparisonResult['baseline']
  readonly isSlow: boolean
  readonly outcomes: readonly ComparisonOutcome[]
  readonly retriesUsed: number
  readonly run: ComparisonRun
  readonly regions: readonly MockRegion[]
  readonly checkedRegionIds: ReadonlySet<string>
}

function outcomeOfAttempt(
  outcomes: readonly ComparisonOutcome[],
  attempt: number,
): ComparisonOutcome {
  return outcomes[Math.min(attempt, outcomes.length - 1)] ?? { kind: 'success' }
}

function isRunning(state: ComparisonStatus['state']) {
  return state === 'queued' || state === 'processing'
}

function sectionLength(performance: KeptPerformance) {
  return performance.rangeEndSeconds - performance.rangeStartSeconds
}

export function createMockComparisonRepository(
  options: MockComparisonOptions,
): ComparisonRepository {
  const now = options.now ?? Date.now
  const timing = options.timing ?? DEMO_COMPARISON_TIMING
  const requestDelayMs = options.requestDelayMs ?? 200
  const unavailableTracks = new Set(options.unavailableTracks ?? [])
  // A Map keeps insertion order. A retry moves its comparison to the end, so
  // the last entry for a take is always the run started last.
  const performances = new Map<string, KeptPerformance>()
  const audioFiles = new Map<string, Blob>()
  const silentPerformanceIds = new Set<string>()
  const comparisons = new Map<string, KeptComparison>()
  let savedCount = 0
  let comparedCount = 0

  function statusOf(kept: KeptComparison): ComparisonStatus {
    const { outcome } = kept.run
    const run = comparisonRunState(kept.run, now(), timing)
    return {
      id: kept.id,
      ...run,
      notComparableReason:
        run.state === 'not-comparable' && outcome.kind === 'not-comparable'
          ? outcome.reason
          : null,
      failure:
        run.state === 'failed' && outcome.kind === 'failed'
          ? {
              stage: outcome.stage,
              code: outcome.code,
              retry: outcome.retryable
                ? {
                    left: Math.max(RETRY_LIMIT - kept.retriesUsed, 0),
                    limit: RETRY_LIMIT,
                  }
                : null,
            }
          : null,
    }
  }

  function comparisonsOf(performanceId: string) {
    return [...comparisons.values()].filter(
      (kept) => kept.performanceId === performanceId,
    )
  }

  function hasRunningComparison(performanceId: string) {
    return comparisonsOf(performanceId).some((kept) =>
      isRunning(statusOf(kept).state),
    )
  }

  function refTo(kept: KeptComparison): ComparisonRef {
    return { id: kept.id, state: statusOf(kept).state }
  }

  function listed(performance: KeptPerformance): SavedPerformance {
    const latest = comparisonsOf(performance.id).at(-1)
    return {
      ...performance,
      latestComparison: latest ? refTo(latest) : null,
    }
  }

  function findPerformance(performanceId: string) {
    const performance = performances.get(performanceId)
    if (!performance)
      throw new ComparisonRepositoryError('performance-unavailable')
    return performance
  }

  function findComparison(comparisonId: string) {
    const kept = comparisons.get(comparisonId)
    if (!kept) throw new ComparisonRepositoryError('comparison-unavailable')
    return kept
  }

  function findFinished(comparisonId: string) {
    const kept = findComparison(comparisonId)
    const { state } = statusOf(kept)
    if (state !== 'success' && state !== 'not-comparable')
      throw new ComparisonRepositoryError('comparison-not-ready')
    return { kept, state }
  }

  // The server sends the same three sounds whatever the input (CMP-04). It
  // cuts the stem to the section, but the mock plays an uploaded guitar whole.
  function tracksOf(kept: KeptComparison): readonly PlaybackTrack[] {
    const performance = findPerformance(kept.performanceId)
    const wholeSong = new Set<PlaybackTrackKind>(
      kept.baseline === 'separated-input' ? ['original', 'stem'] : ['original'],
    )
    return TRACK_KINDS.map((kind) => ({
      kind,
      available: !unavailableTracks.has(kind),
      offsetSeconds: wholeSong.has(kind) ? performance.rangeStartSeconds : 0,
    }))
  }

  function startComparison(
    performance: KeptPerformance,
    section: MockComparisonSection,
  ) {
    comparedCount += 1
    const id = `comparison-${comparedCount}`
    const seconds = sectionLength(performance)
    const played = performance.durationSeconds ?? seconds
    const outcomes =
      options.outcomesFor?.(listed(performance)) ??
      mockOutcomesFor(played, seconds, silentPerformanceIds.has(performance.id))
    const kept: KeptComparison = {
      id,
      performanceId: performance.id,
      baseline:
        section.inputKind === 'separated-guitar'
          ? 'separated-input'
          : 'original-song',
      isSlow: isMockSlowTake(played, seconds),
      outcomes,
      retriesUsed: 0,
      run: {
        enqueuedAt: now(),
        startStage: 'align',
        outcome: outcomeOfAttempt(outcomes, 0),
      },
      regions: mockRegions(id, seconds, played),
      checkedRegionIds: new Set(),
    }
    comparisons.set(id, kept)
    return kept
  }

  return {
    async listPerformances(taskId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      return [...performances.values()]
        .filter((performance) => performance.taskId === taskId)
        .reverse()
        .map(listed)
    },
    async savePerformance(input, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const section = options.sectionOf(input.taskId)
      if (!section) throw new ComparisonRepositoryError('task-unavailable')
      if (input.audio.size === 0)
        throw new ComparisonRepositoryError('invalid-audio')
      const silent = await isMockSilentTake(input.audio)

      savedCount += 1
      const performance: KeptPerformance = {
        id: `performance-${savedCount}`,
        taskId: input.taskId,
        source: input.source,
        rangeStartSeconds: section.rangeStartSeconds,
        rangeEndSeconds: section.rangeEndSeconds,
        createdAtLabel: '방금',
        durationSeconds: input.durationSeconds,
      }
      performances.set(performance.id, performance)
      audioFiles.set(performance.id, input.audio)
      if (silent) silentPerformanceIds.add(performance.id)
      return listed(performance)
    },
    // In the order the server checks a request (CMP 비교 요청).
    async requestComparison(performanceId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const performance = findPerformance(performanceId)
      const section = options.sectionOf(performance.taskId)
      if (!section)
        throw new ComparisonRepositoryError('performance-unavailable')
      if (isFromPreviousSection(performance, section))
        throw new ComparisonRepositoryError('section-changed')
      if (!section.hasSeparatedAudio)
        throw new ComparisonRepositoryError('stem-not-ready')

      if (hasRunningComparison(performanceId))
        throw new ComparisonRepositoryError('comparison-in-progress')
      const finished = comparisonsOf(performanceId)
        .filter((kept) => statusOf(kept).state !== 'failed')
        .at(-1)
      return refTo(finished ?? startComparison(performance, section))
    },
    async loadStatus(comparisonId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      return statusOf(findComparison(comparisonId))
    },
    async loadResult(comparisonId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const { kept, state } = findFinished(comparisonId)
      const compared = state === 'success'
      const { outcome } = kept.run
      const aligned = outcome.kind === 'success' || outcome.stage !== 'align'
      return {
        comparisonId,
        state,
        notComparableReason: statusOf(kept).notComparableReason,
        baseline: kept.baseline,
        overallTempo: aligned ? { isSlow: kept.isSlow } : null,
        regions: compared
          ? kept.regions.map((region) => ({
              ...region,
              checked: kept.checkedRegionIds.has(region.id),
            }))
          : [],
      }
    },
    async loadPlayback(comparisonId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const { kept } = findFinished(comparisonId)
      const tracks = tracksOf(kept)
      return {
        comparisonId,
        isPartial: tracks.some((track) => !track.available),
        tracks,
      }
    },
    async loadTrackAudio(comparisonId, kind, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const { kept } = findFinished(comparisonId)
      const track = tracksOf(kept).find((candidate) => candidate.kind === kind)
      const audio = audioFiles.get(kept.performanceId)
      if (!track?.available || !audio)
        throw new ComparisonRepositoryError('audio-unavailable')
      if (kind === 'performance') return audio
      const { taskId } = findPerformance(kept.performanceId)
      return options.loadBaselineAudio(taskId, kind, signal)
    },
    async markRegion(comparisonId, regionId, checked, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const kept = comparisons.get(comparisonId)
      if (
        !kept ||
        statusOf(kept).state !== 'success' ||
        !kept.regions.some((region) => region.id === regionId)
      )
        throw new ComparisonRepositoryError('region-unavailable')
      const others = [...kept.checkedRegionIds].filter((id) => id !== regionId)
      comparisons.set(comparisonId, {
        ...kept,
        checkedRegionIds: new Set(checked ? [...others, regionId] : others),
      })
    },
    async retry(comparisonId, signal) {
      await waitForMockRequest(requestDelayMs, signal)
      const kept = findComparison(comparisonId)
      const { failure } = statusOf(kept)
      if (!failure?.retry) throw new ComparisonRepositoryError('not-retryable')
      if (hasRunningComparison(kept.performanceId))
        throw new ComparisonRepositoryError('comparison-in-progress')
      if (failure.retry.left === 0)
        throw new ComparisonRepositoryError('retry-limit')

      const retriesUsed = kept.retriesUsed + 1
      const retried: KeptComparison = {
        ...kept,
        retriesUsed,
        run: {
          enqueuedAt: now(),
          startStage: failure.stage,
          outcome: outcomeFromStage(
            outcomeOfAttempt(kept.outcomes, retriesUsed),
            failure.stage,
          ),
        },
      }
      comparisons.delete(comparisonId)
      comparisons.set(comparisonId, retried)
      return refTo(retried)
    },
  }
}
