import {
  readObject,
  readOneOf,
  readString,
  type ObjectReader,
} from '../../api/guards.ts'
import { updatedAtLabel } from '../workspace/format.ts'
import type { TaskStageStatus } from '../workspace/model.ts'
import { retryOf } from '../workspace/taskState.ts'
import type {
  ComparisonCreatedResponse,
  ComparisonFailureView,
  ComparisonPlaybackResponse,
  ComparisonPlaybackTrack,
  ComparisonRegionType,
  ComparisonRegionView,
  ComparisonResultResponse,
  ComparisonRetryResponse,
  ComparisonStageStatusValue,
  ComparisonStageView,
  ComparisonStatusResponse,
  ComparisonStatusValue,
  PerformanceListResponse,
  PerformanceResponse,
  PerformanceSourceCode,
  RegionCheckResponse,
} from './apiTypes.ts'
import type {
  ComparisonPlayback,
  ComparisonRef,
  ComparisonRegion,
  ComparisonRegionKind,
  ComparisonResult,
  ComparisonStage,
  ComparisonStageId,
  ComparisonState,
  ComparisonStatus,
  PerformanceSource,
  PlaybackTrackKind,
  SavedPerformance,
} from './model.ts'

const SOURCE_CODES = ['RECORDING', 'UPLOAD'] as const

const SOURCES: Readonly<Record<PerformanceSourceCode, PerformanceSource>> = {
  RECORDING: 'recording',
  UPLOAD: 'upload',
}

export function sourceCodeOf(source: PerformanceSource): PerformanceSourceCode {
  return source === 'recording' ? 'RECORDING' : 'UPLOAD'
}

function readPerformanceFields(item: ObjectReader): PerformanceResponse {
  return {
    performance_id: item.integer('performance_id'),
    source: item.oneOf('source', SOURCE_CODES),
    start_ms: item.integer('start_ms'),
    end_ms: item.integer('end_ms'),
    created_at: item.string('created_at'),
  }
}

export function readPerformanceCreate(data: unknown): PerformanceResponse {
  return readPerformanceFields(readObject(data))
}

export function readPerformanceList(data: unknown): PerformanceListResponse {
  return {
    performances: readObject(data).array('performances', (value, path) =>
      readPerformanceFields(readObject(value, path)),
    ),
  }
}

// Seconds, as on every other screen, and the save time worded as the task
// list words its change time. The server reports no length: only a take
// saved from this page has one. The latest comparison stays null until the
// server lists one with the take.
export function toSavedPerformance(
  performance: PerformanceResponse,
  {
    taskId,
    durationSeconds,
    now,
  }: { taskId: string; durationSeconds: number | null; now: Date },
): SavedPerformance {
  return {
    id: String(performance.performance_id),
    taskId,
    source: SOURCES[performance.source],
    rangeStartSeconds: performance.start_ms / 1000,
    rangeEndSeconds: performance.end_ms / 1000,
    createdAtLabel: updatedAtLabel(performance.created_at, now),
    durationSeconds,
    latestComparison: null,
  }
}

// --- comparisons -------------------------------------------------------------

const COMPARISON_STATUSES = [
  'queued',
  'processing',
  'success',
  'not_comparable',
  'failed',
] as const
const STAGE_NAMES = ['align', 'transcription', 'compare'] as const
const STAGE_STATUSES = [
  'queued',
  'processing',
  'success',
  'failed',
  'skipped',
] as const
const REGION_TYPES = [
  'pitch_difference',
  'missing_note',
  'timing_difference',
  'unavailable',
] as const
const TRACK_TYPES = ['original', 'stem', 'performance'] as const

const STATES: Readonly<Record<ComparisonStatusValue, ComparisonState>> = {
  queued: 'queued',
  processing: 'processing',
  success: 'success',
  not_comparable: 'not-comparable',
  failed: 'failed',
}

const STAGE_STATES: Readonly<
  Record<ComparisonStageStatusValue, TaskStageStatus>
