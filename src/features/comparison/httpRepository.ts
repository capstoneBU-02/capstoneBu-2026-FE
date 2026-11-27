import {
  apiErrorOf,
  isSessionRejected,
  type HttpClient,
} from '../../api/http.ts'
import { createRemoteFiles, type RemoteFiles } from '../../api/remoteFile.ts'
import { UPLOAD_POLICY } from '../add-song/uploadPolicy.ts'
import { serverTime } from '../workspace/format.ts'
import {
  playableTrack,
  readComparisonCreated,
  readComparisonPlayback,
  readComparisonResult,
  readComparisonRetry,
  readComparisonStatus,
  readPerformanceCreate,
  readPerformanceList,
  readRegionCheck,
  sourceCodeOf,
  toComparisonPlayback,
  toComparisonRef,
  toComparisonResult,
  toComparisonStatus,
  toSavedPerformance,
} from './adapter.ts'
import { performanceUploadFile } from './performanceFile.ts'
import {
  ComparisonRepositoryError,
  type ComparisonRepository,
  type ComparisonRepositoryErrorCode,
} from './repository.ts'

type Refusals = Readonly<Record<string, ComparisonRepositoryErrorCode>>

const LIST_REFUSALS: Refusals = {
  SEGMENT_NOT_FOUND: 'task-unavailable',
}

// The server's reasons for refusing a take. It checks the size, the source,
// an empty file and the format by extension, then the section. HTTP_413 is a
// proxy's own body limit, which arrives without the backend envelope.
const SAVE_REFUSALS: Refusals = {
  FILE_TOO_LARGE: 'file-too-large',
  HTTP_413: 'file-too-large',
  INVALID_INPUT: 'invalid-audio',
  SEGMENT_NOT_FOUND: 'task-unavailable',
}

// A take is compared only against the section it was played on, once its
// guitar is separated, and one comparison at a time.
const REQUEST_REFUSALS: Refusals = {
  PERFORMANCE_NOT_FOUND: 'performance-unavailable',
  SEGMENT_NOT_FOUND: 'task-unavailable',
  SEGMENT_RANGE_MISMATCH: 'section-changed',
  STEM_NOT_READY: 'stem-not-ready',
  COMPARISON_IN_PROGRESS: 'comparison-in-progress',
  JOB_ENQUEUE_FAILED: 'enqueue-failed',
}

const STATUS_REFUSALS: Refusals = {
  COMPARISON_NOT_FOUND: 'comparison-unavailable',
}

// The result and the sounds open once the comparison has finished.
const FINISHED_REFUSALS: Refusals = {
  ...STATUS_REFUSALS,
  COMPARISON_NOT_READY: 'comparison-not-ready',
}

const MARK_REFUSALS: Refusals = {
  ...STATUS_REFUSALS,
  REGION_NOT_FOUND: 'region-unavailable',
}

const RETRY_REFUSALS: Refusals = {
  ...STATUS_REFUSALS,
  COMPARISON_NOT_RETRYABLE: 'not-retryable',
  RETRY_LIMIT_EXCEEDED: 'retry-limit',
  COMPARISON_IN_PROGRESS: 'comparison-in-progress',
  JOB_ENQUEUE_FAILED: 'enqueue-failed',
}

// An error this repository already made passes through, a rejected session
// ends the workspace, a refusal the server names gets its own code, and
// anything else becomes `fallback` with the server failure as its cause.
function failureOf(
  error: unknown,
  refusals: Refusals,
  fallback: ComparisonRepositoryErrorCode,
): ComparisonRepositoryError {
  if (error instanceof ComparisonRepositoryError) return error
  if (isSessionRejected(error))
    return new ComparisonRepositoryError('expired', { cause: error })
  const apiCode = apiErrorOf(error)?.code ?? ''
  // Only codes in the table itself; toString and the like are not refusals.
  const code = Object.hasOwn(refusals, apiCode) ? refusals[apiCode] : fallback
  return new ComparisonRepositoryError(code, { cause: error })
}

