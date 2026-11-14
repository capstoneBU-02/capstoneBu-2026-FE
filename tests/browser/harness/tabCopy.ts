import { mockTabInput } from '../../../src/features/workspace/mockTab.ts'
import type { WorkspaceTask } from '../../../src/features/workspace/model.ts'
import { WorkspaceRepositoryError } from '../../../src/features/workspace/repository.ts'
import type { TestControls } from './controls.ts'
import { copiedTask, findTask, scenario } from './server.ts'

// The tab and 카피 완료 requests of the test page. pending-tab and
// pending-copy hold their requests until a test settles them; otherwise
// they answer at once from the test server.

const tabCalls: Array<{ taskId: string; signal: AbortSignal }> = []
const pendingTabs: Array<{
  taskId: string
  resolve: (tab: unknown) => void
  reject: (error: Error) => void
}> = []

const copyCalls: Array<{
  taskId: string
  confirmed: boolean
  signal: AbortSignal
}> = []
const pendingCopies: Array<{
  taskId: string
  confirmed: boolean
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

// The tab a finished task has on the server, as the mock repository makes.
function serverTab(taskId: string): unknown {
  const task = findTask(taskId)
  if (!task)
    throw new WorkspaceRepositoryError('task-unavailable', 'Unavailable')
  if (task.processingStatus !== 'completed')
    throw new WorkspaceRepositoryError('tab-unavailable', 'No tab yet')
  return mockTabInput(
    task.tuningId,
    task.rangeEndSeconds - task.rangeStartSeconds,
  )
}

function settled<T>(step: () => T): Promise<T> {
  try {
    return Promise.resolve(step())
  } catch (error) {
    return Promise.reject(error)
  }
}

export function loadTab(taskId: string, signal: AbortSignal): Promise<unknown> {
  tabCalls.push({ taskId, signal })
  if (scenario === 'pending-tab')
    return new Promise((resolve, reject) =>
      pendingTabs.push({ taskId, resolve, reject }),
    )
  return settled(() => serverTab(taskId))
}

export function saveCopyStatus(
  taskId: string,
  confirmed: boolean,
  signal: AbortSignal,
): Promise<WorkspaceTask> {
  copyCalls.push({ taskId, confirmed, signal })
  if (scenario === 'pending-copy')
    return new Promise((resolve, reject) =>
      pendingCopies.push({ taskId, confirmed, resolve, reject }),
    )
  return settled(() => copiedTask(taskId, confirmed))
}

// StrictMode may leave an aborted duplicate of a tab request, so each step
// settles every request in its queue.
export const tabCopyControls = {
  tabCalls: () =>
    tabCalls.map(({ taskId, signal }) => ({ taskId, aborted: signal.aborted })),
  resolveTab() {
    pendingTabs.splice(0).forEach(({ taskId, resolve, reject }) => {
      settled(() => serverTab(taskId)).then(resolve, reject)
    })
  },
  resolveTabWithBadFormat() {
    pendingTabs
      .splice(0)
      .forEach(({ resolve }) => resolve({ tuning: [], bars: 'none' }))
  },
  failTab(code) {
    pendingTabs
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Tab failed')),
      )
  },
  copyCalls: () =>
    copyCalls.map(({ taskId, confirmed, signal }) => ({
      taskId,
      confirmed,
      aborted: signal.aborted,
    })),
  resolveCopy() {
    pendingCopies
      .splice(0)
      .forEach(({ taskId, confirmed, resolve, reject }) => {
        settled(() => copiedTask(taskId, confirmed)).then(resolve, reject)
      })
  },
  failCopy(code) {
    pendingCopies
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Copy failed')),
      )
  },
} satisfies Partial<TestControls>
