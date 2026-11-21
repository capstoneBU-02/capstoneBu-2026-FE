// What the mock repository does in a server's place: the wait of a request
// and the tries a failed task has left. The checks a server repeats and the
// result it keeps on 구간 수정 are in taskLabels.ts.

import { failsAgainOnRetry } from './format.ts'
import type { TaskRetry, WorkspaceTask } from './model.ts'

// JOB-05, D12: three retries after the first run.
const RETRY_LIMIT = 3

// A failed task that a retry could fix can be sent again until its tries run
// out.
export function mockRetryOf(
  task: WorkspaceTask,
  used: number,
): TaskRetry | null {
  if (task.processingStatus !== 'failed' || failsAgainOnRetry(task)) return null
  return { left: Math.max(RETRY_LIMIT - used, 0), limit: RETRY_LIMIT }
}

export function waitForMockRequest(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)

    function abort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
    }

    signal.addEventListener('abort', abort, { once: true })
  })
}
