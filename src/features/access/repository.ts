import type { ConsentChoice } from '../workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../workspace/repository.ts'
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

  // `cause` keeps the server failure (an ApiError) for diagnosis only.
  constructor(code: AccessFailure, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AccessRepositoryError'
    this.code = code
  }
}

// Onboarding goes through both repositories, and each says so in its own way.
export function isSessionExpired(error: unknown): boolean {
  return (
    (error instanceof AccessRepositoryError &&
      error.code === 'session-expired') ||
    (error instanceof WorkspaceRepositoryError && error.code === 'expired')
  )
}
