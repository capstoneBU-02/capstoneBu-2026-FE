import { ApiError, isSessionRejected, type HttpClient } from '../../api/http.ts'
import { createHttpWorkspaceRepository } from '../workspace/httpRepository.ts'
import type { ConsentChoice, WorkspaceInfo } from '../workspace/model.ts'
import type { WorkspaceRepository } from '../workspace/repository.ts'
import {
  normalizeTesterCode,
  readTesterLogin,
  toWorkspaceInfo,
} from './adapter.ts'
import type { TesterLoginRequest } from './apiTypes.ts'
import {
  ACCESS_ERROR_MESSAGES,
  type AccessFailure,
  type AccessResult,
} from './model.ts'
import { AccessRepositoryError, type AccessRepository } from './repository.ts'

// What the server does not keep yet. Remembered per workspace while this page
// is open, so a reload asks for the notice and consent again.
interface Onboarding {
  readonly consentChoice: ConsentChoice
  readonly noticeAcknowledged: boolean
  readonly onboardingCompleted: boolean
}

interface Session {
  readonly workspace: WorkspaceInfo
  readonly repository: WorkspaceRepository
}

const NEW_ONBOARDING: Onboarding = {
  consentChoice: 'undecided',
  noticeAcknowledged: false,
  onboardingCompleted: false,
}

const INVALID_CODES: ReadonlySet<string> = new Set([
  'TESTER_CODE_NOT_FOUND',
  'INVALID_CODE_FORMAT',
  'INVALID_INPUT',
])

// The server answers unknown, expired and revoked codes alike, so the
// code-expired and revoked messages do not appear in http mode.
function enterFailure(error: unknown): AccessFailure {
  if (isSessionRejected(error)) return 'session-expired'
  if (!(error instanceof ApiError)) return 'network'
  if (INVALID_CODES.has(error.code)) return 'invalid'
  if (error.code === 'RATE_LIMIT_EXCEEDED') return 'limited'
  return 'network'
}

function sessionExpired() {
  return new AccessRepositoryError(
    'session-expired',
    ACCESS_ERROR_MESSAGES['session-expired'],
  )
}

export function createHttpAccessRepository({
  client,
}: {
  client: HttpClient
}): AccessRepository {
  // The cookie is the real session; a session id here is the workspace id.
  const sessions = new Map<string, Session>()
  const onboardings = new Map<string, Onboarding>()

  function sessionOf(sessionId: string) {
    const session = sessions.get(sessionId)
    if (!session) throw sessionExpired()
    return session
  }

  function onboardingOf(workspaceId: string) {
    return onboardings.get(workspaceId) ?? NEW_ONBOARDING
  }

  function updateOnboarding(workspaceId: string, change: Partial<Onboarding>) {
    onboardings.set(workspaceId, { ...onboardingOf(workspaceId), ...change })
  }

  function resultOf(sessionId: string): AccessResult {
    const { workspace } = sessionOf(sessionId)
    return {
      sessionId,
      workspace: { ...workspace },
      ...onboardingOf(workspace.id),
    }
  }

  return {
    async enter(code, signal) {
      const testerCode = normalizeTesterCode(code)
      const body: TesterLoginRequest = { tester_code: testerCode }
      let workspace: WorkspaceInfo
      try {
        const { data } = await client.request('POST', '/auth/tester-login', {
          signal,
          json: body,
          read: readTesterLogin,
        })
        workspace = toWorkspaceInfo(data, testerCode)
      } catch (error) {
        if (signal.aborted) throw error
        const failure = enterFailure(error)
        throw new AccessRepositoryError(
          failure,
          ACCESS_ERROR_MESSAGES[failure],
          { cause: error },
        )
      }
      const workspaceId = workspace.id
      sessions.set(workspaceId, {
        workspace,
        repository: createHttpWorkspaceRepository({
          client,
          workspace,
          consent: {
            read: () => onboardingOf(workspaceId).consentChoice,
            save: (choice) =>
              updateOnboarding(workspaceId, { consentChoice: choice }),
          },
        }),
      })
      return resultOf(workspaceId)
    },
    workspaceFor(sessionId) {
      return sessionOf(sessionId).repository
    },
    acknowledgeNotice(sessionId) {
      const { workspace } = sessionOf(sessionId)
      updateOnboarding(workspace.id, { noticeAcknowledged: true })
      return resultOf(sessionId)
    },
    async completeOnboarding(sessionId, choice, signal) {
      const { workspace, repository } = sessionOf(sessionId)
      signal.throwIfAborted()
      if (choice !== 'undecided') await repository.saveConsent(choice, signal)
      // A cancelled save cannot mark the onboarding as complete.
      signal.throwIfAborted()
      updateOnboarding(workspace.id, { onboardingCompleted: true })
      return resultOf(sessionId)
    },
  }
}
