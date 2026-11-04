import { useEffect, useRef, useState } from 'react'
import type { ConsentChoice } from '../workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../workspace/repository.ts'
import {
  ACCESS_ERROR_MESSAGES,
  type AccessResult,
  type AccessStatus,
} from './model.ts'
import { AccessRepositoryError, type AccessRepository } from './repository.ts'

export interface AccessSession extends AccessResult {
  readonly repository: WorkspaceRepository
}

interface AccessState {
  readonly repository: AccessRepository
  readonly code: string
  readonly stage: 'entry' | 'notice' | 'consent' | 'workspace'
  readonly status: AccessStatus
  readonly onboardingStatus: 'idle' | 'saving' | 'error'
  readonly notice: 'expired' | null
  readonly errorMessage: string | null
  readonly session: AccessSession | null
}

function initialState(
  repository: AccessRepository,
  notice: 'expired' | null = null,
): AccessState {
  return {
    repository,
    code: '',
    stage: 'entry',
    status: 'idle',
    onboardingStatus: 'idle',
    notice,
    errorMessage: null,
    session: null,
  }
}

export function useAccess(
  repository: AccessRepository,
  initialNotice: 'expired' | null = null,
) {
  const [state, setState] = useState(() =>
    initialState(repository, initialNotice),
  )
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  // A replaced repository must never render a previous workspace or input.
  const current =
    state.repository === repository ? state : initialState(repository)

  useEffect(() => {
    generation.current += 1
    return () => {
      generation.current += 1
      request.current?.abort()
      request.current = null
    }
  }, [repository])

  function returnToEntry(notice: 'expired' | null = null) {
    generation.current += 1
    request.current?.abort()
    request.current = null
    setState(initialState(repository, notice))
  }

  function changeCode(code: string) {
    if (current.stage !== 'entry' || request.current) return
    setState({ ...current, code, status: 'idle', errorMessage: null })
  }

  async function submit() {
    if (current.stage !== 'entry' || request.current) return false
    if (!current.code.trim()) {
      setState({
        ...current,
        status: 'invalid',
        errorMessage: ACCESS_ERROR_MESSAGES.invalid,
      })
      return false
    }
    const controller = new AbortController()
    const version = generation.current
    request.current = controller
    setState({ ...current, status: 'submitting', errorMessage: null })

    try {
      const result = await repository.enter(current.code, controller.signal)
      if (controller.signal.aborted || version !== generation.current)
        return false
      const session = {
        ...result,
        repository: repository.workspaceFor(result.sessionId),
      }
      setState({
        ...initialState(repository),
        session,
        stage: result.onboardingCompleted
          ? 'workspace'
          : result.noticeAcknowledged
            ? 'consent'
            : 'notice',
      })
      return true
    } catch (error) {
      if (controller.signal.aborted || version !== generation.current)
        return false
      const code =
        error instanceof AccessRepositoryError ? error.code : 'network'
      if (code === 'session-expired') {
        returnToEntry('expired')
      } else {
        setState({
          ...current,
          status: code === 'network' ? 'error' : code,
          errorMessage: ACCESS_ERROR_MESSAGES[code],
        })
      }
      return false
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  function acknowledge() {
    if (current.stage === 'notice' && current.session && !request.current) {
      try {
        const result = repository.acknowledgeNotice(current.session.sessionId)
        setState({
          ...current,
          stage: 'consent',
          session: { ...result, repository: current.session.repository },
        })
      } catch {
        returnToEntry('expired')
      }
    }
  }

  async function choose(choice: ConsentChoice) {
    if (current.stage !== 'consent' || !current.session || request.current)
      return false
    const controller = new AbortController()
    const version = generation.current
    request.current = controller
    setState({ ...current, onboardingStatus: 'saving', errorMessage: null })
    try {
      const result = await repository.completeOnboarding(
        current.session.sessionId,
        choice,
        controller.signal,
      )
      if (controller.signal.aborted || version !== generation.current)
        return false
      setState({
        ...current,
        stage: 'workspace',
        onboardingStatus: 'idle',
        errorMessage: null,
        session: { ...result, repository: current.session.repository },
      })
      return true
    } catch (error) {
      if (controller.signal.aborted || version !== generation.current)
        return false
      if (
        (error instanceof AccessRepositoryError &&
          error.code === 'session-expired') ||
        (error instanceof WorkspaceRepositoryError && error.code === 'expired')
      ) {
        returnToEntry('expired')
      } else {
        setState({
          ...current,
          onboardingStatus: 'error',
          errorMessage:
            '선택을 저장하지 못했어요. 다시 시도하거나 나중에 정할 수 있어요.',
        })
      }
      return false
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  return { ...current, changeCode, submit, acknowledge, choose, returnToEntry }
}
