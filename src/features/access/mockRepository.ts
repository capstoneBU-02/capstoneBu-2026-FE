import { DEMO_ACCESS_CODES } from '../../app/demoConfig.ts'
import type { ConsentChoice, WorkspaceInfo } from '../workspace/model.ts'
import { createMockWorkspaceRepository } from '../workspace/mockRepository.ts'
import type { WorkspaceRepository } from '../workspace/repository.ts'
import {
  ACCESS_ERROR_MESSAGES,
  type AccessResult,
  type AccessScenario,
} from './model.ts'
import { AccessRepositoryError, type AccessRepository } from './repository.ts'

interface MockAccessRecord {
  readonly workspace: WorkspaceInfo
  readonly repository: WorkspaceRepository
  consentChoice: ConsentChoice
  noticeAcknowledged: boolean
  onboardingCompleted: boolean
}

function waitForRequest(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 300)

    function abort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function createMockAccessRepository(
  scenario: AccessScenario = 'default',
): AccessRepository {
  // The code lookup and all session state live only in this app's memory.
  // This allowlist is a demo fixture, not a real code format or auth policy.
  const records = new Map<string, MockAccessRecord>()
  const sessions = new Map<string, MockAccessRecord>()
  let nextSessionId = 0
  let shouldLimitNextEntry = scenario === 'limited'

  function addRecord(code: string, id: string, returning: boolean) {
    const workspace = { id, name: '내 작업', testerCode: code }
    const record: MockAccessRecord = {
      workspace,
      consentChoice: returning ? 'declined' : 'undecided',
      noticeAcknowledged: returning,
      onboardingCompleted: returning,
      repository: createMockWorkspaceRepository(
        scenario === 'consent-error' ? 'consent-error' : 'default',
        {
          workspace,
          ...(returning ? {} : { tasks: [] }),
          consentChoice: returning ? 'declined' : 'undecided',
          onConsentSaved: (choice) => {
            record.consentChoice = choice
          },
        },
      ),
    }
    records.set(code, record)
  }

  addRecord(DEMO_ACCESS_CODES.newWorkspace, 'workspace-new', false)
  addRecord(DEMO_ACCESS_CODES.returningWorkspace, 'workspace-returning', true)
  addRecord(DEMO_ACCESS_CODES.secondWorkspace, 'workspace-second', false)

  function getRecord(sessionId: string) {
    const record = sessions.get(sessionId)
    if (!record) {
      throw new AccessRepositoryError(
        'session-expired',
        ACCESS_ERROR_MESSAGES['session-expired'],
      )
    }
    return record
  }

  function snapshot(sessionId: string, record: MockAccessRecord): AccessResult {
    return {
      sessionId,
      workspace: { ...record.workspace },
      consentChoice: record.consentChoice,
      noticeAcknowledged: record.noticeAcknowledged,
      onboardingCompleted: record.onboardingCompleted,
    }
  }

  return {
    async enter(code, signal) {
      await waitForRequest(signal)
      const record = records.get(code.trim())
      if (!record) {
        throw new AccessRepositoryError(
          'invalid',
          ACCESS_ERROR_MESSAGES.invalid,
        )
      }
      if (shouldLimitNextEntry) {
        shouldLimitNextEntry = false
        throw new AccessRepositoryError(
          'limited',
          ACCESS_ERROR_MESSAGES.limited,
        )
      }
      if (
        scenario !== 'default' &&
        scenario !== 'consent-error' &&
        scenario !== 'limited' &&
        scenario !== 'session-expired'
      ) {
        throw new AccessRepositoryError(
          scenario,
          ACCESS_ERROR_MESSAGES[scenario],
        )
      }
      const sessionId = `mock-session-${++nextSessionId}`
      sessions.set(sessionId, record)
      return snapshot(sessionId, record)
    },
    workspaceFor(sessionId) {
      return getRecord(sessionId).repository
    },
    acknowledgeNotice(sessionId) {
      const record = getRecord(sessionId)
      record.noticeAcknowledged = true
      return snapshot(sessionId, record)
    },
    async completeOnboarding(sessionId, choice, signal) {
      const record = getRecord(sessionId)
      signal.throwIfAborted()
      if (choice !== 'undecided') {
        await record.repository.saveConsent(choice, signal)
      }
      // A late/cancelled save cannot mark the onboarding as complete.
      signal.throwIfAborted()
      record.onboardingCompleted = true
      return snapshot(sessionId, record)
    },
  }
}
