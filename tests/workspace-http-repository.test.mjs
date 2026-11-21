import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import {
  readTrackUpload,
  readWorkspaceMe,
  toWorkspaceSong,
} from '../src/features/workspace/adapter.ts'
import {
  createHttpWorkspaceRepository,
  createPageSongs,
} from '../src/features/workspace/httpRepository.ts'
import {
  fakeFetch,
  fixtureData,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
  readFixture,
  textResponse,
} from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const WORKSPACE = { id: '42', name: '내 작업', testerCode: 'TESTER-2026-A1B2' }

function setup(
  answer,
  initialChoice = 'undecided',
  { songs = createPageSongs(), createXhr } = {},
) {
  const { fetch, calls } =
    typeof answer === 'function' ? fakeFetch(answer) : answer
  let choice = initialChoice
  const saved = []
  const repository = createHttpWorkspaceRepository({
    client: createHttpClient({
      baseUrl: '/api/v1',
      credentials: 'same-origin',
      fetch,
      createXhr,
    }),
    workspace: WORKSPACE,
    songs,
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
    [() => repository.createTask({}, signal()), 'create-task-failed'],
    [() => repository.reviseTask('1', {}, signal()), 'revise-task-failed'],
    [() => repository.cancelTask('1', signal()), 'cancel-task-failed'],
    [() => repository.retryTask('1', signal()), 'retry-task-failed'],
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

test('an uploaded track becomes a song named after its file', () => {
  const track = readTrackUpload(fixtureData('workspace/track-upload.json'))
  assert.deepEqual(track, {
    track_id: 7,
    filename: '봄날 커버 v2.mp3',
    duration_ms: 213480,
    is_separated_stem: false,
  })
  assert.deepEqual(toWorkspaceSong(track), {
    id: '7',
    name: '봄날 커버 v2',
    fileName: '봄날 커버 v2.mp3',
    inputKind: 'original',
    durationSeconds: 213.48,
  })
  assert.equal(
    toWorkspaceSong({ ...track, is_separated_stem: true }).inputKind,
    'separated-guitar',
  )
  assert.throws(() => readTrackUpload({ ...track, track_id: '7' }), {
    name: 'ResponseShapeError',
    path: 'data.track_id',
  })
  assert.throws(() => readTrackUpload({ ...track, duration_ms: 1.5 }), {
    path: 'data.duration_ms',
  })
})

const songInput = (overrides = {}) => ({
  file: new File(['audio'], '봄날 커버 v2.mp3', { type: '' }),
  inputKind: 'original',
  durationSeconds: 213.4,
  ...overrides,
})

function uploadAnswer(onUpload = () => {}) {
  return (url, init) => {
    if (url === '/api/v1/workspaces/me')
      return fixtureResponse(200, 'workspace/me.json')
    onUpload(init)
    return fixtureResponse(201, 'workspace/track-upload.json')
  }
}

test('adding a song uploads the file and its kind as a form', async () => {
  const { repository, calls } = setup(uploadAnswer())
  const input = songInput({ inputKind: 'separated-guitar' })
  const song = await repository.addSong(input, signal())

  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url, '/api/v1/tracks/upload')
  assert.equal(init.method, 'POST')
  assert.ok(init.body instanceof FormData)
  assert.deepEqual([...init.body.keys()], ['file', 'is_separated_stem'])
  const sent = init.body.get('file')
  assert.equal(sent.name, '봄날 커버 v2.mp3')
  // The server accepts only its own list of types.
  assert.equal(sent.type, 'audio/mpeg')
  assert.equal(await sent.text(), 'audio')
  assert.equal(init.body.get('is_separated_stem'), 'true')

  // The server's answer names the song, including its measured length.
  assert.equal(song.id, '7')
  assert.equal(song.durationSeconds, 213.48)

  const original = await repository.addSong(songInput(), signal())
  assert.equal(calls[1].init.body.get('is_separated_stem'), 'false')
  assert.equal(original.id, '7')
})

test('songs added on this page are listed and play from the chosen file', async () => {
  const songs = createPageSongs()
  const { repository } = setup(uploadAnswer(), 'undecided', { songs })
  const input = songInput()
  const song = await repository.addSong(input, signal())

  const snapshot = await repository.loadWorkspace(signal())
  assert.deepEqual(snapshot.songs, [song])
  snapshot.songs[0].name = 'changed'
  assert.equal(
    (await repository.loadWorkspace(signal())).songs[0].name,
    '봄날 커버 v2',
  )
  assert.equal(await repository.loadSongAudio('7', signal()), input.file)

  // The same workspace opened again on this page keeps them.
  const reopened = setup(uploadAnswer(), 'undecided', { songs }).repository
  assert.equal((await reopened.loadWorkspace(signal())).songs.length, 1)

  await assert.rejects(repository.loadSongAudio('8', signal()), {
    name: 'WorkspaceRepositoryError',
    code: 'audio-unavailable',
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(repository.loadSongAudio('7', controller.signal), {
    name: 'AbortError',
  })
})

test('upload progress reaches the caller when it asks for it', async () => {
  const xhrs = []
  const createXhr = () => {
    const xhr = {
      upload: {},
      open() {},
      setRequestHeader() {},
      send(body) {
        xhr.sent = body
        xhr.upload.onprogress({ loaded: 1, total: 4, lengthComputable: true })
        xhr.upload.onload()
        xhr.status = 201
        xhr.responseText = JSON.stringify(
          readFixture('workspace/track-upload.json'),
        )
        xhr.onload()
      },
      abort() {},
    }
    xhrs.push(xhr)
    return xhr
  }
  const { repository, calls } = setup(
    () => assert.fail('no fetch'),
    'undecided',
    { createXhr },
  )
  const progress = []
  const song = await repository.addSong(songInput(), signal(), (percent) =>
    progress.push(percent),
  )
  assert.deepEqual(progress, [25, 100])
  assert.equal(song.id, '7')
  assert.equal(xhrs[0].sent.get('file').type, 'audio/mpeg')
  assert.equal(calls.length, 0)
})

for (const [name, answer, code] of [
  [
    'an unreadable file',
    () => fixtureResponse(400, 'workspace/upload-unsupported-format.json'),
    'song-unsupported',
  ],
  [
    'a file longer than the limit',
    () => fixtureResponse(400, 'workspace/upload-duration-exceeded.json'),
    'song-too-long',
  ],
  [
    'a file larger than the limit',
    () => fixtureResponse(413, 'workspace/upload-file-too-large.json'),
    'song-too-large',
  ],
  [
    'a body a proxy refuses',
    () => textResponse(413, '<html>Request Entity Too Large</html>'),
    'song-too-large',
  ],
  [
    'a full workspace',
    () => fixtureResponse(413, 'workspace/upload-storage-limit.json'),
    'storage-full',
  ],
  [
    'a rejected session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
    'expired',
  ],
  [
    'a malformed form',
    () => fixtureResponse(400, 'common/invalid-input.json'),
    'add-song-failed',
  ],
  [
    'a server error',
    () => fixtureResponse(500, 'common/internal-error-no-trace.json'),
    'add-song-failed',
  ],
  [
    'no response',
    () => Promise.reject(new TypeError('Failed to fetch')),
    'add-song-failed',
  ],
  [
    'a changed response',
    () => jsonResponse(201, { success: true, data: { track_id: 7 } }),
    'add-song-failed',
  ],
]) {
  test(`${name} refuses the song as ${code} and lists nothing`, async () => {
    const { repository } = setup((url) =>
      url === '/api/v1/workspaces/me'
        ? fixtureResponse(200, 'workspace/me.json')
        : answer(),
    )
    const error = await failureOf(repository.addSong(songInput(), signal()))
    assert.equal(error.name, 'WorkspaceRepositoryError')
    assert.equal(error.code, code)
    assert.ok(apiErrorOf(error) instanceof ApiError)
    assert.deepEqual((await repository.loadWorkspace(signal())).songs, [])
  })
}

test('a cancelled upload stays an AbortError', async () => {
  const { repository } = setup(pendingFetch())
  const controller = new AbortController()
  const pending = repository.addSong(songInput(), controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