> = {
  queued: 'waiting',
  processing: 'running',
  success: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

const REGION_KINDS: Readonly<
  Record<ComparisonRegionType, ComparisonRegionKind>
> = {
  pitch_difference: 'pitch-difference',
  missing_note: 'missing-note',
  timing_difference: 'timing-difference',
  unavailable: 'unavailable',
}

const seconds = (ms: number) => ms / 1000

const readStageName = (value: unknown, path: string) =>
  readOneOf(value, STAGE_NAMES, path)

function readComparisonRefFields(data: unknown): ComparisonCreatedResponse {
  const comparison = readObject(data)
  return {
    comparison_id: comparison.integer('comparison_id'),
    status: comparison.oneOf('status', COMPARISON_STATUSES),
  }
}

export const readComparisonCreated: (
  data: unknown,
) => ComparisonCreatedResponse = readComparisonRefFields

export const readComparisonRetry: (data: unknown) => ComparisonRetryResponse =
  readComparisonRefFields

export function toComparisonRef(
  comparison: ComparisonCreatedResponse,
): ComparisonRef {
  return {
    id: String(comparison.comparison_id),
    state: STATES[comparison.status],
  }
}

function readStage(value: unknown, path: string): ComparisonStageView {
  const stage = readObject(value, path)
  return {
    stage: stage.oneOf('stage', STAGE_NAMES),
    status: stage.oneOf('status', STAGE_STATUSES),
  }
}

function readComparisonFailure(failure: ObjectReader): ComparisonFailureView {
  return {
    stage: failure.nullable('stage', readStageName),
    error_code: failure.string('error_code'),
    retryable: failure.boolean('retryable'),
    max_retries: failure.integer('max_retries'),
    retries_left: failure.integer('retries_left'),
  }
}

export function readComparisonStatus(data: unknown): ComparisonStatusResponse {
  const status = readObject(data)
  const failure = status.nullableObject('failure')
  return {
    comparison_id: status.integer('comparison_id'),
    status: status.oneOf('status', COMPARISON_STATUSES),
    current_stage: status.nullable('current_stage', readStageName),
    not_comparable_reason: status.nullable('not_comparable_reason', readString),
    stages: status.array('stages', readStage),
    failure: failure && readComparisonFailure(failure),
  }
}

// The server's own words for where a comparison is, put the way the mock
// and the task stages put them. A stage row keeps its last outcome: after a
// retry the stage that failed still reads failed while it waits again, and a
// job given up mid-stage still reads processing. While running, a failed row
// waits and the stage before it is the one that just finished; once failed,
// the failed stage is the one in the failure, or the first when the job was
// given up before starting.
export function toComparisonStatus(
  status: ComparisonStatusResponse,
): ComparisonStatus {
  const state = STATES[status.status]
  const running = state === 'queued' || state === 'processing'
  const rowOf = (id: ComparisonStageId) =>
    status.stages.find((row) => row.stage === id)?.status ?? 'queued'
  const failedStage =
    state === 'failed'
      ? (status.failure?.stage ?? status.current_stage ?? STAGE_NAMES[0])
      : null

  const stages = STAGE_NAMES.map((id): ComparisonStage => {
    const shown = STAGE_STATES[rowOf(id)]
    if (id === failedStage) return { id, status: 'failed' }
    if (shown === 'failed' && running) return { id, status: 'waiting' }
    if (shown === 'running' && failedStage !== null)
      return { id, status: 'waiting' }
    return { id, status: shown }
  })

  let currentStage = status.current_stage
  if (running && currentStage !== null && rowOf(currentStage) === 'failed')
    currentStage = STAGE_NAMES[STAGE_NAMES.indexOf(currentStage) - 1] ?? null

  return {
    id: String(status.comparison_id),
    state,
    currentStage,
    stages,
    notComparableReason: status.not_comparable_reason,
    failure:
      state === 'failed' && status.failure && failedStage
        ? {
            stage: failedStage,
            code: status.failure.error_code,
            retry: retryOf(status.failure),
          }
        : null,
  }
}

function readRegion(value: unknown, path: string): ComparisonRegionView {
  const region = readObject(value, path)
  return {
    region_id: region.integer('region_id'),
    type: region.oneOf('type', REGION_TYPES),
    start_ms: region.integer('start_ms'),
    end_ms: region.integer('end_ms'),
    performance_start_ms: region.integer('performance_start_ms'),
    performance_end_ms: region.integer('performance_end_ms'),
    reason: region.nullable('reason', readString),
    is_checked: region.boolean('is_checked'),
  }
}

export function readComparisonResult(data: unknown): ComparisonResultResponse {
  const result = readObject(data)
  const tempo = result.nullableObject('overall_tempo')
  return {
    comparison_id: result.integer('comparison_id'),
    status: result.oneOf('status', ['success', 'not_comparable']),
    not_comparable_reason: result.nullable('not_comparable_reason', readString),
    baseline: {
      source: result
        .object('baseline')
        .oneOf('source', ['original_song', 'separated_input']),
    },
    overall_tempo: tempo && { is_slow: tempo.boolean('is_slow') },
    regions: result.array('regions', readRegion),
  }
}

function toRegion(region: ComparisonRegionView): ComparisonRegion {
  return {
    id: String(region.region_id),
    kind: REGION_KINDS[region.type],
    startSeconds: seconds(region.start_ms),
    endSeconds: seconds(region.end_ms),
    performanceStartSeconds: seconds(region.performance_start_ms),
    performanceEndSeconds: seconds(region.performance_end_ms),
    unavailableReason: region.reason,
    checked: region.is_checked,
  }
}

export function toComparisonResult(
  result: ComparisonResultResponse,
): ComparisonResult {
  return {
    comparisonId: String(result.comparison_id),
    state: result.status === 'success' ? 'success' : 'not-comparable',
    notComparableReason: result.not_comparable_reason,
    baseline:
      result.baseline.source === 'original_song'
        ? 'original-song'
        : 'separated-input',
    overallTempo: result.overall_tempo && {
      isSlow: result.overall_tempo.is_slow,
    },
    regions: result.regions.map(toRegion),
  }
}

function readTrack(value: unknown, path: string): ComparisonPlaybackTrack {
  const track = readObject(value, path)
  return {
    type: track.oneOf('type', TRACK_TYPES),
    available: track.boolean('available'),
    url: track.nullable('url', readString),
    offset_ms: track.integer('offset_ms'),
  }
}

export function readComparisonPlayback(
  data: unknown,
): ComparisonPlaybackResponse {
  const playback = readObject(data)
  return {
    comparison_id: playback.integer('comparison_id'),
    is_partial: playback.boolean('is_partial'),
    tracks: playback.array('tracks', readTrack),
    expires_at: playback.string('expires_at'),
  }
}

// A sound plays only with a link. The links stay with the repository, which
// downloads each sound behind loadTrackAudio.
export function playableTrack(
  playback: ComparisonPlaybackResponse,
  kind: PlaybackTrackKind,
): (ComparisonPlaybackTrack & { readonly url: string }) | null {
  const track = playback.tracks.find((item) => item.type === kind)
  return track?.available && track.url !== null
    ? { ...track, url: track.url }
    : null
}

export function toComparisonPlayback(
  playback: ComparisonPlaybackResponse,
): ComparisonPlayback {
  return {
    comparisonId: String(playback.comparison_id),
    isPartial: playback.is_partial,
    tracks: playback.tracks.map((track) => ({
      kind: track.type,
      available: track.available && track.url !== null,
      offsetSeconds: seconds(track.offset_ms),
    })),
  }
}

export function readRegionCheck(data: unknown): RegionCheckResponse {
  const check = readObject(data)
  return {
    region_id: check.integer('region_id'),
    is_checked: check.boolean('is_checked'),
  }
}
