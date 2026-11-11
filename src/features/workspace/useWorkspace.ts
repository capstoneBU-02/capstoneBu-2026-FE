import { useEffect, useRef, useState, type RefObject } from 'react'
import type {
  ConsentChoice,
  DemoScenario,
  NewSongInput,
  NewTaskInput,
  ReviseTaskInput,
  SavedConsentChoice,
  WorkspaceInfo,
  WorkspaceSnapshot,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'
import {
  mergeRefreshedList,
  sameFields,
  upserted,
  type ListChanges,
} from './listMerge.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

type WorkspaceLoadState = 'loading' | 'error' | 'expired' | 'empty' | 'success'

interface ConsentState {
  readonly choice: ConsentChoice
  readonly status: 'idle' | 'saving' | 'error'
  readonly errorMessage: string | null
}

export type AddSongResult =
  | { readonly status: 'added'; readonly song: WorkspaceSong }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export type CreateTaskResult =
  | { readonly status: 'created'; readonly task: WorkspaceTask }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export type ReviseTaskResult =
  | { readonly status: 'revised'; readonly task: WorkspaceTask }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export type CancelTaskResult = {
  readonly status: 'canceled' | 'failed' | 'expired' | 'cancelled'
}

export type RetryTaskResult =
  | { readonly status: 'retried'; readonly task: WorkspaceTask }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export type ListRefreshResult = 'loaded' | 'failed' | 'expired' | 'cancelled'

type RequestOutcome<T> =
  | { readonly status: 'done'; readonly value: T }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export interface UseWorkspaceResult {
  readonly loadState: WorkspaceLoadState
  readonly workspace: WorkspaceInfo | null
  readonly songs: readonly WorkspaceSong[]
  readonly tasks: readonly WorkspaceTask[]
  readonly errorMessage: string | null
  readonly consent: ConsentState
  readonly demoScenario: DemoScenario
  retryLoad(): void
  // Another request (e.g. a task) found the session expired.
  markExpired(): void
  clearConsentError(): void
  saveConsent(choice: SavedConsentChoice): Promise<boolean>
  // The caller's signal cancels the request, e.g. when its dialog unmounts.
  addSong(input: NewSongInput, signal: AbortSignal): Promise<AddSongResult>
  createTask(
    input: NewTaskInput,
    signal: AbortSignal,
  ): Promise<CreateTaskResult>
  // Leaving does not cancel 구간 수정: the server acts on it anyway, so the
  // list takes its result. The caller's signal only ends its wait, with
  // 'cancelled'. One sent earlier and still running refuses this one.
  reviseTask(
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ): Promise<ReviseTaskResult>
  // 멈추기 takes the task off the list once the repository has stopped it.
  cancelTask(taskId: string, signal: AbortSignal): Promise<CancelTaskResult>
  retryTask(taskId: string, signal: AbortSignal): Promise<RetryTaskResult>
  // A task loaded on its own screen updates the same task in the list.
  syncTask(task: WorkspaceTask): void
  // Loads the list again behind the shown one, which stays on screen
  // meanwhile and after a failure. One runs at a time.
  refreshList(signal: AbortSignal): Promise<ListRefreshResult>
}

interface WorkspaceState {
  readonly repository: WorkspaceRepository
  readonly loadVersion: number
  readonly snapshot: WorkspaceSnapshot | null
  readonly loadState: WorkspaceLoadState
  readonly errorMessage: string | null
  readonly consent: ConsentState
}

const EXPIRED_MESSAGE = '작업 공간 이용 기간이 끝났어요.'
const emptySongs: readonly WorkspaceSong[] = []
const emptyTasks: readonly WorkspaceTask[] = []
const initialConsent: ConsentState = {
  choice: 'undecided',
  status: 'idle',
  errorMessage: null,
}

function abortAll(slots: readonly RefObject<AbortController | null>[]) {
  for (const slot of slots) {
    slot.current?.abort()
    slot.current = null
  }
}

function withTasks(
  previous: WorkspaceState,
  change: (tasks: readonly WorkspaceTask[]) => readonly WorkspaceTask[],
): WorkspaceState {
  return previous.snapshot
    ? {
        ...previous,
        snapshot: {
          ...previous.snapshot,
          tasks: change(previous.snapshot.tasks),
        },
      }
    : previous
}

// The task keeps its place; the list and sidebar show its new state.
function replacedTask(previous: WorkspaceState, changed: WorkspaceTask) {
  return withTasks(previous, (tasks) =>
    tasks.map((task) => (task.id === changed.id ? changed : task)),
  )
}

// A refreshed list that turns up the first task, or loses the last one,
// moves the workspace between its listed and empty states.
function refreshedState(
  previous: WorkspaceState,
  loaded: WorkspaceSnapshot,
  changed: ListChanges,
): WorkspaceState {
  if (!previous.snapshot) return previous
  const snapshot = mergeRefreshedList(previous.snapshot, loaded, changed)
  return snapshot === previous.snapshot
    ? previous
    : {
        ...previous,
        snapshot,
        loadState: snapshot.tasks.length === 0 ? 'empty' : 'success',
      }
}

// Expiry hides every piece of workspace data, whichever request found it.
function expiredState(previous: WorkspaceState): WorkspaceState {
  return {
    ...previous,
    snapshot: null,
    loadState: 'expired',
    consent: initialConsent,
    errorMessage: EXPIRED_MESSAGE,
  }
}

export function useWorkspace(
  repository: WorkspaceRepository,
  demoScenario: DemoScenario = 'default',
): UseWorkspaceResult {
  const [loadVersion, setLoadVersion] = useState(0)
  const [state, setState] = useState<WorkspaceState>({
    repository,
    loadVersion: 0,
    snapshot: null,
    loadState: 'loading',
    errorMessage: null,
    consent: initialConsent,
  })
  const generation = useRef(0)
  const consentController = useRef<AbortController | null>(null)
  const addSongController = useRef<AbortController | null>(null)
  const createTaskController = useRef<AbortController | null>(null)
  const reviseTaskController = useRef<AbortController | null>(null)
  const cancelTaskController = useRef<AbortController | null>(null)
  const retryTaskController = useRef<AbortController | null>(null)
  const listRefreshController = useRef<AbortController | null>(null)
  // A new load or expiry ends every request; their results change nothing.
  const requestSlots = useRef([
    consentController,
    addSongController,
    createTaskController,
    reviseTaskController,
    cancelTaskController,
    retryTaskController,
    listRefreshController,
  ])
  // What this tab changes while a list refresh is on its way; null when
  // none is. The refreshed list may predate those changes.
  const refreshChanges = useRef<{
    tasks: Set<string>
    songs: Set<string>
  } | null>(null)
  // A changed request hides previous workspace data during the render itself.
  const isCurrentRequest =
    state.repository === repository && state.loadVersion === loadVersion
  const snapshot = isCurrentRequest ? state.snapshot : null
  const loadState = isCurrentRequest ? state.loadState : 'loading'
  const consent = isCurrentRequest ? state.consent : initialConsent

  useEffect(() => {
    const controller = new AbortController()
    const currentGeneration = ++generation.current
    const slots = requestSlots.current
    abortAll(slots)

    repository.loadWorkspace(controller.signal).then(
      (nextSnapshot) => {
        if (
          controller.signal.aborted ||
          currentGeneration !== generation.current
        ) {
          return
        }

        setState({
          repository,
          loadVersion,
          snapshot: nextSnapshot,
          loadState: nextSnapshot.tasks.length === 0 ? 'empty' : 'success',
          errorMessage: null,
          consent: {
            choice: nextSnapshot.consentChoice,
            status: 'idle',
            errorMessage: null,
          },
        })
      },
      (error: unknown) => {
        if (
          controller.signal.aborted ||
          currentGeneration !== generation.current
        ) {
          return
        }

        const expired =
          error instanceof WorkspaceRepositoryError && error.code === 'expired'
        setState({
          repository,
          loadVersion,
          snapshot: null,
          loadState: expired ? 'expired' : 'error',
          errorMessage: expired
            ? EXPIRED_MESSAGE
            : '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.',
          consent: initialConsent,
        })
      },
    )

    return () => {
      controller.abort()
      abortAll(slots)
    }
  }, [repository, loadVersion])

  async function saveConsent(choice: SavedConsentChoice) {
    if (
      !snapshot ||
      (loadState !== 'success' && loadState !== 'empty') ||
      consentController.current
    ) {
      return false
    }

    const controller = new AbortController()
    const currentGeneration = generation.current
    consentController.current = controller
    setState((previous) => ({
      ...previous,
      consent: { ...previous.consent, status: 'saving', errorMessage: null },
    }))

    try {
      const savedChoice = await repository.saveConsent(
        choice,
        controller.signal,
      )

      if (
        controller.signal.aborted ||
        currentGeneration !== generation.current
      ) {
        return false
      }

      setState((previous) => ({
        ...previous,
        consent: { choice: savedChoice, status: 'idle', errorMessage: null },
      }))
      return true
    } catch (error) {
      if (
        controller.signal.aborted ||
        currentGeneration !== generation.current
      ) {
        return false
      }

      if (
        error instanceof WorkspaceRepositoryError &&
        error.code === 'expired'
      ) {
        setState(expiredState)
      } else {
        setState((previous) => ({
          ...previous,
          consent: {
            ...previous.consent,
            status: 'error',
            errorMessage:
              '선택을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
          },
        }))
      }

      return false
    } finally {
      if (consentController.current === controller) {
        consentController.current = null
      }
    }
  }

  // One request of each kind at a time. The caller's signal, a new workspace
  // load or expiry cancels it, and a cancelled request changes nothing.
  async function tracked<T>(
    slot: RefObject<AbortController | null>,
    signal: AbortSignal,
    send: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
  ): Promise<RequestOutcome<T>> {
    if (
      !snapshot ||
      (loadState !== 'success' && loadState !== 'empty') ||
      slot.current ||
      signal.aborted
    ) {
      return { status: 'cancelled' }
    }

    const controller = new AbortController()
    const currentGeneration = generation.current
    const cancel = () => controller.abort()
    slot.current = controller
    signal.addEventListener('abort', cancel, { once: true })
    const isStale = () =>
      controller.signal.aborted || currentGeneration !== generation.current

    try {
      const value = await send(controller.signal)
      if (isStale()) return { status: 'cancelled' }
      apply(value)
      return { status: 'done', value }
    } catch (error) {
      if (isStale()) return { status: 'cancelled' }
      if (
        error instanceof WorkspaceRepositoryError &&
        error.code === 'expired'
      ) {
        markExpired()
        return { status: 'expired' }
      }
      return { status: 'failed' }
    } finally {
      signal.removeEventListener('abort', cancel)
      if (slot.current === controller) {
        slot.current = null
      }
    }
  }

  async function addSong(
    input: NewSongInput,
    signal: AbortSignal,
  ): Promise<AddSongResult> {
    const result = await tracked(
      addSongController,
      signal,
      (requestSignal) => repository.addSong(input, requestSignal),
      (song) => {
        refreshChanges.current?.songs.add(song.id)
        setState((previous) =>
          previous.snapshot
            ? {
                ...previous,
                snapshot: {
                  ...previous.snapshot,
                  songs: upserted(previous.snapshot.songs, song),
                },
              }
            : previous,
        )
      },
    )
    return result.status === 'done'
      ? { status: 'added', song: result.value }
      : result
  }

  async function createTask(
    input: NewTaskInput,
    signal: AbortSignal,
  ): Promise<CreateTaskResult> {
    const result = await tracked(
      createTaskController,
      signal,
      (requestSignal) => repository.createTask(input, requestSignal),
      // The first task turns an empty workspace into a listed one.
      (task) => {
        refreshChanges.current?.tasks.add(task.id)
        setState((previous) =>
          previous.snapshot
            ? {
                ...previous,
                loadState: 'success',
                snapshot: {
                  ...previous.snapshot,
                  tasks: upserted(previous.snapshot.tasks, task),
                },
              }
            : previous,
        )
      },
    )
    return result.status === 'done'
      ? { status: 'created', task: result.value }
      : result
  }

  async function reviseTask(
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ): Promise<ReviseTaskResult> {
    if (signal.aborted) return { status: 'cancelled' }
    if (reviseTaskController.current) return { status: 'failed' }
    const result = await tracked(
      reviseTaskController,
      new AbortController().signal,
      (requestSignal) => repository.reviseTask(taskId, input, requestSignal),
      (revised) => {
        refreshChanges.current?.tasks.add(revised.id)
        setState((previous) => replacedTask(previous, revised))
      },
    )
    if (signal.aborted) return { status: 'cancelled' }
    return result.status === 'done'
      ? { status: 'revised', task: result.value }
      : result
  }

  async function cancelTask(
    taskId: string,
    signal: AbortSignal,
  ): Promise<CancelTaskResult> {
    // Another task's stop is still running; this one is refused, not lost.
    if (cancelTaskController.current) return { status: 'failed' }
    const result = await tracked(
      cancelTaskController,
      signal,
      // A task already gone, as when another tab stopped it, has stopped.
      (requestSignal) =>
        repository.cancelTask(taskId, requestSignal).catch((error) => {
          if (
            error instanceof WorkspaceRepositoryError &&
            error.code === 'task-unavailable'
          )
            return
          throw error
        }),
      // The last task leaves the workspace empty, as before the first one.
      () => {
        refreshChanges.current?.tasks.add(taskId)
        setState((previous) => {
          const next = withTasks(previous, (tasks) =>
            tasks.filter((task) => task.id !== taskId),
          )
          return next.snapshot?.tasks.length === 0
            ? { ...next, loadState: 'empty' }
            : next
        })
      },
    )
    return result.status === 'done' ? { status: 'canceled' } : result
  }

  async function retryTask(
    taskId: string,
    signal: AbortSignal,
  ): Promise<RetryTaskResult> {
    if (retryTaskController.current) return { status: 'failed' }
    const result = await tracked(
      retryTaskController,
      signal,
      (requestSignal) => repository.retryTask(taskId, requestSignal),
      (retried) => {
        refreshChanges.current?.tasks.add(retried.id)
        setState((previous) => replacedTask(previous, retried))
      },
    )
    return result.status === 'done'
      ? { status: 'retried', task: result.value }
      : result
  }

  function syncTask(loaded: WorkspaceTask) {
    refreshChanges.current?.tasks.add(loaded.id)
    setState((previous) => {
      const listed = previous.snapshot?.tasks.find(
        (task) => task.id === loaded.id,
      )
      // An unchanged task keeps the list as it is, without a new render.
      if (!previous.snapshot || !listed || sameFields(listed, loaded))
        return previous
      return replacedTask(previous, loaded)
    })
  }

  async function refreshList(signal: AbortSignal): Promise<ListRefreshResult> {
    const changes = { tasks: new Set<string>(), songs: new Set<string>() }
    const result = await tracked(
      listRefreshController,
      signal,
      (requestSignal) => {
        refreshChanges.current = changes
        return repository.loadWorkspace(requestSignal)
      },
      (loaded) =>
        setState((previous) => refreshedState(previous, loaded, changes)),
    )
    if (refreshChanges.current === changes) refreshChanges.current = null
    return result.status === 'done' ? 'loaded' : result.status
  }

  function markExpired() {
    abortAll(requestSlots.current)
    setState(expiredState)
  }

  function clearConsentError() {
    setState((previous) =>
      previous.consent.status === 'error'
        ? {
            ...previous,
            consent: {
              ...previous.consent,
              status: 'idle',
              errorMessage: null,
            },
          }
        : previous,
    )
  }

  return {
    loadState,
    workspace: snapshot?.workspace ?? null,
    songs: snapshot?.songs ?? emptySongs,
    tasks: snapshot?.tasks ?? emptyTasks,
    errorMessage: isCurrentRequest ? state.errorMessage : null,
    consent,
    demoScenario,
    retryLoad: () => setLoadVersion((previous) => previous + 1),
    markExpired,
    clearConsentError,
    saveConsent,
    addSong,
    createTask,
    reviseTask,
    cancelTask,
    retryTask,
    syncTask,
    refreshList,
  }
}
