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
  reviseTask(
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ): Promise<ReviseTaskResult>
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
  // A changed request hides previous workspace data during the render itself.
  const isCurrentRequest =
    state.repository === repository && state.loadVersion === loadVersion
  const snapshot = isCurrentRequest ? state.snapshot : null
  const loadState = isCurrentRequest ? state.loadState : 'loading'
  const consent = isCurrentRequest ? state.consent : initialConsent

  useEffect(() => {
    const controller = new AbortController()
    const currentGeneration = ++generation.current

    consentController.current?.abort()
    consentController.current = null
    addSongController.current?.abort()
    addSongController.current = null
    createTaskController.current?.abort()
    createTaskController.current = null
    reviseTaskController.current?.abort()
    reviseTaskController.current = null

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
      consentController.current?.abort()
      addSongController.current?.abort()
      createTaskController.current?.abort()
      reviseTaskController.current?.abort()
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
      (song) =>
        setState((previous) =>
          previous.snapshot
            ? {
                ...previous,
                snapshot: {
                  ...previous.snapshot,
                  songs: [...previous.snapshot.songs, song],
                },
              }
            : previous,
        ),
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
      (task) =>
        setState((previous) =>
          previous.snapshot
            ? {
                ...previous,
                loadState: 'success',
                snapshot: {
                  ...previous.snapshot,
                  tasks: [...previous.snapshot.tasks, task],
                },
              }
            : previous,
        ),
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
    const result = await tracked(
      reviseTaskController,
      signal,
      (requestSignal) => repository.reviseTask(taskId, input, requestSignal),
      // The task keeps its place; the list and sidebar show its new state.
      (revised) =>
        setState((previous) =>
          previous.snapshot
            ? {
                ...previous,
                snapshot: {
                  ...previous.snapshot,
                  tasks: previous.snapshot.tasks.map((task) =>
                    task.id === revised.id ? revised : task,
                  ),
                },
              }
            : previous,
        ),
    )
    return result.status === 'done'
      ? { status: 'revised', task: result.value }
      : result
  }

  function markExpired() {
    consentController.current?.abort()
    consentController.current = null
    addSongController.current?.abort()
    addSongController.current = null
    createTaskController.current?.abort()
    createTaskController.current = null
    reviseTaskController.current?.abort()
    reviseTaskController.current = null
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
  }
}
