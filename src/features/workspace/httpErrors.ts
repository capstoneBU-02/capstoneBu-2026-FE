// How the workspace http repository turns a failed call into the error the
// screens read. Screens act on the code; the message is for logs.

import { isSessionRejected } from '../../api/http.ts'
import { WorkspaceRepositoryError } from './repository.ts'

type FailureCode = WorkspaceRepositoryError['code']

const EXPIRED_MESSAGE = '작업 공간 이용 기간이 끝났어요.'

export function expiredError(cause?: unknown): WorkspaceRepositoryError {
  return new WorkspaceRepositoryError(
    'expired',
    EXPIRED_MESSAGE,
    cause === undefined ? undefined : { cause },
  )
}

// An error this repository already made passes through, a rejected session
// ends the workspace, and anything else becomes `code` with the server
// failure kept as its cause.
export function failureOf(
  code: FailureCode,
  message: string,
  error: unknown,
): WorkspaceRepositoryError {
  if (error instanceof WorkspaceRepositoryError) return error
  if (isSessionRejected(error)) return expiredError(error)
  return new WorkspaceRepositoryError(code, message, { cause: error })
}
