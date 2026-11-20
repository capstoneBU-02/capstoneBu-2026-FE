import type {
  ComparisonPlayback,
  ComparisonRef,
  ComparisonResult,
  ComparisonStatus,
  NewPerformanceInput,
  PlaybackTrackKind,
  SavedPerformance,
} from './model.ts'

export interface ComparisonRepository {
  // Newest first, including takes from an earlier section (REC-04).
  listPerformances(
    taskId: string,
    signal: AbortSignal,
  ): Promise<readonly SavedPerformance[]>
  // Saving stores the take only; comparing is a separate request.
  savePerformance(
    input: NewPerformanceInput,
    signal: AbortSignal,
  ): Promise<SavedPerformance>
  // A take that already finished returns that comparison instead of a new one.
  // The stages are read with loadStatus, as the API reports them only there.
  requestComparison(
    performanceId: string,
    signal: AbortSignal,
  ): Promise<ComparisonRef>
  loadStatus(
    comparisonId: string,
    signal: AbortSignal,
  ): Promise<ComparisonStatus>
  // Open once the comparison succeeded or found it could not compare.
  loadResult(
    comparisonId: string,
    signal: AbortSignal,
  ): Promise<ComparisonResult>
  loadPlayback(
    comparisonId: string,
    signal: AbortSignal,
  ): Promise<ComparisonPlayback>
  // The bytes of one sound, decoded in the browser for the waveform and
  // playback. Expiring links stay behind this call.
  loadTrackAudio(
    comparisonId: string,
    kind: PlaybackTrackKind,
    signal: AbortSignal,
  ): Promise<Blob>
  markRegion(
    comparisonId: string,
    regionId: string,
    checked: boolean,
    signal: AbortSignal,
  ): Promise<void>
  // Starts again from the stage that failed.
  retry(comparisonId: string, signal: AbortSignal): Promise<ComparisonRef>
}

const ERROR_MESSAGES = {
  expired: '작업 공간 이용 기간이 끝났어요.',
  'task-unavailable': '작업을 찾을 수 없어요.',
  'performance-unavailable': '연주를 찾을 수 없어요.',
  'comparison-unavailable': '비교 결과를 찾을 수 없어요.',
  'region-unavailable': '다시 들어볼 곳을 찾을 수 없어요.',
  'section-changed':
    '구간이 바뀌어 이 연주는 비교할 수 없어요. 다시 녹음해 주세요.',
  'stem-not-ready': '기타 음원이 준비되면 비교할 수 있어요.',
  'comparison-in-progress': '이 연주는 이미 비교하고 있어요.',
  'comparison-not-ready': '비교가 끝나면 결과를 볼 수 있어요.',
  'not-retryable': '이 비교는 다시 시도할 수 없어요.',
  'retry-limit': '다시 시도할 수 있는 횟수를 모두 사용했어요.',
  'invalid-audio': '이 파일은 연주로 사용할 수 없어요.',
  'file-too-large': '파일 용량이 너무 커요.',
  'storage-limit': '저장 공간이 부족해요.',
  'save-failed': '연주를 저장하지 못했어요. 다시 시도해 주세요.',
  'enqueue-failed': '비교를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
  'audio-unavailable': '음원을 불러오지 못했어요.',
} as const

export type ComparisonRepositoryErrorCode = keyof typeof ERROR_MESSAGES

export class ComparisonRepositoryError extends Error {
  readonly code: ComparisonRepositoryErrorCode

  // `cause` keeps the server failure (an ApiError) for diagnosis only.
  constructor(code: ComparisonRepositoryErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options)
    this.name = 'ComparisonRepositoryError'
    this.code = code
  }
}
