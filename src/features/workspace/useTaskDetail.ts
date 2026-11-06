import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { TaskDetail } from './model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

export type TaskDetailStatus =
  'idle' | 'loading' | 'success' | 'unavailable' | 'error' | 'expired'

export interface UseTaskDetailResult {
  readonly status: TaskDetailStatus
  readonly detail: TaskDetail | null
  retry(): void
}

interface TaskDetailRequest {
  readonly repository: WorkspaceRepository
  readonly taskId: string | null
  readonly version: number
}

interface TaskDetailState extends TaskDetailRequest {
  readonly status: Exclude<TaskDetailStatus, 'idle' | 'loading'>
  readonly detail: TaskDetail | null
}

function sameRequest(a: TaskDetailRequest, b: TaskDetailRequest) {
  return (
    a.repository === b.repository &&
    a.taskId === b.taskId &&
    a.version === b.version
  )
}

function failureStatus(error: unknown): TaskDetailState['status'] {
  if (!(error instanceof WorkspaceRepositoryError)) return 'error'
  if (error.code === 'expired') return 'expired'
  return error.code === 'task-unavailable' ? 'unavailable' : 'error'
}

// Task detail is fetched per task, separately from the workspace list.
// Expiry is reported through onExpired so the whole workspace can close.
export function useTaskDetail(
  repository: WorkspaceRepository,
  taskId: string | null,
  onExpired: () => void,
): UseTaskDetailResult {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<TaskDetailState | null>(null)
  const request: TaskDetailRequest = { repository, taskId, version }
  const [previousRequest, setPreviousRequest] = useState(request)
  const generation = useRef(0)
  const reportExpired = useEffectEvent(onExpired)
  // Each request starts empty. Without this, reopening a task (A → home → A,
  // or A → B → A) would show A's earlier result until the new one arrives.
  if (!sameRequest(previousRequest, request)) {
    setPreviousRequest(request)
    setState(null)
  }
  const isCurrent =
    state !== null && taskId !== null && sameRequest(state, request)

  useEffect(() => {
    if (taskId === null) return
    const controller = new AbortController()
    const currentGeneration = ++generation.current
    const isStale = () =>
      controller.signal.aborted || currentGeneration !== generation.current

    repository.loadTask(taskId, controller.signal).then(
      (detail) => {
        if (isStale()) return
        setState({ repository, taskId, version, status: 'success', detail })
      },
      (error: unknown) => {
        if (isStale()) return
        const status = failureStatus(error)
        setState({ repository, taskId, version, status, detail: null })
        if (status === 'expired') reportExpired()
      },
    )

    return () => controller.abort()
  }, [repository, taskId, version])

  return {
    status: taskId === null ? 'idle' : isCurrent ? state.status : 'loading',
    detail: isCurrent ? state.detail : null,
    retry: () => setVersion((previous) => previous + 1),
  }
}
