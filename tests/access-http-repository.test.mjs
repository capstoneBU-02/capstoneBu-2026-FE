import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import { createHttpAccessRepository } from '../src/features/access/httpRepository.ts'
import { ACCESS_ERROR_MESSAGES } from '../src/features/access/model.ts'
import {
  fakeFetch,
  fixtureData,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
  textResponse,
} from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const CODE = 'TESTER-2026-A1B2'
const login = (workspaceId) =>
  jsonResponse(200, { success: true, data: { workspace_id: workspaceId } })
const me = (workspaceId) =>
  jsonResponse(200, { success: true, data: { workspace_id: workspaceId } })
const ME_URL = '/api/v1/workspaces/me'
const invalidInput = (details) =>
  jsonResponse(400, {
    success: false,
    error: { code: 'INVALID_INPUT', message: '잘못된 입력입니다.', details },
  })
const tracks = (items = []) =>
  jsonResponse(200, { success: true, data: { items } })

function repositoryWith(fetch) {
  const client = createHttpClient({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
    fetch,
    createTraceId: () => 'sent-trace',
  })
  return createHttpAccessRepository({ client })
}

function setup(answer) {
  const { fetch, calls } = fakeFetch(answer)
  return { repository: repositoryWith(fetch), calls }
}

async function failureOf(promise) {
  return promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  )
}

test('entering posts the normalized code, checks the session and starts onboarding', async () => {
  const { repository, calls } = setup((url) =>
    url === ME_URL
      ? fixtureResponse(200, 'workspace/me.json')
      : fixtureResponse(200, 'access/tester-login.json'),
  )
  const result = await repository.enter(' tester-2026-a1b2 ', signal())

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/api/v1/auth/tester-login')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(calls[0].init.body), { tester_code: CODE })
  // The cookie the login set comes back before the notice and consent.
  assert.equal(calls[1].url, ME_URL)
  assert.equal(calls[1].init.method, 'GET')
  assert.equal(calls[1].init.credentials, 'same-origin')
  assert.deepEqual(result, {
    sessionId: '42',
    workspace: { id: '42', name: '내 작업', testerCode: CODE },
    consentChoice: 'undecided',
    noticeAcknowledged: false,
    onboardingCompleted: false,
  })
})

for (const [name, answer, code] of [
  [
    'an unknown, expired or revoked code',
    () => fixtureResponse(401, 'access/tester-code-not-found.json'),
    'invalid',
  ],
  [
    'a code without the server prefix',
    () => fixtureResponse(400, 'access/invalid-code-format.json'),
    'invalid',
  ],
  [
    'a code the server finds too short',
    () => fixtureResponse(400, 'access/tester-code-too-short.json'),
    'invalid',
  ],
  [
    'a body the server cannot read',
    () => invalidInput([{ field: '', message: 'JSON decode error' }]),
    'network',
  ],
  [
    'a body field other than the code',
    () => fixtureResponse(400, 'common/invalid-input.json'),
    'network',
  ],
  [
    'an invalid input without details',
    () => invalidInput(undefined),
    'network',
  ],
  [
    'invalid input details in another shape',
    () => invalidInput({ field: 'tester_code' }),
    'network',
  ],
  [
    'too many attempts',
    () =>
      jsonResponse(429, {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many.' },
      }),
    'limited',
  ],
  // Logging in reads no cookie, so a session refusal is not the session
  // ending.
  [
    'a rejected session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
    'network',
  ],
  [
    'an unauthorized answer',
    () =>
      jsonResponse(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다.' },
      }),
    'network',
  ],
  [
    'a server error',
    () => fixtureResponse(500, 'common/internal-error-no-trace.json'),
    'network',
  ],
  [
    'a proxy error page',
    () => textResponse(502, '<html>Bad Gateway</html>'),
    'network',
  ],
  [
    'no response',
    () => Promise.reject(new TypeError('Failed to fetch')),
    'network',
  ],
  [
    'a changed response',
    () => jsonResponse(200, { success: true, data: { workspace_id: '42' } }),
    'network',
  ],
]) {
  test(`entering turns ${name} into ${code}`, async () => {
    const { repository } = setup(answer)
    const error = await failureOf(repository.enter(CODE, signal()))

    assert.equal(error.name, 'AccessRepositoryError')
    assert.equal(error.code, code)
    assert.equal(error.message, ACCESS_ERROR_MESSAGES[code])
    // The server failure stays behind it for diagnosis.
    assert.ok(apiErrorOf(error) instanceof ApiError)
    assert.throws(() => repository.workspaceFor('42'), {
      code: 'session-expired',
    })
  })
}

// A browser that keeps no cookie, or keeps an older one, fails here before
// the notice and consent.
for (const [name, answer] of [
  [
    'no session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
  ],
  [
    'a server error',
    () => fixtureResponse(500, 'common/internal-error-no-trace.json'),
  ],
  ['no response', () => Promise.reject(new TypeError('Failed to fetch'))],
]) {
  test(`a login whose session check finds ${name} stays at entry`, async () => {
    const { repository } = setup((url) =>
      url === ME_URL ? answer() : login(42),
    )
    const error = await failureOf(repository.enter(CODE, signal()))

    assert.equal(error.code, 'network')
    assert.equal(error.message, ACCESS_ERROR_MESSAGES.network)
    assert.ok(apiErrorOf(error) instanceof ApiError)
    assert.throws(() => repository.workspaceFor('42'), {
      code: 'session-expired',
    })
  })
}

