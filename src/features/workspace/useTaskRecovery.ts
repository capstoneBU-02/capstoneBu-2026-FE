import { useEffect, useRef, useState } from 'react'
import type { WorkspaceTask } from './model.ts'
import type { UseTaskDetailResult } from './useTaskDetail.ts'
import type { UseWorkspaceResult } from './useWorkspace.ts'

interface TaskRecoveryOptions {
  readonly workspace: UseWorkspaceResult
  readonly taskDetail: UseTaskDetailResult
  // The task the user is looking at, if any.
  readonly openTaskId: string | null
  // The stopped task was still open; the page leaves it.
  readonly onStopped: (task: WorkspaceTask) => void
  // The retried task is on screen; its 다시 시도 button is gone.
  readonly onRetried: () => void
}

export interface UseTaskRecoveryResult {
  // The task whose 멈추기 is waiting for the repository.
  readonly stoppingTaskId: string | null
  stop(task: WorkspaceTask): Promise<'stopped' | 'failed' | 'cancelled'>
  retry(taskId: string): Promise<'retried' | 'failed' | 'cancelled'>
}

// 멈추기 and 다시 시도 from an open task. Leaving the task does not cancel
// either request: the server acts on it anyway, so the list must follow.
// The workspace allows one request of each kind at a time.
export function useTaskRecovery({
  workspace,
  taskDetail,
  openTaskId,
  onStopped,
  onRetried,
}: TaskRecoveryOptions): UseTaskRecoveryResult {
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null)
  const openTask = useRef(openTaskId)

  useEffect(() => {
    openTask.current = openTaskId
  }, [openTaskId])

  async function stop(task: WorkspaceTask) {
    // One stop at a time, so the one still running keeps its busy dialog.
    if (stoppingTaskId !== null) return 'failed'
    setStoppingTaskId(task.id)
    const result = await workspace.cancelTask(
      task.id,
      new AbortController().signal,
    )
    // A refused stop may mean the task finished meanwhile. The dialog waits
    // for the task as it is now: one that ended takes 멈추기 away.
    if (result.status === 'failed' && openTask.current === task.id)
      await taskDetail.reload()
    setStoppingTaskId(null)
    if (result.status === 'canceled') {
      if (openTask.current === task.id) onStopped(task)
      return 'stopped'
    }
    return result.status === 'failed' ? 'failed' : 'cancelled'
  }

  async function retry(taskId: string) {
    const result = await workspace.retryTask(
      taskId,
      new AbortController().signal,
    )
    if (result.status === 'expired' || result.status === 'cancelled')
      return 'cancelled'
    if (openTask.current !== taskId)
      return result.status === 'retried' ? 'retried' : 'failed'
    // Either way the task changed or may have: load it again in place. A
    // failed reload after a retry opens the task afresh, so the old failure
    // never stays on screen with its 다시 시도.
    const reloaded = await taskDetail.reload()
    if (result.status === 'failed') return 'failed'
    if (reloaded === 'failed') taskDetail.retry()
    if (reloaded !== 'cancelled') onRetried()
    return 'retried'
  }

  return { stoppingTaskId, stop, retry }
}
