import { useEffect, useRef, useState } from 'react'
import type {
  ConsentChoice,
  DemoScenario,
  SavedConsentChoice,
  WorkspaceInfo,
  WorkspaceSnapshot,
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

export interface UseWorkspaceResult {
  readonly loadState: WorkspaceLoadState
  readonly workspace: WorkspaceInfo | null
  readonly tasks: readonly WorkspaceTask[]
  readonly errorMessage: string | null
  readonly consent: ConsentState
  readonly demoScenario: DemoScenario
  retryLoad(): void
  saveConsent(choice: SavedConsentChoice): Promise<boolean>
}

interface WorkspaceState {
  readonly repository: WorkspaceRepository
  readonly loadVersion: number
  readonly snapshot: WorkspaceSnapshot | null
  readonly loadState: WorkspaceLoadState
  readonly errorMessage: string | null
  readonly consent: ConsentState
}

const emptyTasks: readonly WorkspaceTask[] = []
const initialConsent: ConsentState = {
  choice: 'undecided',
  status: 'idle',
  errorMessage: null,
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
            ? '작업 공간 이용 기간이 끝났어요.'
            : '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.',
          consent: initialConsent,
        })
      },
    )

    return () => {
      controller.abort()
      consentController.current?.abort()
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
        setState((previous) => ({
          ...previous,
          snapshot: null,
          loadState: 'expired',
          consent: initialConsent,
          errorMessage: '작업 공간 이용 기간이 끝났어요.',
        }))
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

  return {
    loadState,
    workspace: snapshot?.workspace ?? null,
    tasks: snapshot?.tasks ?? emptyTasks,
    errorMessage: isCurrentRequest ? state.errorMessage : null,
    consent,
    demoScenario,
    retryLoad: () => setLoadVersion((previous) => previous + 1),
    saveConsent,
  }
}