test('a login whose session belongs to another workspace stays at entry with both ids', async () => {
  const { repository } = setup((url) => (url === ME_URL ? me(7) : login(42)))
  const error = await failureOf(repository.enter(CODE, signal()))

  assert.equal(error.code, 'network')
  assert.equal(error.cause.name, 'WorkspaceMismatchError')
  assert.equal(error.cause.expectedWorkspaceId, '42')
  assert.equal(error.cause.receivedWorkspaceId, '7')
  assert.throws(() => repository.workspaceFor('42'), {
    code: 'session-expired',
  })
})

test('a login cancelled during its session check opens no session', async () => {
  const controller = new AbortController()
  const { repository } = setup((url, init) => {
    if (url !== ME_URL) return login(42)
    controller.abort()
    return Promise.reject(init.signal.reason)
  })

  await assert.rejects(repository.enter(CODE, controller.signal), {
    name: 'AbortError',
  })
  assert.throws(() => repository.workspaceFor('42'), {
    code: 'session-expired',
  })
})

test('a cancelled entry stays an AbortError and opens no session', async () => {
  const { fetch } = pendingFetch()
  const repository = repositoryWith(fetch)
  const controller = new AbortController()
  const pending = repository.enter(CODE, controller.signal)
  controller.abort()

  await assert.rejects(pending, { name: 'AbortError' })
  assert.throws(() => repository.workspaceFor('42'), {
    code: 'session-expired',
  })
})

test('notice and onboarding are kept per workspace while the page is open', async () => {
  let workspaceId = 42
  const { repository, calls } = setup(() => login(workspaceId))
  const first = await repository.enter(CODE, signal())

  const acknowledged = repository.acknowledgeNotice(first.sessionId)
  assert.equal(acknowledged.noticeAcknowledged, true)
  assert.equal(acknowledged.onboardingCompleted, false)
  const completed = await repository.completeOnboarding(
    first.sessionId,
    'accepted',
    signal(),
  )
  assert.equal(completed.consentChoice, 'accepted')
  assert.equal(completed.onboardingCompleted, true)
  // Onboarding has no API yet, so it sends nothing after the login and its
  // session check.
  assert.equal(calls.length, 2)

  const again = await repository.enter(CODE.toLowerCase(), signal())
  assert.deepEqual(again, completed)

  workspaceId = 7
  const other = await repository.enter('TESTER-BBBB-0002', signal())
  assert.equal(other.sessionId, '7')
  assert.equal(other.consentChoice, 'undecided')
  assert.equal(other.noticeAcknowledged, false)
  assert.equal(other.onboardingCompleted, false)
})

test('putting off the choice completes onboarding without a consent', async () => {
  const { repository } = setup(() => login(42))
  const { sessionId } = await repository.enter(CODE, signal())
  const result = await repository.completeOnboarding(
    sessionId,
    'undecided',
    signal(),
  )
  assert.equal(result.consentChoice, 'undecided')
  assert.equal(result.onboardingCompleted, true)
})

test('the workspace sees the consent chosen at onboarding and keeps changes', async () => {
  const { repository } = setup((url) => {
    if (url.endsWith('/workspaces/me')) return me(42)
    if (url.endsWith('/tracks')) return tracks()
    return login(42)
  })
  const { sessionId } = await repository.enter(CODE, signal())
  await repository.completeOnboarding(sessionId, 'declined', signal())

  const workspace = repository.workspaceFor(sessionId)
  const snapshot = await workspace.loadWorkspace(signal())
  assert.equal(snapshot.consentChoice, 'declined')
  assert.deepEqual(snapshot.workspace, {
    id: '42',
    name: '내 작업',
    testerCode: CODE,
  })

  await workspace.saveConsent('accepted', signal())
  const again = await repository.enter(CODE, signal())
  assert.equal(again.consentChoice, 'accepted')
})

test('songs uploaded on this page stay with their workspace when the code is entered again', async () => {
  const { repository } = setup((url) => {
    if (url.endsWith('/workspaces/me')) return me(42)
    if (url.endsWith('/tracks/upload'))
      return fixtureResponse(201, 'workspace/track-upload.json')
    // The server lists the uploaded song, which has no sections yet.
    if (url.endsWith('/tracks'))
      return tracks([
        { ...fixtureData('workspace/track-upload.json'), segment_count: 0 },
      ])
    return login(42)
  })
  const first = await repository.enter(CODE, signal())
  const file = new File(['audio'], 'take.mp3', { type: 'audio/mpeg' })
  await repository
    .workspaceFor(first.sessionId)
    .addSong({ file, inputKind: 'original', durationSeconds: 1 }, signal())

  const again = await repository.enter(CODE, signal())
  const workspace = repository.workspaceFor(again.sessionId)
  const snapshot = await workspace.loadWorkspace(signal())
  assert.deepEqual(
    snapshot.songs.map((song) => song.id),
    ['7'],
  )
  assert.equal(await workspace.loadSongAudio('7', signal()), file)
})

test('a cancelled onboarding is not completed', async () => {
  const { repository } = setup(() => login(42))
  const { sessionId } = await repository.enter(CODE, signal())
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    repository.completeOnboarding(sessionId, 'accepted', controller.signal),
    { name: 'AbortError' },
  )
  const again = await repository.enter(CODE, signal())
  assert.equal(again.consentChoice, 'undecided')
  assert.equal(again.onboardingCompleted, false)
})

test('an unknown session is reported as expired', async () => {
  const { repository } = setup(() => login(42))
  const expired = { code: 'session-expired' }
  assert.throws(() => repository.workspaceFor('42'), expired)
  assert.throws(() => repository.acknowledgeNotice('42'), expired)
  await assert.rejects(
    repository.completeOnboarding('42', 'accepted', signal()),
    expired,
  )
})
