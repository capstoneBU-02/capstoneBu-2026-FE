import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import { createRemoteFiles } from '../src/api/remoteFile.ts'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'
import { updatedAtLabel } from '../src/features/workspace/format.ts'
import {
  createHttpWorkspaceRepository,
  createPageSongs,
} from '../src/features/workspace/httpRepository.ts'
import { createPageTasks } from '../src/features/workspace/pageTasks.ts'
import {
  fakeFetch,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
  readFixture,
} from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const WORKSPACE = { id: '42', name: '내 작업', testerCode: 'TESTER-2026-A1B2' }
const SONG = {
  id: '7',
  name: '봄날 커버 v2',
  fileName: '봄날 커버 v2.mp3',
  inputKind: 'original',
  durationSeconds: 213.48,
}
const NOW = new Date('2026-11-21T06:13:30Z')
const API = '/api/v1'
const GUITAR_URL =
  'https://storage.example.com/stems/54/guitar.wav?X-Amz-Expires=600&X-Amz-Signature=a1b2'

const fixture = (status, name) => () =>
  fixtureResponse(status, `workspace/${name}.json`)
const common = (status, name) => () =>
  fixtureResponse(status, `common/${name}.json`)
const serverError = common(500, 'internal-error-no-trace')
const noResponse = () => Promise.reject(new TypeError('Failed to fetch'))

// Answers by "METHOD url". A list answers its calls in turn, repeating the
// last; an unknown request fails the test through its recorded key.
function server(routes) {
  const served = new Map()
  return fakeFetch((url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const route = routes[key]
    if (!route) return jsonResponse(599, { unexpected: key })
    if (typeof route === 'function') return route(init)
    const index = served.get(key) ?? 0
    served.set(key, index + 1)
    return route[Math.min(index, route.length - 1)](init)
  })
}

const keys = (calls) =>
  calls.map(({ url, init }) => `${init.method ?? 'GET'} ${url}`)
const sent = (call) => JSON.parse(call.init.body)

function songsWith(song = SONG) {
  const songs = createPageSongs()
  songs.add(song, new File(['song'], song.fileName))
  return songs
}

const TASK = {
  id: '31',
  songId: '7',
  sectionName: '코러스 2',
  part: 'rhythm',
  tuningId: 'e-standard',
  partLabel: '리듬 기타',
  tuningLabel: 'E 표준 6현',
  rangeStartSeconds: 12.3,
  rangeEndSeconds: 27.8,
  processingStatus: 'queued',
  failureKind: null,
  progressPercent: null,
  hasSeparatedAudio: false,
  comparisonCount: 0,
  copyStatus: 'unreviewed',
  updatedAtLabel: '방금',
}

const COMPLETED = {
  task: {
    processingStatus: 'completed',
    hasSeparatedAudio: true,
    comparisonCount: 2,
    copyStatus: 'confirmed',
  },
  stemId: 54,
  tabId: 88,
}

function tasksWith(...records) {
  const tasks = createPageTasks()
  for (const record of records)
    tasks.put({
      previousResults: [],
      stemId: null,
      tabId: null,
      updatedAt: '2026-11-21T06:10:02.114820Z',
      segmentVersion: 1,
      segmentUpdatedAt: '2026-11-21T06:10:02.114820Z',
      ...record,
      task: { ...TASK, ...record.task },
    })
  return tasks
}

function setup(
  routes,
  { songs = songsWith(), tasks = createPageTasks() } = {},
) {
  const { fetch, calls } = Array.isArray(routes.calls) ? routes : server(routes)
  let clock = NOW
  const repository = createHttpWorkspaceRepository({
    client: createHttpClient({
      baseUrl: API,
      credentials: 'same-origin',
      fetch,
    }),
    workspace: WORKSPACE,
    songs,
    tasks,
    files: createRemoteFiles({ fetch, now: () => clock.getTime() }),
    clock: () => clock,
    consent: { read: () => 'accepted', save() {} },
  })
  return {
    repository,
    calls,
    tasks,
    setClock(time) {
      clock = time
    },
  }
}

async function failureOf(promise) {
  return promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  )
}

const NEW_TASK = {
  songId: '7',
  sectionName: '코러스 2',
  part: 'rhythm',
  tuningId: 'e-standard',
  rangeStartSeconds: 12.3,
  rangeEndSeconds: 27.8,
}

const ME = { [`GET ${API}/workspaces/me`]: fixture(200, 'me') }
const STATUS = `GET ${API}/segments/31/processing-status`
const STEMS = `POST ${API}/segments/31/stems`
const TABS = `POST ${API}/segments/31/tabs`
const TRACKS = `GET ${API}/tracks`
const SEGMENTS = `GET ${API}/tracks/7/segments`
const LISTED = [`GET ${API}/workspaces/me`, TRACKS, SEGMENTS]

const [TRACK_7] = readFixture('workspace/tracks.json').data.items.slice(1)
const [SEGMENT_31, SEGMENT_33] = readFixture('workspace/segments.json').data
  .items
const items = (list) => () =>
  jsonResponse(200, { success: true, data: { items: list } })

// The session check and a track list with song 7 holding these sections.
// Without one, song 7 is listed with none and its sections are not asked.
function listing(...segments) {
  return {
    ...ME,
    [TRACKS]: items([{ ...TRACK_7, segment_count: segments.length }]),
    [SEGMENTS]: items(segments),
  }
}

// --- createTask -----------------------------------------------------------

test('creating a task sends the section in milliseconds and asks for its stem', async () => {
  const { repository, calls } = setup({
    ...listing(SEGMENT_31),
    [`POST ${API}/tracks/7/segments`]: fixture(201, 'segment-create'),
    [STEMS]: fixture(202, 'stem-created'),
    [STATUS]: fixture(200, 'status-queued'),
  })
  const task = await repository.createTask(NEW_TASK, signal())

  assert.deepEqual(keys(calls), [`POST ${API}/tracks/7/segments`, STEMS])
  assert.deepEqual(sent(calls[0]), {
    start_ms: 12300,
    end_ms: 27800,
    name: 'CHORUS',
  })
  assert.equal(calls[1].init.body, undefined)
  assert.deepEqual(task, {
    ...TASK,
    updatedAtLabel: updatedAtLabel('2026-11-21T06:10:02.114820Z', NOW),
  })

  // The server lists it, and the page reads it again while it is in progress
  // with the names and labels it made.
  const snapshot = await repository.loadWorkspace(signal())
  assert.deepEqual(
    snapshot.tasks.map(({ id, sectionName, processingStatus }) => ({
      id,
      sectionName,
      processingStatus,
    })),
    [{ id: '31', sectionName: '코러스 2', processingStatus: 'queued' }],
  )
  assert.deepEqual(keys(calls).slice(2), [...LISTED, STATUS])
})