// Saving, listing and comparing takes. The server keeps no length, so a take
// saved from this page keeps the one read before upload and a listed take
// from another visit has none. Nor does a listed take name its comparison
// (B14): a comparison opens again only within the page that asked for it.
export function createHttpComparisonRepository({
  client,
  files = createRemoteFiles(),
  clock = () => new Date(),
}: {
  client: HttpClient
  files?: RemoteFiles
  clock?: () => Date
}): ComparisonRepository {
  const durations = new Map<string, number>()

  // A failed call keeps an abort as it is and names any other failure.
  async function attempt<T>(
    signal: AbortSignal,
    refusals: Refusals,
    fallback: ComparisonRepositoryErrorCode,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (signal.aborted) throw error
      throw failureOf(error, refusals, fallback)
    }
  }

  return {
    listPerformances(taskId, signal) {
      return attempt(signal, LIST_REFUSALS, 'list-failed', async () => {
        const { data } = await client.request(
          'GET',
          `/segments/${taskId}/performances`,
          { signal, read: readPerformanceList },
        )
        const now = clock()
        return data.performances.map((performance) =>
          toSavedPerformance(performance, {
            taskId,
            durationSeconds:
              durations.get(String(performance.performance_id)) ?? null,
            now,
          }),
        )
      })
    },
    async savePerformance(input, signal, onProgress) {
      signal.throwIfAborted()
      // The server would read the whole body before refusing it.
      if (input.audio.size > UPLOAD_POLICY.maxFileBytes)
        throw new ComparisonRepositoryError('file-too-large')
      const form = new FormData()
      form.append('audio_file', performanceUploadFile(input))
      form.append('source', sourceCodeOf(input.source))
      return attempt(signal, SAVE_REFUSALS, 'save-failed', async () => {
        const { data } = await client.request(
          'POST',
          `/segments/${input.taskId}/performances`,
          {
            signal,
            form,
            read: readPerformanceCreate,
            onUploadProgress: onProgress,
          },
        )
        const performance = toSavedPerformance(data, {
          taskId: input.taskId,
          durationSeconds: input.durationSeconds,
          now: clock(),
        })
        durations.set(performance.id, input.durationSeconds)
        return performance
      })
    },
    // A take compared before answers with that comparison (200, reused).
    // One still running is refused without its id (B15).
    requestComparison(performanceId, signal) {
      return attempt(signal, REQUEST_REFUSALS, 'enqueue-failed', async () => {
        const { data } = await client.request(
          'POST',
          `/performances/${performanceId}/comparisons`,
          { signal, read: readComparisonCreated },
        )
        return toComparisonRef(data)
      })
    },
    // A status that fails to load is not a comparison that is gone: the
    // session asks again while one runs.
    loadStatus(comparisonId, signal) {
      return attempt(signal, STATUS_REFUSALS, 'load-failed', async () => {
        const { data } = await client.request(
          'GET',
          `/comparisons/${comparisonId}`,
          { signal, read: readComparisonStatus },
        )
        return toComparisonStatus(data)
      })
    },
    loadResult(comparisonId, signal) {
      return attempt(signal, FINISHED_REFUSALS, 'load-failed', async () => {
        const { data } = await client.request(
          'GET',
          `/comparisons/${comparisonId}/result`,
          { signal, read: readComparisonResult },
        )
        return toComparisonResult(data)
      })
    },
    loadPlayback(comparisonId, signal) {
      return attempt(signal, FINISHED_REFUSALS, 'load-failed', async () => {
        const { data } = await client.request(
          'GET',
          `/comparisons/${comparisonId}/playback`,
          { signal, read: readComparisonPlayback },
        )
        return toComparisonPlayback(data)
      })
    },
    // Each sound keeps its own signed link until shortly before it expires;
    // the storage needs CORS for the page's origin (B2).
    loadTrackAudio(comparisonId, kind, signal) {
      return attempt(signal, {}, 'audio-unavailable', () =>
        files.fetch(`comparison-${comparisonId}-${kind}`, signal, async () => {
          const { data } = await client.request(
            'GET',
            `/comparisons/${comparisonId}/playback`,
            { signal, read: readComparisonPlayback },
          )
          const track = playableTrack(data, kind)
          if (!track) throw new ComparisonRepositoryError('audio-unavailable')
          return {
            url: track.url,
            expiresAt: serverTime(data.expires_at) || 0,
          }
        }),
      )
    },
    markRegion(comparisonId, regionId, checked, signal) {
      return attempt(signal, MARK_REFUSALS, 'mark-failed', async () => {
        await client.request(
          'PATCH',
          `/comparisons/${comparisonId}/regions/${regionId}`,
          { signal, json: { is_checked: checked }, read: readRegionCheck },
        )
      })
    },
    // Starts again from the stage that failed; the stages are read again.
    retry(comparisonId, signal) {
      return attempt(signal, RETRY_REFUSALS, 'enqueue-failed', async () => {
        const { data } = await client.request(
          'POST',
          `/comparisons/${comparisonId}/retry`,
          { signal, read: readComparisonRetry },
        )
        return toComparisonRef(data)
      })
    },
  }
}
