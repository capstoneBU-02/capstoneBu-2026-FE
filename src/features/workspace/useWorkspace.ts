import { useEffect, useRef, useState } from 'react'
import type {
  ConsentChoice,
  DemoScenario,
  NewSongInput,
  NewTaskInput,
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

  async function addSong(
    input: NewSongInput,
    signal: AbortSignal,
  ): Promise<AddSongResult> {
    if (
      !snapshot ||
      (loadState !== 'success' && loadState !== 'empty') ||
      addSongController.current ||
      signal.aborted
    ) {
      return { status: 'cancelled' }
    }

    const controller = new AbortController()
    const currentGeneration = generation.current
    const cancel = () => controller.abort()
    addSongController.current = controller
    signal.addEventListener('abort', cancel, { once: true })
    const isStale = () =>
      controller.signal.aborted || currentGeneration !== generation.current

    try {
      const song = await repository.addSong(input, controller.signal)
      if (isStale()) return { status: 'cancelled' }
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
      )
      return { status: 'added', song }
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
      if (addSongController.current === controller) {
        addSongController.current = null
      }
    }
  }

  async function createTask(
    input: NewTaskInput,
    signal: AbortSignal,
  ): Promise<CreateTaskResult> {
    if (
      !snapshot ||
      (loadState !== 'success' && loadState !== 'empty') ||
      createTaskController.current ||
      signal.aborted
    ) {
      return { status: 'cancelled' }
    }

    const controller = new AbortController()
    const currentGeneration = generation.current
    const cancel = () => controller.abort()
    createTaskController.current = controller
    signal.addEventListener('abort', cancel, { once: true })
    const isStale = () =>
      controller.signal.aborted || currentGeneration !== generation.current

    try {
      const task = await repository.createTask(input, controller.signal)
      if (isStale()) return { status: 'cancelled' }
      // The first task turns an empty workspace into a listed one.
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
      )
      return { status: 'created', task }
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
      if (createTaskController.current === controller) {
        createTaskController.current = null
      }
    }
  }

  function markExpired() {
    consentController.current?.abort()
    consentController.current = null
    addSongController.current?.abort()
    addSongController.current = null
    createTaskController.current?.abort()
    createTaskController.current = null
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
  }
}