test('a solo section is created without a server name', async () => {
  const { repository, calls } = setup({
    [`POST ${API}/tracks/7/segments`]: fixture(201, 'segment-create'),
    [STEMS]: fixture(202, 'stem-created'),
  })
  const task = await repository.createTask(
    { ...NEW_TASK, sectionName: '솔로 2' },
    signal(),
  )
  assert.deepEqual(sent(calls[0]), { start_ms: 12300, end_ms: 27800 })
  // The screen keeps the name the server cannot hold.
  assert.equal(task.sectionName, '솔로 2')
})

for (const [name, input] of [
  ['a tuning the server does not take', { tuningId: 'drop-d' }],
  ['a song this page did not upload', { songId: '8' }],
  ['a range past the song', { rangeEndSeconds: 213.6 }],
  ['a name outside the policy', { sectionName: '후렴' }],
]) {
  test(`${name} fails the create before sending`, async () => {
    const { repository, calls } = setup({})
    const error = await failureOf(
      repository.createTask({ ...NEW_TASK, ...input }, signal()),
    )
    assert.equal(error.code, 'create-task-failed')
    assert.equal(calls.length, 0)
  })
}

for (const [name, answer] of [
  ['a server error', serverError],
  ['no response', noResponse],
]) {
  test(`${name} on the stem request still opens the created task`, async () => {
    const { repository, calls } = setup({
      [`POST ${API}/tracks/7/segments`]: fixture(201, 'segment-create'),
      [STEMS]: [answer, fixture(202, 'stem-created')],
      [STATUS]: fixture(200, 'status-nothing-requested'),
    })
    const task = await repository.createTask(NEW_TASK, signal())
    assert.equal(task.id, '31')
    assert.equal(task.processingStatus, 'queued')

    // The next read asks for the stem again.
    const detail = await repository.loadTask('31', signal())
    assert.deepEqual(keys(calls).slice(2), [STATUS, STEMS])
    assert.equal(detail.task.processingStatus, 'queued')
  })
}

// As when another browser tab asked for the same range first: the server is
// making it, and the status read again names it.
test('a stem already under way is read again and not asked for twice', async () => {
  const { repository, calls, tasks } = setup({
    [`POST ${API}/tracks/7/segments`]: fixture(201, 'segment-create'),
    [STEMS]: fixture(409, 'stem-in-progress'),
    [STATUS]: fixture(200, 'status-queued'),
  })
  const task = await repository.createTask(NEW_TASK, signal())
  assert.equal(task.processingStatus, 'queued')
  assert.deepEqual(keys(calls).slice(1), [STEMS, STATUS])
  assert.equal(tasks.get('31').stemId, 54)

  await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls).slice(3), [STATUS])
})

for (const [name, answer, code] of [
  [
    'a range the server refuses',
    fixture(400, 'invalid-segment-range'),
    'create-task-failed',
  ],
  ['a rejected session', common(401, 'unauthorized-session'), 'expired'],
  ['a server error', serverError, 'create-task-failed'],
  ['no response', noResponse, 'create-task-failed'],
  [
    'a changed response',
    () => jsonResponse(201, { success: true, data: { segment_id: 31 } }),
    'create-task-failed',
  ],
]) {
  test(`${name} on the segment fails the create as ${code}`, async () => {
    const { repository, calls } = setup({
      ...listing(),
      [`POST ${API}/tracks/7/segments`]: answer,
    })
    const error = await failureOf(repository.createTask(NEW_TASK, signal()))
    assert.equal(error.name, 'WorkspaceRepositoryError')
    assert.equal(error.code, code)
    assert.ok(apiErrorOf(error) instanceof ApiError)
    assert.equal(calls.length, 1)
    assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
  })
}

test('a cancelled create stays an AbortError', async () => {
  const { repository } = setup(pendingFetch())
  const controller = new AbortController()
  const pending = repository.createTask(NEW_TASK, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

// --- loadTask -------------------------------------------------------------

test('an unknown task is unavailable without a request', async () => {
  const { repository, calls } = setup({})
  await assert.rejects(repository.loadTask('31', signal()), {
    name: 'WorkspaceRepositoryError',
    code: 'task-unavailable',
  })
  assert.equal(calls.length, 0)
})

test('loading a task reads its processing status', async () => {
  const { repository, calls } = setup(
    { ...listing(SEGMENT_31), [STATUS]: fixture(200, 'status-separating') },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS])
  assert.deepEqual(detail, {
    task: {
      ...TASK,
      processingStatus: 'processing',
      updatedAtLabel: updatedAtLabel('2026-11-21T06:10:11.402377Z', NOW),
    },
    song: SONG,
    previousResults: [],
    stages: [
      { id: 'separation', status: 'running' },
      { id: 'transcription', status: 'waiting' },
    ],
    queueAhead: null,
    retry: null,
    // No tab is asked for until the guitar is ready.
    tabWaitsForPage: true,
  })
  // The page keeps what it read for the list.
  const listed = await repository.loadWorkspace(signal())
  assert.equal(listed.tasks[0].processingStatus, 'processing')
})

test('a ready guitar asks for the tab with the task tuning', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: fixture(200, 'status-stem-ready'),
      [TABS]: fixture(202, 'tab-created'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, TABS])
  assert.deepEqual(sent(calls[1]), {
    result_type: 'original',
    tuning_id: 'e_standard',
    capo: 0,
  })
  assert.equal(detail.task.processingStatus, 'processing')
  assert.equal(detail.task.hasSeparatedAudio, true)
  assert.deepEqual(detail.stages, [
    { id: 'separation', status: 'done' },
    { id: 'transcription', status: 'running' },
  ])
  // The server goes on with the tab without the page.
  assert.equal(detail.tabWaitsForPage, false)
})

test('a tab request refused for now waits for the next read', async () => {
  const { repository, calls } = setup(
    { [STATUS]: fixture(200, 'status-stem-ready'), [TABS]: serverError },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, TABS])
  assert.equal(detail.task.processingStatus, 'processing')
  // The tab is left to the next visit.
  assert.equal(detail.tabWaitsForPage, true)
})

test('a tab already under way is read again and goes on without the page', async () => {
  const { repository, calls, tasks } = setup(
    {
      [STATUS]: [
        fixture(200, 'status-stem-ready'),
        fixture(200, 'status-tab-running'),
      ],
      [TABS]: fixture(409, 'tab-in-progress'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, TABS, STATUS])
  assert.equal(detail.task.processingStatus, 'processing')
  assert.equal(detail.tabWaitsForPage, false)
  assert.equal(tasks.get('31').tabId, 88)
})

test('a tab already under way that cannot be read again waits for the next read', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: [fixture(200, 'status-stem-ready'), serverError],
      [TABS]: fixture(409, 'tab-in-progress'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, TABS, STATUS])
  assert.equal(detail.task.processingStatus, 'processing')
  assert.equal(detail.tabWaitsForPage, true)
})

