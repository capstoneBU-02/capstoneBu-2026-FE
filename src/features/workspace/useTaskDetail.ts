import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { isTaskInProgress } from './format.ts'
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
  // The last background refresh failed, so the shown state may be old.
  readonly refreshFailed: boolean
  retry(): void
  // Loads the shown task again at once, keeping it on screen meanwhile, as
  // after a change made from it. 'failed' keeps the old copy on screen.
  reload(): Promise<'loaded' | 'failed' | 'cancelled'>
}

export interface TaskDetailOptions {
  // Expiry is reported so the whole workspace can close.
  readonly onExpired: () => void
  // Every task received, from the first load and each refresh.
  readonly onLoaded?: (detail: TaskDetail) => void
  // While the task is queued or processing, it is loaded again after this
  // long. null keeps the first load only.
  readonly refreshMs?: number | null
}

interface TaskDetailRequest {
  readonly repository: WorkspaceRepository
  readonly taskId: string | null
  readonly version: number
}

interface TaskDetailState extends TaskDetailRequest {
  readonly status: Exclude<TaskDetailStatus, 'idle' | 'loading'>
  readonly detail: TaskDetail | null
  readonly refreshFailed: boolean
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

function settledState(
  request: TaskDetailRequest,
  status: TaskDetailState['status'],
  detail: TaskDetail | null,
): TaskDetailState {
  return { ...request, status, detail, refreshFailed: false }
}

// Task detail is fetched per task, separately from the workspace list.
export function useTaskDetail(
  repository: WorkspaceRepository,
  taskId: string | null,
  { onExpired, onLoaded, refreshMs = null }: TaskDetailOptions,
): UseTaskDetailResult {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<TaskDetailState | null>(null)
  const request: TaskDetailRequest = { repository, taskId, version }
  const [previousRequest, setPreviousRequest] = useState(request)
  const generation = useRef(0)
  const reloadController = useRef<AbortController | null>(null)
  const reportExpired = useEffectEvent(onExpired)
  const reportLoaded = useEffectEvent((detail: TaskDetail) =>
    onLoaded?.(detail),
  )
  // Each request starts empty. Without this, reopening a task (A → home → A,
  // or A → B → A) would show A's earlier result until the new one arrives.
  if (!sameRequest(previousRequest, request)) {
    setPreviousRequest(request)
    setState(null)
  }
  const isCurrent =
    state !== null && taskId !== null && sameRequest(state, request)
  const shouldRefresh =
    refreshMs !== null &&
    isCurrent &&
    state.detail !== null &&
    isTaskInProgress(state.detail.task)

  useEffect(() => {
    if (taskId === null) return
    const settled = { repository, taskId, version }
    const controller = new AbortController()
    const currentGeneration = ++generation.current
    const isStale = () =>
      controller.signal.aborted || currentGeneration !== generation.current

    repository.loadTask(taskId, controller.signal).then(
      (detail) => {
        if (isStale()) return
        setState(settledState(settled, 'success', detail))
        reportLoaded(detail)
      },
      (error: unknown) => {
        if (isStale()) return
        const status = failureStatus(error)
        setState(settledState(settled, status, null))
        if (status === 'expired') reportExpired()
      },
    )

    return () => {
      controller.abort()
      reloadController.current?.abort()
      reloadController.current = null
    }
  }, [repository, taskId, version])

  // Refreshes stop when the task finishes, the view changes or the tab is
  // hidden; a hidden tab catches up as soon as it is shown again.
  useEffect(() => {
    if (!shouldRefresh || taskId === null || refreshMs === null) return
    const id = taskId
    const delay = refreshMs
    const settled = { repository, taskId, version }
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | null = null
    let stopped = false
    const isThisRequest = (
      other: TaskDetailState | null,
    ): other is TaskDetailState => other !== null && sameRequest(other, settled)

    function scheduleNext() {
      if (!stopped && !document.hidden) timer = setTimeout(refresh, delay)
    }
    function pause() {
      clearTimeout(timer)
      timer = undefined
      controller?.abort()
      controller = null
    }
    function refresh() {
      timer = undefined
      const current = new AbortController()
      controller = current
      const isLate = () => stopped || current.signal.aborted
      repository.loadTask(id, current.signal).then(
        (detail) => {
          if (isLate()) return
          controller = null
          setState(settledState(settled, 'success', detail))
          reportLoaded(detail)
          // A finished task ends this effect, which clears the timer.
          scheduleNext()
        },
        (error: unknown) => {
          if (isLate()) return
          controller = null
          const status = failureStatus(error)
          if (status === 'error') {
            // Keep the task on screen and try again on the next turn. A
            // failure in a row keeps the same state, so nothing re-renders.
            setState((previous) =>
              isThisRequest(previous) && !previous.refreshFailed
                ? { ...previous, refreshFailed: true }
                : previous,
            )
            scheduleNext()
            return
          }
          setState(settledState(settled, status, null))
          if (status === 'expired') reportExpired()
        },
      )
    }
    function followVisibility() {
      if (document.hidden) pause()
      else if (timer === undefined && controller === null) refresh()
    }

    document.addEventListener('visibilitychange', followVisibility)
    scheduleNext()
    return () => {
      stopped = true
      pause()
      document.removeEventListener('visibilitychange', followVisibility)
    }
  }, [shouldRefresh, repository, taskId, version, refreshMs])

  async function reload() {
    if (!isCurrent || taskId === null) return 'cancelled'
    const settled = request
    const controller = new AbortController()
    reloadController.current?.abort()
    reloadController.current = controller
    const keep = (next: TaskDetailState) =>
      setState((previous) =>
        previous !== null && sameRequest(previous, settled) ? next : previous,
      )
    try {
      const detail = await repository.loadTask(taskId, controller.signal)
      if (controller.signal.aborted) return 'cancelled'
      keep(settledState(settled, 'success', detail))
      onLoaded?.(detail)
      return 'loaded'
    } catch (error) {
      if (controller.signal.aborted) return 'cancelled'
      const status = failureStatus(error)
      if (status === 'error') {
        setState((previous) =>
          previous !== null && sameRequest(previous, settled)
            ? { ...previous, refreshFailed: true }
            : previous,
        )
        return 'failed'
      }
      keep(settledState(settled, status, null))
      if (status === 'expired') onExpired()
      return 'loaded'
    } finally {
      if (reloadController.current === controller)
        reloadController.current = null
    }
  }

  return {
    status: taskId === null ? 'idle' : isCurrent ? state.status : 'loading',
    detail: isCurrent ? state.detail : null,
    refreshFailed: isCurrent ? state.refreshFailed : false,
    retry: () => setVersion((previous) => previous + 1),
    reload,
  }
}
