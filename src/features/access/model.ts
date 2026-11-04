import type { ConsentChoice, WorkspaceInfo } from '../workspace/model.ts'

// Screen-domain state only; these fields are not an API response contract.
export interface AccessResult {
  readonly sessionId: string
  readonly workspace: WorkspaceInfo
  readonly consentChoice: ConsentChoice
  readonly noticeAcknowledged: boolean
  readonly onboardingCompleted: boolean
}

export type AccessFailure =
  | 'invalid'
  | 'code-expired'
  | 'revoked'
  | 'limited'
  | 'network'
  | 'session-expired'

export type AccessScenario = 'default' | AccessFailure | 'consent-error'

export type AccessStatus =
  | 'idle'
  | 'submitting'
  | 'invalid'
  | 'code-expired'
  | 'revoked'
  | 'limited'
  | 'error'

export const ACCESS_ERROR_MESSAGES: Record<AccessFailure, string> = {
  invalid: '코드를 찾을 수 없어요. 숫자 1과 영문 I를 확인해 주세요.',
  'code-expired': '사용 기간이 지난 코드예요. 운영진에게 문의해 주세요.',
  revoked: '사용이 중지된 코드예요. 운영진에게 문의해 주세요.',
  limited: '코드를 여러 번 잘못 입력했어요. 잠시 후 다시 입력해 주세요.',
  network: '코드를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  'session-expired': '세션이 만료됐어요. 코드를 다시 입력해 주세요.',
}