for (const [failure, expected] of [
  ['stem-failed', { failureKind: null, retry: { left: 2, limit: 3 } }],
  ['stem-no-guitar', { failureKind: 'no-guitar', retry: null }],
  ['stem-invalid-audio', { failureKind: 'invalid-audio', retry: null }],
]) {
  test(`a failed stem reads its failure: ${failure}`, async () => {
    const { repository, calls } = setup(
      {
        [STATUS]: fixture(200, 'status-stem-failed'),
        [`GET ${API}/stems/54`]: fixture(200, failure),
      },
      { tasks: tasksWith({ stemId: 54 }) },
    )
    const detail = await repository.loadTask('31', signal())
    assert.deepEqual(keys(calls), [STATUS, `GET ${API}/stems/54`])
    assert.equal(detail.task.processingStatus, 'failed')
    assert.equal(detail.task.failureKind, expected.failureKind)
    assert.deepEqual(detail.retry, expected.retry)
  })
}

test('a failed tab reads the tab failure', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: fixture(200, 'status-tab-failed'),
      [`GET ${API}/tabs/88`]: fixture(200, 'tab-failed'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, `GET ${API}/tabs/88`])
  assert.equal(detail.task.failureKind, 'transcription')
  assert.deepEqual(detail.retry, { left: 3, limit: 3 })
})

for (const [name, answer, listed] of [
  ['a deleted segment', fixture(404, 'segment-not-found'), []],
  // The segment stays on the server with its stopped stem.
  ['a cancelled stem', fixture(200, 'status-canceled'), [SEGMENT_31]],
]) {
  test(`${name} leaves the page as an unavailable task`, async () => {
    const { repository, calls } = setup(
      { ...listing(...listed), [STATUS]: answer },
      { tasks: tasksWith({}) },
    )
    await assert.rejects(repository.loadTask('31', signal()), {
      code: 'task-unavailable',
    })
    await assert.rejects(repository.loadTask('31', signal()), {
      code: 'task-unavailable',
    })
    assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
    // The list does not read it again.
    assert.deepEqual(keys(calls), [
      STATUS,
      ...LISTED.slice(0, listed.length > 0 ? 3 : 2),
    ])
  })
}

