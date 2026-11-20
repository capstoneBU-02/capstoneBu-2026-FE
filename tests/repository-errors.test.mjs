import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf } from '../src/api/http.ts'
import { AccessRepositoryError } from '../src/features/access/repository.ts'
import { ComparisonRepositoryError } from '../src/features/comparison/repository.ts'
import { WorkspaceRepositoryError } from '../src/features/workspace/repository.ts'

const failure = new ApiError({
  status: 401,
  code: 'UNAUTHORIZED_SESSION',
  message: '워크스페이스 세션이 없거나 만료되었습니다.',
  traceId: '5f0c2a9e41b7d3c8',
})

test('repository errors keep the server failure for diagnosis, not for the screen', () => {
  const errors = [
    new AccessRepositoryError('session-expired', '다시 입력해 주세요.', {
      cause: failure,
    }),
    new WorkspaceRepositoryError('expired', '다시 입력해 주세요.', {
      cause: failure,
    }),
    new ComparisonRepositoryError('expired', { cause: failure }),
  ]
  for (const error of errors) {
    assert.equal(error.cause, failure)
    assert.equal(apiErrorOf(error)?.code, 'UNAUTHORIZED_SESSION')
    assert.equal(apiErrorOf(error)?.traceId, '5f0c2a9e41b7d3c8')
    assert.doesNotMatch(error.message, /UNAUTHORIZED_SESSION|5f0c2a9e/)
  }
  assert.equal(
    errors[2].message,
    new ComparisonRepositoryError('expired').message,
  )
})

test('mock errors still work without a cause', () => {
  const errors = [
    new AccessRepositoryError('invalid', 'x'),
    new WorkspaceRepositoryError('load-failed', 'x'),
    new ComparisonRepositoryError('save-failed'),
  ]
  for (const error of errors) {
    assert.equal(error.cause, undefined)
    assert.equal(apiErrorOf(error), null)
  }
})
