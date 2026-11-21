import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import { readWorkspaceMe } from '../src/features/workspace/adapter.ts'
import { createHttpWorkspaceRepository } from '../src/features/workspace/httpRepository.ts'
import {
  fakeFetch,
  fixtureData,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
} from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const WORKSPACE = { id: '42', name: '내 작업', testerCode: 'TESTER-2026-A1B2' }

function setup(answer, initialChoice = 'undecided') {
  const { fetch, calls } =
    typeof answer === 'function' ? fakeFetch(answer) : answer
  let choice = initialChoice
  const saved = []
  const repository = createHttpWorkspaceRepository({
    client: createHttpClient({
      baseUrl: '/api/v1',
      credentials: 'same-origin',
      fetch,
    }),
    workspace: WORKSPACE,
    consent: {
      read: () => choice,
      save: (next) => {
        choice = next
        saved.push(next)
      },
    },
  })
  return { repository, calls, saved }
}

async function failureOf(promise) {
  return promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  )
}

test('the session check reads only the workspace id', () => {
  assert.deepEqual(readWorkspaceMe(fixtureData('workspace/me.json')), {
    workspace_id: 42,
  })
  assert.throws(() => readWorkspaceMe({ workspace_id: '42' }), {
    name: 'ResponseShapeError',
    path: 'data.workspace_id',
  })
})

test('opening the workspace checks the session and starts empty', async () => {
  const { repository, calls } = setup(
    () => fixtureResponse(200, 'workspace/me.json'),
    'declined',
  )
  const snapshot = await repository.loadWorkspace(signal())

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/v1/workspaces/me')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.body, undefined)
  assert.deepEqual(snapshot, {
    workspace: WORKSPACE,
    songs: [],
    tasks: [],
    consentChoice: 'declined',
  })
})

for (const [name, answer] of [
  [
    'a rejected session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
  ],
  [
    'a session that belongs to another workspace',
    () => jsonResponse(200, { success: true, data: { workspace_id: 7 } }),
  ],
]) {
  test(`${name} ends the workspace as expired`, async () => {
    const { repository } = setup(answer)
    const error = await failureOf(repository.loadWorkspace(signal()))
    assert.equal(error.name, 'WorkspaceRepositoryError')
    assert.equal(error.code, 'expired')
  })
}

test('a rejected session keeps the server failure behind it', async () => {
  const { repository } = setup(() =>
    fixtureResponse(401, 'common/unauthorized-session.json'),
  )
  const error = await failureOf(repository.loadWorkspace(signal()))
  assert.equal(apiErrorOf(error)?.traceId, '5f0c2a9e41b7d3c8')
})

for (const [name, answer] of [
  [
    'a server error',
    () => fixtureResponse(500, 'common/internal-error-no-trace.json'),
  ],
  ['no response', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['a changed response', () => jsonResponse(200, { success: true, data: {} })],
]) {
  test(`${name} leaves the workspace retryable`, async () => {
    const { repository } = setup(answer)
    const error = await failureOf(repository.loadWorkspace(signal()))
    assert.equal(error.code, 'load-failed')
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a cancelled load stays an AbortError', async () => {
  const { repository } = setup(pendingFetch())
  const controller = new AbortController()
  const pending = repository.loadWorkspace(controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('consent is kept on this device and sends nothing', async () => {
  const { repository, calls, saved } = setup(() => assert.fail('no request'))
  assert.equal(await repository.saveConsent('accepted', signal()), 'accepted')
  assert.deepEqual(saved, ['accepted'])

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(repository.saveConsent('declined', controller.signal), {
    name: 'AbortError',
  })
  assert.deepEqual(saved, ['accepted'])
  assert.equal(calls.length, 0)
})

test('features without an API yet fail with their own code and send nothing', async () => {
  const { repository, calls } = setup(() => assert.fail('no request'))
  for (const [call, code] of [
    [() => repository.loadTask('1', signal()), 'task-unavailable'],
    [() => repository.addSong({}, signal()), 'add-song-failed'],
    [() => repository.createTask({}, signal()), 'create-task-failed'],
    [() => repository.reviseTask('1', {}, signal()), 'revise-task-failed'],
    [() => repository.cancelTask('1', signal()), 'cancel-task-failed'],
    [() => repository.retryTask('1', signal()), 'retry-task-failed'],
    [() => repository.loadSongAudio('1', signal()), 'audio-unavailable'],
    [() => repository.loadSeparatedAudio('1', signal()), 'audio-unavailable'],
    [() => repository.loadTab('1', signal()), 'tab-unavailable'],
    [
      () => repository.saveCopyStatus('1', true, signal()),
      'copy-status-failed',
    ],
  ]) {
    await assert.rejects(call(), { name: 'WorkspaceRepositoryError', code })
  }
  assert.equal(calls.length, 0)
})