for (const [name, answer, code] of [
  ['a rejected session', common(401, 'unauthorized-session'), 'expired'],
  ['a server error', serverError, 'load-failed'],
  ['no response', noResponse, 'load-failed'],
  [
    'a changed response',
    () =>
      jsonResponse(200, {
        success: true,
        data: { segment_id: 31, stem: { stem_id: 54, status: 'paused' } },
      }),
    'load-failed',
  ],
]) {
  test(`${name} fails the task load as ${code}`, async () => {
    const { repository } = setup({ [STATUS]: answer }, { tasks: tasksWith({}) })
    const error = await failureOf(repository.loadTask('31', signal()))
    assert.equal(error.code, code)
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a failure detail that cannot be read fails the load', async () => {
  const { repository } = setup(
    {
      [STATUS]: fixture(200, 'status-stem-failed'),
      [`GET ${API}/stems/54`]: serverError,
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  await assert.rejects(repository.loadTask('31', signal()), {
    code: 'load-failed',
  })
})

test('a loaded task is a copy', async () => {
  const { repository } = setup(
    { [STATUS]: fixture(200, 'status-completed') },
    { tasks: tasksWith(COMPLETED) },
  )
  const detail = await repository.loadTask('31', signal())
  detail.task.sectionName = 'changed'
  detail.song.name = 'changed'
  const again = await repository.loadTask('31', signal())
  assert.equal(again.task.sectionName, '코러스 2')
  assert.equal(again.song.name, '봄날 커버 v2')
})

// --- loadWorkspace --------------------------------------------------------

const STATUS_33 = `GET ${API}/segments/33/processing-status`
const SEGMENT_32 = { ...SEGMENT_31, segment_id: 32 }

test('the list reads only the known tasks in progress again', async () => {
  const tasks = tasksWith(COMPLETED, { task: { id: '32' } })
  const { repository, calls } = setup(
    {
      ...listing(SEGMENT_31, SEGMENT_32),
      [`GET ${API}/segments/32/processing-status`]: fixture(
        200,
        'status-separating',
      ),
    },
    { tasks },
  )
  const { tasks: listed } = await repository.loadWorkspace(signal())
  assert.deepEqual(
    listed.map(({ id, processingStatus }) => [id, processingStatus]),
    [
      ['31', 'completed'],
      ['32', 'processing'],
    ],
  )
  assert.deepEqual(keys(calls), [
    ...LISTED,
    `GET ${API}/segments/32/processing-status`,
  ])
})

test('a known task that fails to refresh keeps its last state in the list', async () => {
  const { repository } = setup(
    { ...listing(SEGMENT_31), [STATUS]: serverError },
    { tasks: tasksWith({}) },
  )
  const { tasks } = await repository.loadWorkspace(signal())
  assert.deepEqual(tasks, [TASK])
})

test('a finished task is not read again but its time label moves on', async () => {
  const later = new Date('2026-11-21T09:13:30Z')
  const { repository, calls, setClock } = setup(listing(SEGMENT_31), {
    tasks: tasksWith(COMPLETED),
  })
  setClock(later)
  const { tasks } = await repository.loadWorkspace(signal())
  assert.deepEqual(keys(calls), LISTED)
  assert.equal(
    tasks[0].updatedAtLabel,
    updatedAtLabel('2026-11-21T06:10:02.114820Z', later),
  )
  assert.notEqual(tasks[0].updatedAtLabel, TASK.updatedAtLabel)
})

test('a rejected session while refreshing ends the workspace', async () => {
  const { repository } = setup(
    { ...listing(SEGMENT_31), [STATUS]: common(401, 'unauthorized-session') },
    { tasks: tasksWith({}) },
  )
  await assert.rejects(repository.loadWorkspace(signal()), {
    code: 'expired',
  })
})

test('sections this page does not know come back as tasks from the server', async () => {
  const { repository, calls } = setup({
    ...listing(SEGMENT_31, SEGMENT_33),
    [STATUS]: fixture(200, 'status-completed'),
    [STATUS_33]: fixture(200, 'status-separating'),
  })
  const { tasks } = await repository.loadWorkspace(signal())

  assert.deepEqual(keys(calls), [...LISTED, STATUS, STATUS_33])
  // The server keeps the name without its number and no part, and makes
  // tabs in E standard only.
  const restored = {
    ...TASK,
    sectionName: '코러스',
    part: 'unset',
    partLabel: '파트 미정',
  }
  assert.deepEqual(tasks, [
    {
      ...restored,
      processingStatus: 'completed',
      hasSeparatedAudio: true,
      updatedAtLabel: updatedAtLabel('2026-11-21T06:13:20.158032Z', NOW),
    },
    {
      ...restored,
      id: '33',
      sectionName: '솔로',
      rangeStartSeconds: 60,
      rangeEndSeconds: 84.5,
      processingStatus: 'processing',
      updatedAtLabel: updatedAtLabel('2026-11-21T06:10:11.402377Z', NOW),
    },
  ])

  // A finished task restored from the list opens with its results.
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(detail.previousResults, [])
  assert.equal(detail.song.id, '7')
})

test('a restored task loads its tab and guitar by the ids the server named', async () => {
  const { repository, calls } = setup({
    ...listing(SEGMENT_31),
    [STATUS]: fixture(200, 'status-completed'),
    [`GET ${API}/tabs/88/result`]: fixture(200, 'tab-result'),
    [`GET ${API}/stems/54/playback`]: fixture(200, 'stem-playback'),
    [`GET ${GUITAR_URL}`]: () => new Response('guitar', { status: 200 }),
  })
  await repository.loadWorkspace(signal())
  assert.ok(await repository.loadTab('31', signal()))
  await repository.loadSeparatedAudio('31', signal())
  assert.deepEqual(keys(calls).slice(LISTED.length + 1), [
    `GET ${API}/tabs/88/result`,
    `GET ${API}/stems/54/playback`,
    `GET ${GUITAR_URL}`,
  ])
})

test('tasks are listed in the order they were made, the page ones the list missed too', async () => {
  // Made on this page after the list was sent.
  const tasks = tasksWith({
    ...COMPLETED,
    task: { ...COMPLETED.task, id: '35' },
  })
  const early = { ...SEGMENT_33, segment_id: 34, start_ms: 1000, end_ms: 9000 }
  const { repository } = setup(
    {
      ...listing(early, SEGMENT_31),
      [STATUS]: fixture(200, 'status-completed'),
      [`GET ${API}/segments/34/processing-status`]: fixture(
        200,
        'status-completed',
      ),
    },
    { tasks },
  )
  const { tasks: listed } = await repository.loadWorkspace(signal())
  assert.deepEqual(
    listed.map(({ id }) => id),
    ['31', '34', '35'],
  )
})

const MOVED_ELSEWHERE = {
  ...SEGMENT_31,
  start_ms: 15000,
  end_ms: 30000,
  name: 'BRIDGE',
  version: 2,
  updated_at: '2026-11-21T06:31:47.902113Z',
}

test('a section changed in another tab brings its range and name, and is read again', async () => {
  const { repository, calls } = setup(
    {
      ...listing(MOVED_ELSEWHERE),
      [STATUS]: fixture(200, 'status-nothing-requested'),
      [STEMS]: fixture(202, 'stem-created'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks

  assert.deepEqual(keys(calls), [...LISTED, STATUS, STEMS])
  assert.equal(task.sectionName, '브리지')
  assert.equal(task.rangeStartSeconds, 15)
  assert.equal(task.rangeEndSeconds, 30)
  assert.equal(task.processingStatus, 'queued')
  assert.equal(task.hasSeparatedAudio, false)
  // The part stays with this page, and the finished result is kept.
  assert.equal(task.part, 'rhythm')
  assert.equal(task.comparisonCount, 0)
  assert.equal(task.copyStatus, 'unreviewed')
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(
    detail.previousResults.map(({ id, sectionName, rangeStartSeconds }) => [
      id,
      sectionName,
      rangeStartSeconds,
    ]),
    [['kept-31-1', '코러스 2', 12.3]],
  )
})

// The server keeps the version for a new name alone and moves only the time.
const RENAMED_ELSEWHERE = {
  ...SEGMENT_31,
  name: 'BRIDGE',
  updated_at: '2026-11-21T06:31:47.902113Z',
}

test('a section renamed in another tab brings its name at the same version', async () => {
  const { repository, calls } = setup(
    {
      ...listing(RENAMED_ELSEWHERE),
      [STATUS]: fixture(200, 'status-completed'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks
  assert.deepEqual(keys(calls), [...LISTED, STATUS])
  assert.equal(task.sectionName, '브리지')
  // The same range keeps its result.
  assert.equal(task.processingStatus, 'completed')
  assert.equal(task.comparisonCount, 2)
})

test('a section renamed away and back elsewhere keeps the number on the screen', async () => {
  const { repository } = setup(
    {
      ...listing({ ...RENAMED_ELSEWHERE, name: 'CHORUS' }),
      [STATUS]: fixture(200, 'status-completed'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks
  assert.equal(task.sectionName, '코러스 2')
  assert.equal(task.processingStatus, 'completed')
  assert.equal(task.comparisonCount, 2)
})

test('a list sent before a rename does not bring back the old name', async () => {
  const { repository } = setup(
    {
      // The list still has the section as it was before the change.
      ...listing(SEGMENT_31),
      [`PATCH ${API}/segments/31`]: () =>
        jsonResponse(200, { success: true, data: RENAMED_ELSEWHERE }),
      [TABS]: fixture(202, 'tab-created'),
      [STATUS]: fixture(200, 'status-tab-running'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  await repository.reviseTask(
    '31',
    {
      sectionName: '브리지',
      part: 'lead',
      tuningId: 'e-standard',
      rangeStartSeconds: 12.3,
      rangeEndSeconds: 27.8,
    },
    signal(),
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks
  assert.equal(task.sectionName, '브리지')
})

test('a changed section that fails to read comes back queued at its new range', async () => {
  const { repository } = setup(
    { ...listing(MOVED_ELSEWHERE), [STATUS]: serverError },
    { tasks: tasksWith(COMPLETED) },
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks
  assert.equal(task.rangeStartSeconds, 15)
  assert.equal(task.processingStatus, 'queued')
})

test('a list sent before a revise does not bring back the old range', async () => {
  const { repository, calls } = setup(
    {
      // The list still has the section as it was before the change.
      ...listing(SEGMENT_31),
      [`PATCH ${API}/segments/31`]: fixture(200, 'segment-update'),
      [STATUS]: [
        fixture(200, 'status-nothing-requested'),
        fixture(200, 'status-queued'),
      ],
      [STEMS]: fixture(202, 'stem-created'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  await repository.reviseTask(
    '31',
    {
      sectionName: '브리지',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 15,
      rangeEndSeconds: 30,
    },
    signal(),
  )
  const [task] = (await repository.loadWorkspace(signal())).tasks
  assert.equal(task.sectionName, '브리지')
  assert.equal(task.rangeStartSeconds, 15)
  assert.equal(task.processingStatus, 'queued')
  assert.deepEqual(keys(calls).slice(3), [...LISTED, STATUS])
})

test('a listed section stopped elsewhere is left out and not read again', async () => {
  const { repository, calls } = setup({
    ...listing(SEGMENT_31),
    [STATUS]: fixture(200, 'status-canceled'),
  })
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
  assert.deepEqual(keys(calls), [...LISTED, STATUS, ...LISTED])
})

test('a listed section deleted before its read is left out', async () => {
  const { repository } = setup({
    ...listing(SEGMENT_31),
    [STATUS]: fixture(404, 'segment-not-found'),
  })
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
})

// As when another code's session took the cookie and this code was entered
// again: the page keeps the same tasks, and the server finds the section.
test('a section the server could not find comes back in a later list', async () => {
  const { repository } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: [
        fixture(404, 'segment-not-found'),
        fixture(200, 'status-completed'),
      ],
    },
    { tasks: tasksWith({}) },
  )
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
  const { tasks } = await repository.loadWorkspace(signal())
  assert.deepEqual(
    tasks.map(({ id, processingStatus }) => [id, processingStatus]),
    [['31', 'completed']],
  )
})

async function until(condition) {
  for (let turn = 0; turn < 100 && !condition(); turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
  assert.ok(condition(), 'the awaited request was not sent')
}

test('a task stopped while the list reads it is left out and asked for nothing', async () => {
  let answerListRead
  const listRead = new Promise((resolve) => {
    answerListRead = resolve
  })
  const { repository, calls } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: [() => listRead, fixture(200, 'status-nothing-requested')],
    },
    { tasks: tasksWith({}) },
  )
  const listed = repository.loadWorkspace(signal())
  await until(() => calls.length === LISTED.length + 1)
  await repository.cancelTask('31', signal())
  answerListRead(
    fixtureResponse(200, 'workspace/status-nothing-requested.json'),
  )

  assert.deepEqual((await listed).tasks, [])
  // No stem for the stopped section.
  assert.deepEqual(keys(calls), [...LISTED, STATUS, STATUS])
})

// A read held until the test answers it, as a slow processing status.
function held() {
  let release
  const answered = new Promise((resolve) => {
    release = resolve
  })
  return {
    route: () => answered,
    answer: (status, name) =>
      release(fixtureResponse(status, `workspace/${name}.json`)),
  }
}

test('a read that ends after the task changed keeps the change', async () => {
  const read = held()
  const { repository, tasks } = setup(
    { [STATUS]: read.route },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const loading = repository.loadTask('31', signal())
  const changed = { ...tasks.get('31'), stemId: null }
  tasks.put(changed)
  read.answer(200, 'status-separating')

  assert.equal((await loading).task.processingStatus, 'processing')
  assert.equal(tasks.get('31'), changed)
})

test('a section gone after the task changed leaves the change in place', async () => {
  const read = held()
  const { repository, tasks } = setup(
    { [STATUS]: read.route },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const loading = repository.loadTask('31', signal())
  const changed = { ...tasks.get('31'), stemId: null }
  tasks.put(changed)
  read.answer(404, 'segment-not-found')

  await assert.rejects(loading, { code: 'task-unavailable' })
  assert.equal(tasks.get('31'), changed)
  assert.equal(tasks.isGone('31'), false)
})

for (const [name, routes] of [
  ['a section list', { [SEGMENTS]: serverError }],
  ['a new section', { [STATUS]: serverError }],
]) {
  test(`${name} that cannot be read fails the load`, async () => {
    const { repository } = setup({ ...listing(SEGMENT_31), ...routes })
    const error = await failureOf(repository.loadWorkspace(signal()))
    assert.equal(error.code, 'load-failed')
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a rejected session on a section list ends the workspace', async () => {
  const { repository } = setup({
    ...listing(SEGMENT_31),
    [SEGMENTS]: common(401, 'unauthorized-session'),
  })
  await assert.rejects(repository.loadWorkspace(signal()), {
    code: 'expired',
  })
})

test('a section list that changed shape fails the load', async () => {
  const { repository } = setup({
    ...listing(SEGMENT_31),
    [SEGMENTS]: items([{ ...SEGMENT_31, version: null }]),
  })
  await assert.rejects(repository.loadWorkspace(signal()), {
    code: 'load-failed',
  })
})

// --- reviseTask -----------------------------------------------------------

const PATCH = `PATCH ${API}/segments/31`

test('a moved range patches the segment and asks for a new stem', async () => {
  const { repository, calls } = setup(
    {
      [PATCH]: fixture(200, 'segment-update'),
      [STATUS]: fixture(200, 'status-nothing-requested'),
      [STEMS]: fixture(202, 'stem-created'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const task = await repository.reviseTask(
    '31',
    {
      sectionName: '브리지',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 15,
      rangeEndSeconds: 30,
    },
    signal(),
  )
  assert.deepEqual(keys(calls), [PATCH, STATUS, STEMS])
  assert.deepEqual(sent(calls[0]), {
    start_ms: 15000,
    end_ms: 30000,
    name: 'BRIDGE',
  })
  assert.equal(task.sectionName, '브리지')
  assert.equal(task.rangeStartSeconds, 15)
  assert.equal(task.rangeEndSeconds, 30)
  assert.equal(task.processingStatus, 'queued')
  assert.equal(task.hasSeparatedAudio, false)
  // The finished result went to the previous results.
  assert.equal(task.comparisonCount, 0)
  assert.equal(task.copyStatus, 'unreviewed')

  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(detail.previousResults, [
    {
      id: 'kept-31-1',
      sectionName: '코러스 2',
      partLabel: '리듬 기타',
      tuningLabel: 'E 표준 6현',
      rangeStartSeconds: 12.3,
      rangeEndSeconds: 27.8,
      comparisonCount: 2,
      copyStatus: 'confirmed',
    },
  ])
})

const PART_CHANGE = {
  sectionName: '코러스 2',
  part: 'lead',
  tuningId: 'e-standard',
  rangeStartSeconds: 12.3,
  rangeEndSeconds: 27.8,
}

test('a changed part makes the tab again from the same guitar', async () => {
  const reused = readFixture('workspace/tab-created.json')
  reused.data = { ...reused.data, status: 'success', is_reused: true }
  const { repository, calls } = setup(
    {
      [TABS]: () => jsonResponse(200, reused),
      [STATUS]: fixture(200, 'status-completed'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const task = await repository.reviseTask('31', PART_CHANGE, signal())
  assert.deepEqual(keys(calls), [TABS, STATUS])
  assert.equal(task.partLabel, '리드 기타')
  assert.equal(task.processingStatus, 'completed')
  // The server made no new tab, so the result and its marks stay.
  assert.equal(task.comparisonCount, 2)
  assert.equal(task.copyStatus, 'confirmed')
  const detail = await repository.loadTask('31', signal())
  assert.deepEqual(detail.previousResults, [])
})

test('a new tab for the same range keeps the old one as a previous result', async () => {
  const created = readFixture('workspace/tab-created.json')
  created.data = { ...created.data, tab_id: 89 }
  const { repository } = setup(
    {
      [TABS]: () => jsonResponse(202, created),
      [STATUS]: fixture(200, 'status-tab-running'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  const task = await repository.reviseTask('31', PART_CHANGE, signal())
  assert.equal(task.processingStatus, 'processing')
  assert.equal(task.comparisonCount, 0)
  const detail = await repository.loadTask('31', signal())
  assert.equal(detail.previousResults.length, 1)
})

for (const [name, sectionName] of [
  ['another number of the same name', '코러스 3'],
  // The server cannot clear a name.
  ['a name the server lacks', '솔로'],
]) {
  test(`${name} sends no name`, async () => {
    const { repository, calls } = setup(
      {
        [TABS]: fixture(202, 'tab-created'),
        [STATUS]: fixture(200, 'status-tab-running'),
      },
      { tasks: tasksWith(COMPLETED) },
    )
    const task = await repository.reviseTask(
      '31',
      { ...PART_CHANGE, sectionName },
      signal(),
    )
    assert.deepEqual(keys(calls), [TABS, STATUS])
    assert.equal(task.sectionName, sectionName)
  })
}

test('a new server name alone is patched before the tab', async () => {
  const { repository, calls } = setup(
    {
      [PATCH]: fixture(200, 'segment-update'),
      [TABS]: fixture(202, 'tab-created'),
      [STATUS]: fixture(200, 'status-tab-running'),
    },
    { tasks: tasksWith(COMPLETED) },
  )
  await repository.reviseTask(
    '31',
    { ...PART_CHANGE, sectionName: '브리지' },
    signal(),
  )
  assert.deepEqual(keys(calls), [PATCH, TABS, STATUS])
  assert.deepEqual(sent(calls[0]), { name: 'BRIDGE' })
})

// A silent range or one past the decoded end fails the same way as a
// broken file, so a section the server could not read moves as well.
for (const failureKind of ['no-guitar', 'invalid-audio'])
  test(`a ${failureKind} failure moves its section without keeping a result`, async () => {
    const { repository, calls } = setup(
      {
        [PATCH]: fixture(200, 'segment-update'),
        [STATUS]: fixture(200, 'status-nothing-requested'),
        [STEMS]: fixture(202, 'stem-created'),
      },
      {
        tasks: tasksWith({
          task: { processingStatus: 'failed', failureKind },
          stemId: 54,
        }),
      },
    )
    const task = await repository.reviseTask(
      '31',
      { ...NEW_TASK, rangeStartSeconds: 15, rangeEndSeconds: 30 },
      signal(),
    )
    assert.deepEqual(keys(calls), [PATCH, STATUS, STEMS])
    assert.deepEqual(sent(calls[0]), { start_ms: 15000, end_ms: 30000 })
    assert.equal(task.processingStatus, 'queued')
    assert.equal(task.failureKind, null)
    const detail = await repository.loadTask('31', signal())
    assert.deepEqual(detail.previousResults, [])
  })

for (const [name, record, input, code] of [
  ['an unknown task', null, PART_CHANGE, 'task-unavailable'],
  [
    'a tuning the server does not take',
    COMPLETED,
    { ...PART_CHANGE, tuningId: 'drop-d' },
    'revise-task-failed',
  ],
  [
    'nothing that changes the tab',
    COMPLETED,
    { ...PART_CHANGE, part: 'rhythm' },
    'revise-task-failed',
  ],
  ['a task still in progress', {}, PART_CHANGE, 'revise-task-failed'],
]) {
  test(`${name} fails the revise before sending`, async () => {
    const { repository, calls } = setup(
      {},
      { tasks: record ? tasksWith(record) : createPageTasks() },
    )
    const error = await failureOf(repository.reviseTask('31', input, signal()))
    assert.equal(error.code, code)
    assert.equal(calls.length, 0)
  })
}

for (const [name, routes, code] of [
  [
    'a range the server refuses',
    { [PATCH]: fixture(400, 'invalid-segment-range') },
    'revise-task-failed',
  ],
  [
    'a rejected session',
    { [PATCH]: common(401, 'unauthorized-session') },
    'expired',
  ],
  [
    'a guitar the server says is not ready',
    { [TABS]: fixture(409, 'stem-not-ready') },
    'revise-task-failed',
  ],
]) {
  test(`${name} fails the revise as ${code} and keeps the task`, async () => {
    const { repository } = setup(
      { ...listing(SEGMENT_31), ...routes },
      { tasks: tasksWith(COMPLETED) },
    )
    const input = routes[PATCH]
      ? { ...PART_CHANGE, rangeStartSeconds: 15, rangeEndSeconds: 30 }
      : PART_CHANGE
    const error = await failureOf(repository.reviseTask('31', input, signal()))
    assert.equal(error.code, code)
    if (code === 'expired') return
    const [task] = (await repository.loadWorkspace(signal())).tasks
    assert.equal(task.part, 'rhythm')
    assert.equal(task.rangeStartSeconds, 12.3)
  })
}

test('a revise the server took comes back queued when the read fails', async () => {
  const { repository } = setup(
    { [PATCH]: fixture(200, 'segment-update'), [STATUS]: serverError },
    { tasks: tasksWith(COMPLETED) },
  )
  const task = await repository.reviseTask(
    '31',
    { ...PART_CHANGE, rangeStartSeconds: 15, rangeEndSeconds: 30 },
    signal(),
  )
  assert.equal(task.processingStatus, 'queued')
  assert.equal(task.rangeStartSeconds, 15)
})

// --- retryTask ------------------------------------------------------------

const FAILED_STEM = {
  task: { processingStatus: 'failed' },
  stemId: 54,
}

test('a failed stem is sent again from its failed stage', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: [
        fixture(200, 'status-stem-failed'),
        fixture(200, 'status-separating'),
      ],
      [`POST ${API}/stems/54/retry`]: fixture(202, 'stem-retry'),
    },
    { tasks: tasksWith(FAILED_STEM) },
  )
  const task = await repository.retryTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, `POST ${API}/stems/54/retry`, STATUS])
  assert.equal(calls[1].init.body, undefined)
  assert.equal(task.processingStatus, 'processing')
})

test('a failed tab is sent again without touching the guitar', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: [
        fixture(200, 'status-tab-failed'),
        fixture(200, 'status-tab-running'),
      ],
      [`POST ${API}/tabs/88/retry`]: fixture(202, 'tab-retry'),
    },
    { tasks: tasksWith(FAILED_STEM) },
  )
  const task = await repository.retryTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, `POST ${API}/tabs/88/retry`, STATUS])
  assert.equal(task.processingStatus, 'processing')
  assert.equal(task.hasSeparatedAudio, true)
})

test('a failure that cannot be sent again fails without a retry request', async () => {
  const status = readFixture('workspace/status-stem-failed.json')
  status.data.stem = { ...status.data.stem, retryable: false }
  const { repository, calls } = setup(
    { [STATUS]: () => jsonResponse(200, status) },
    { tasks: tasksWith(FAILED_STEM) },
  )
  await assert.rejects(repository.retryTask('31', signal()), {
    code: 'retry-task-failed',
  })
  assert.deepEqual(keys(calls), [STATUS])
})

for (const [name, answer] of [
  ['tries that ran out', fixture(409, 'retry-limit-exceeded')],
  ['a failure the server will not retry', fixture(409, 'stem-not-retryable')],
  ['a server error', serverError],
]) {
  test(`${name} fails the retry`, async () => {
    const { repository } = setup(
      {
        [STATUS]: fixture(200, 'status-stem-failed'),
        [`POST ${API}/stems/54/retry`]: answer,
      },
      { tasks: tasksWith(FAILED_STEM) },
    )
    const error = await failureOf(repository.retryTask('31', signal()))
    assert.equal(error.code, 'retry-task-failed')
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a retry already under way counts as sent', async () => {
  const { repository } = setup(
    {
      [STATUS]: [
        fixture(200, 'status-stem-failed'),
        fixture(200, 'status-between-stages'),
      ],
      [`POST ${API}/stems/54/retry`]: fixture(409, 'stem-in-progress'),
    },
    { tasks: tasksWith(FAILED_STEM) },
  )
  const task = await repository.retryTask('31', signal())
  assert.equal(task.processingStatus, 'processing')
})

test('a retry the server took comes back queued when the read fails', async () => {
  const { repository } = setup(
    {
      [STATUS]: [fixture(200, 'status-stem-failed'), serverError],
      [`POST ${API}/stems/54/retry`]: fixture(202, 'stem-retry'),
    },
    { tasks: tasksWith(FAILED_STEM) },
  )
  const task = await repository.retryTask('31', signal())
  assert.equal(task.processingStatus, 'queued')
  assert.equal(task.failureKind, null)
})

// --- cancelTask -----------------------------------------------------------

test('a queued task is cancelled and leaves the page', async () => {
  const { repository, calls } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: fixture(200, 'status-queued'),
      [`POST ${API}/stems/54/cancel`]: fixture(200, 'stem-cancel'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  await repository.cancelTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, `POST ${API}/stems/54/cancel`])
  // The server still lists the segment; the page leaves it out unread.
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
  assert.deepEqual(keys(calls).slice(2), LISTED)
})

for (const [name, answer] of [
  ['a task with no stem yet', fixture(200, 'status-nothing-requested')],
  ['a task the server no longer has', fixture(404, 'segment-not-found')],
  ['a task already cancelled', fixture(200, 'status-canceled')],
]) {
  test(`${name} stops without a cancel request`, async () => {
    const { repository, calls } = setup(
      { ...listing(SEGMENT_31), [STATUS]: answer },
      { tasks: tasksWith({}) },
    )
    await repository.cancelTask('31', signal())
    assert.deepEqual(keys(calls), [STATUS])
    // A segment with no stem is not asked for one again.
    assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
    assert.deepEqual(keys(calls).slice(1), LISTED)
  })
}

test('a task already running cannot be stopped', async () => {
  const { repository } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: fixture(200, 'status-separating'),
      [`POST ${API}/stems/54/cancel`]: fixture(409, 'stem-not-cancelable'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const error = await failureOf(repository.cancelTask('31', signal()))
  assert.equal(error.code, 'cancel-task-failed')
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, 1)
})

const CANCEL = `POST ${API}/stems/54/cancel`

test('a stem asked for when the stop begins is stopped with the task', async () => {
  const stem = held()
  const { repository, calls } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: [
        fixture(200, 'status-nothing-requested'),
        fixture(200, 'status-queued'),
      ],
      [STEMS]: stem.route,
      [CANCEL]: fixture(200, 'stem-cancel'),
    },
    { tasks: tasksWith({}) },
  )
  const loading = repository.loadTask('31', signal()).catch(() => {})
  await until(() => calls.length === 2)
  const stopping = repository.cancelTask('31', signal())
  // The stop waits for the stem the server is about to make.
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(keys(calls), [STATUS, STEMS])
  stem.answer(202, 'stem-created')

  await stopping
  await loading
  assert.deepEqual(keys(calls), [STATUS, STEMS, STATUS, CANCEL])
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
})

test('a task being stopped asks for nothing new', async () => {
  const stopRead = held()
  const { repository, calls } = setup(
    {
      ...listing(SEGMENT_31),
      [STATUS]: [stopRead.route, fixture(200, 'status-nothing-requested')],
      [STEMS]: fixture(202, 'stem-created'),
    },
    { tasks: tasksWith({}) },
  )
  const stopping = repository.cancelTask('31', signal())
  await until(() => calls.length === 1)
  await repository.loadTask('31', signal()).catch(() => {})
  stopRead.answer(200, 'status-nothing-requested')
  await stopping

  assert.deepEqual(keys(calls), [STATUS, STATUS])
  assert.deepEqual((await repository.loadWorkspace(signal())).tasks, [])
})

test('a task whose stop failed asks for its stem again', async () => {
  const { repository, calls } = setup(
    {
      [STATUS]: [
        fixture(200, 'status-queued'),
        fixture(200, 'status-nothing-requested'),
      ],
      [CANCEL]: serverError,
      [STEMS]: fixture(202, 'stem-created'),
    },
    { tasks: tasksWith({ stemId: 54 }) },
  )
  const error = await failureOf(repository.cancelTask('31', signal()))
  assert.equal(error.code, 'cancel-task-failed')
  await repository.loadTask('31', signal())
  assert.deepEqual(keys(calls), [STATUS, CANCEL, STATUS, STEMS])
})

test('an unknown task cannot be stopped', async () => {
  const { repository, calls } = setup({})
  await assert.rejects(repository.cancelTask('31', signal()), {
    code: 'task-unavailable',
  })
  assert.equal(calls.length, 0)
})

// --- loadSeparatedAudio ---------------------------------------------------

const PLAYBACK = `GET ${API}/stems/54/playback`
const GUITAR = `GET ${GUITAR_URL}`
const guitarFile = () => new Response('guitar', { status: 200 })

test('the separated guitar downloads from its signed URL', async () => {
  const { repository, calls } = setup(
    { [PLAYBACK]: fixture(200, 'stem-playback'), [GUITAR]: guitarFile },
    { tasks: tasksWith(COMPLETED) },
  )
  const blob = await repository.loadSeparatedAudio('31', signal())
  assert.equal(await blob.text(), 'guitar')
  assert.deepEqual(keys(calls), [PLAYBACK, GUITAR])
  // Storage gets no cookies.
  assert.equal(calls[1].init.credentials, 'omit')
})

test('a signed URL is reused until a minute before it expires', async () => {
  const { repository, calls, setClock } = setup(
    { [PLAYBACK]: fixture(200, 'stem-playback'), [GUITAR]: guitarFile },
    { tasks: tasksWith(COMPLETED) },
  )
  await repository.loadSeparatedAudio('31', signal())
  await repository.loadSeparatedAudio('31', signal())
  assert.deepEqual(keys(calls), [PLAYBACK, GUITAR, GUITAR])

  setClock(new Date('2026-11-21T06:22:30Z'))
  await repository.loadSeparatedAudio('31', signal())
  assert.deepEqual(keys(calls).slice(3), [PLAYBACK, GUITAR])
})

test('a kept URL the storage refuses is signed again once', async () => {
  const { repository, calls } = setup(
    {
      [PLAYBACK]: fixture(200, 'stem-playback'),
      [GUITAR]: [
        guitarFile,
        () => new Response('', { status: 403 }),
        guitarFile,
      ],
    },
    { tasks: tasksWith(COMPLETED) },
  )
  await repository.loadSeparatedAudio('31', signal())
  const blob = await repository.loadSeparatedAudio('31', signal())
  assert.equal(await blob.text(), 'guitar')
  assert.deepEqual(keys(calls).slice(2), [GUITAR, PLAYBACK, GUITAR])
})

for (const [name, routes, code] of [
  [
    'storage that cannot be reached',
    { [PLAYBACK]: fixture(200, 'stem-playback'), [GUITAR]: noResponse },
    'audio-unavailable',
  ],
  [
    'a fresh URL the storage refuses',
    {
      [PLAYBACK]: fixture(200, 'stem-playback'),
      [GUITAR]: () => new Response('', { status: 403 }),
    },
    'audio-unavailable',
  ],
  [
    'a guitar the server says is not ready',
    { [PLAYBACK]: fixture(409, 'stem-not-ready') },
    'audio-unavailable',
  ],
  [
    'a rejected session',
    { [PLAYBACK]: common(401, 'unauthorized-session') },
    'expired',
  ],
]) {
  test(`${name} fails the separated guitar as ${code}`, async () => {
    const { repository } = setup(routes, { tasks: tasksWith(COMPLETED) })
    await assert.rejects(repository.loadSeparatedAudio('31', signal()), {
      name: 'WorkspaceRepositoryError',
      code,
    })
  })
}

test('a playback answer without a guitar URL has none to load', async () => {
  const playback = readFixture('workspace/stem-playback.json')
  playback.data.tracks = [
    { type: 'guitar', label: '기타', available: false, url: null },
  ]
  const { repository, calls } = setup(
    { [PLAYBACK]: () => jsonResponse(200, playback) },
    { tasks: tasksWith(COMPLETED) },
  )
  await assert.rejects(repository.loadSeparatedAudio('31', signal()), {
    code: 'audio-unavailable',
  })
  assert.deepEqual(keys(calls), [PLAYBACK])
})

test('a task without separated guitar has none to load', async () => {
  const { repository, calls } = setup({}, { tasks: tasksWith({}) })
  await assert.rejects(repository.loadSeparatedAudio('31', signal()), {
    code: 'audio-unavailable',
  })
  await assert.rejects(repository.loadSeparatedAudio('99', signal()), {
    code: 'audio-unavailable',
  })
  assert.equal(calls.length, 0)
})

test('a cancelled download stays an AbortError', async () => {
  const { repository } = setup(pendingFetch(), {
    tasks: tasksWith(COMPLETED),
  })
  const controller = new AbortController()
  const pending = repository.loadSeparatedAudio('31', controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

// --- loadTab ---------------------------------------------------------------

const RESULT = `GET ${API}/tabs/88/result`

test('a finished tab is read from its result and drawn as bars', async () => {
  const { repository, calls } = setup(
    { [RESULT]: fixture(200, 'tab-result') },
    { tasks: tasksWith(COMPLETED) },
  )
  const score = await repository.loadTab('31', signal())
  assert.deepEqual(keys(calls), [RESULT])
  const parsed = parseTabScore(score)
  assert.equal(parsed.ok, true, parsed.error)
  assert.deepEqual(score.tuning, ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'])
  assert.deepEqual(
    score.bars.map((bar) => bar.startSeconds),
    [0.5, 2.5],
  )
  assert.equal(score.endSeconds, 4.5)
  assert.deepEqual(
    score.bars[0].beats[0].notes.map(({ string, fret }) => [string, fret]),
    [
      [2, 1],
      [5, 3],
    ],
  )
  // The last note of the first bar holds on into the second.
  assert.deepEqual(score.bars[1].beats[0].notes, [
    { string: 3, fret: 2, hammerOn: false, tieFromPrevious: true },
  ])
})

test('a result with nothing to draw reaches the screen as a format failure', async () => {
  const result = readFixture('workspace/tab-result.json')
  result.data.time_signature = '6/8'
  const { repository } = setup(
    { [RESULT]: () => jsonResponse(200, result) },
    { tasks: tasksWith(COMPLETED) },
  )
  const answer = await repository.loadTab('31', signal())
  assert.equal(parseTabScore(answer).ok, false)
})

for (const [name, route, code] of [
  [
    'a tab the server says is not ready',
    fixture(409, 'tab-not-ready'),
    'tab-unavailable',
  ],
  ['a server that cannot be reached', noResponse, 'tab-unavailable'],
  ['a server error', serverError, 'tab-unavailable'],
  [
    'a result that cannot be read',
    () => jsonResponse(200, { success: true, data: { notes: [] } }),
    'tab-unavailable',
  ],
  ['a rejected session', common(401, 'unauthorized-session'), 'expired'],
]) {
  test(`${name} fails the tab as ${code}`, async () => {
    const { repository } = setup(
      { [RESULT]: route },
      { tasks: tasksWith(COMPLETED) },
    )
    await assert.rejects(repository.loadTab('31', signal()), {
      name: 'WorkspaceRepositoryError',
      code,
    })
  })
}

test('a task without a finished tab has none to load', async () => {
  const { repository, calls } = setup(
    {},
    {
      tasks: tasksWith(
        { task: { processingStatus: 'processing' }, stemId: 54, tabId: 88 },
        { task: { id: '32', processingStatus: 'completed' }, stemId: 54 },
      ),
    },
  )
  for (const taskId of ['31', '32', '99']) {
    await assert.rejects(repository.loadTab(taskId, signal()), {
      code: 'tab-unavailable',
    })
  }
  assert.equal(calls.length, 0)
})

test('a cancelled tab request stays an AbortError', async () => {
  const { repository } = setup(pendingFetch(), {
    tasks: tasksWith(COMPLETED),
  })
  const controller = new AbortController()
  const pending = repository.loadTab('31', controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
