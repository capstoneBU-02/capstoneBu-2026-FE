import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import {
  readTrackList,
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

const ME_URL = '/api/v1/workspaces/me'
const TRACKS_URL = '/api/v1/tracks'
const NO_ITEMS = () => jsonResponse(200, { success: true, data: { items: [] } })

// The session check and the track list answered; anything else by `other`.
function workspaceAnswer(other = () => assert.fail('no other request')) {
  return (url, init) => {
    if (url === ME_URL) return fixtureResponse(200, 'workspace/me.json')
    if (url === TRACKS_URL && (init.method ?? 'GET') === 'GET')
      return NO_ITEMS()
    return other(url, init)
  }
}

test('opening an empty workspace checks the session, then lists its tracks', async () => {
  const { repository, calls } = setup(workspaceAnswer(), 'declined')
  const snapshot = await repository.loadWorkspace(signal())

  assert.deepEqual(
    calls.map(({ url, init }) => [init.method, url, init.body]),
    [
      ['GET', ME_URL, undefined],
      ['GET', TRACKS_URL, undefined],
    ],
  )
  assert.deepEqual(snapshot, {
    workspace: WORKSPACE,
    songs: [],
    tasks: [],
    consentChoice: 'declined',
  })
})

test('a track list reads each track with how many sections it has', () => {
  const { items } = readTrackList(fixtureData('workspace/tracks.json'))
  assert.deepEqual(items[1], {
    track_id: 7,
    filename: '봄날 커버 v2.mp3',
    duration_ms: 213480,
    is_separated_stem: false,
    segment_count: 2,
  })
  assert.deepEqual(
    items.map(({ track_id, segment_count }) => [track_id, segment_count]),
    [
      [9, 0],
      [7, 2],
    ],
  )
  assert.throws(
    () => readTrackList({ items: [{ ...items[0], segment_count: -1 }] }),
    {
      name: 'ResponseShapeError',
      path: 'data.items[0].segment_count',
    },
  )
  assert.throws(() => readTrackList({}), { path: 'data.items' })
})

test('listed tracks become songs in the order they were added, and only tracks with sections are asked for them', async () => {
  const { repository, calls } = setup((url) => {
    if (url === ME_URL) return fixtureResponse(200, 'workspace/me.json')
    if (url === TRACKS_URL) return fixtureResponse(200, 'workspace/tracks.json')
    return NO_ITEMS()
  })
  const { songs } = await repository.loadWorkspace(signal())

  assert.deepEqual(songs, [
    {
      id: '7',
      name: '봄날 커버 v2',
      fileName: '봄날 커버 v2.mp3',
      inputKind: 'original',
      durationSeconds: 213.48,
    },
    {
      id: '9',
      name: '기타 연습',
      fileName: '기타 연습.mp4',
      inputKind: 'separated-guitar',
      durationSeconds: 95.04,
    },
  ])
  assert.deepEqual(
    calls.map(({ url }) => url),
    [ME_URL, TRACKS_URL, '/api/v1/tracks/7/segments'],
  )
})

test('a listed song plays only when it was uploaded from this page', async () => {
  const songs = createPageSongs()
  const file = new File(['audio'], '봄날 커버 v2.mp3')
  songs.add(
    toWorkspaceSong(
      readTrackUpload(fixtureData('workspace/track-upload.json')),
    ),
    file,
  )
  const { repository } = setup(
    (url) => {
      if (url === ME_URL) return fixtureResponse(200, 'workspace/me.json')
      if (url === TRACKS_URL)
        return fixtureResponse(200, 'workspace/tracks.json')
      return NO_ITEMS()
    },
    'undecided',
    { songs },
  )
  const snapshot = await repository.loadWorkspace(signal())

  // The uploaded song is listed once, as the server has it.
  assert.deepEqual(
    snapshot.songs.map((song) => song.id),
    ['7', '9'],
  )
  assert.equal(await repository.loadSongAudio('7', signal()), file)
  // The server has no audio to hand back yet.
  await assert.rejects(repository.loadSongAudio('9', signal()), {
    name: 'WorkspaceRepositoryError',
    code: 'audio-unavailable',
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

  test(`${name} on the track list leaves the workspace retryable`, async () => {
    const { repository } = setup((url) =>
      url === ME_URL ? fixtureResponse(200, 'workspace/me.json') : answer(),
    )
    const error = await failureOf(repository.loadWorkspace(signal()))
    assert.equal(error.code, 'load-failed')
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a rejected session on the track list ends the workspace as expired', async () => {
  const { repository } = setup((url) =>
    url === ME_URL
      ? fixtureResponse(200, 'workspace/me.json')
      : fixtureResponse(401, 'common/unauthorized-session.json'),
  )
  const error = await failureOf(repository.loadWorkspace(signal()))
  assert.equal(error.code, 'expired')
})

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

test('the copy status without an API yet fails with its own code and sends nothing', async () => {
  const { repository, calls } = setup(() => assert.fail('no request'))
  await assert.rejects(repository.saveCopyStatus('1', true, signal()), {
    name: 'WorkspaceRepositoryError',
    code: 'copy-status-failed',
  })
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
  return workspaceAnswer((_url, init) => {
    onUpload(init)
    return fixtureResponse(201, 'workspace/track-upload.json')
  })
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

// The track list answers empty: the song came after it was sent.
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
    const { repository } = setup(workspaceAnswer(() => answer()))
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
