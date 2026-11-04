import type { ConsentChoice } from '../workspace/model.ts'
import type { WorkspaceRepository } from '../workspace/repository.ts'
import type { AccessFailure, AccessResult } from './model.ts'

export interface AccessRepository {
  enter(code: string, signal: AbortSignal): Promise<AccessResult>
  workspaceFor(sessionId: string): WorkspaceRepository
  acknowledgeNotice(sessionId: string): AccessResult
  completeOnboarding(
    sessionId: string,
    choice: ConsentChoice,
    signal: AbortSignal,
  ): Promise<AccessResult>
}

export class AccessRepositoryError extends Error {
  readonly code: AccessFailure

  constructor(code: AccessFailure, message: string) {
    super(message)
    this.name = 'AccessRepositoryError'
    this.code = code
  }
}
