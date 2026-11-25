import {
  apiErrorOf,
  isSessionRejected,
  type HttpClient,
} from '../../api/http.ts'
import { UPLOAD_POLICY } from '../add-song/uploadPolicy.ts'
import {
  readPerformanceCreate,
  readPerformanceList,
  sourceCodeOf,
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
  const code = refusals[apiErrorOf(error)?.code ?? ''] ?? fallback
  return new ComparisonRepositoryError(code, { cause: error })
}

async function notConnected(
  code: ComparisonRepositoryErrorCode,
): Promise<never> {
  throw new ComparisonRepositoryError(code)
}

// Saving and listing takes. The server keeps no length, so a take saved from
// this page keeps the one read before upload and a listed take from another
// visit has none. Comparing is not connected yet: each comparison call fails
// with its own code.
export function createHttpComparisonRepository({
  client,
  clock = () => new Date(),
}: {
  client: HttpClient
  clock?: () => Date
}): ComparisonRepository {
  const durations = new Map<string, number>()

  return {
    async listPerformances(taskId, signal) {
      try {
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
      } catch (error) {
        if (signal.aborted) throw error
        throw failureOf(error, LIST_REFUSALS, 'list-failed')
      }
    },
    async savePerformance(input, signal, onProgress) {
      signal.throwIfAborted()
      // The server would read the whole body before refusing it.
      if (input.audio.size > UPLOAD_POLICY.maxFileBytes)
        throw new ComparisonRepositoryError('file-too-large')
      const form = new FormData()
      form.append('audio_file', performanceUploadFile(input))
      form.append('source', sourceCodeOf(input.source))
      try {
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
      } catch (error) {
        if (signal.aborted) throw error
        throw failureOf(error, SAVE_REFUSALS, 'save-failed')
      }
    },
    requestComparison: () => notConnected('enqueue-failed'),
    loadStatus: () => notConnected('comparison-unavailable'),
    loadResult: () => notConnected('comparison-unavailable'),
    loadPlayback: () => notConnected('comparison-unavailable'),
    loadTrackAudio: () => notConnected('audio-unavailable'),
    markRegion: () => notConnected('region-unavailable'),
    retry: () => notConnected('comparison-unavailable'),
  }
}
