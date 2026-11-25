import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import {
  readPerformanceCreate,
  readPerformanceList,
  toSavedPerformance,
} from '../src/features/comparison/adapter.ts'
import { createHttpComparisonRepository } from '../src/features/comparison/httpRepository.ts'
import { updatedAtLabel } from '../src/features/workspace/format.ts'
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
// 22 seconds after the take in performance-create.json was saved.
const NOW = new Date('2026-11-25T05:14:30Z')
const TASK_ID = '31'
const MAX_BYTES = 50 * 1024 * 1024

function setup(answer, { createXhr } = {}) {
  const { fetch, calls } =
    typeof answer === 'function' ? fakeFetch(answer) : answer
  const repository = createHttpComparisonRepository({
    client: createHttpClient({
      baseUrl: '/api/v1',
      credentials: 'same-origin',
      fetch,
      createXhr,
    }),
    clock: () => NOW,
  })
  return { repository, calls }
}

async function failureOf(promise) {
  return promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  )
}

function uploadTake(overrides = {}) {
  return {
    taskId: TASK_ID,
    source: 'upload',
    audio: new File(['take'], '연습 3.mp3', { type: 'audio/mp3' }),
    durationSeconds: 15.2,
    ...overrides,
  }
}

function recordedTake(overrides = {}) {
  return {
    taskId: TASK_ID,
    source: 'recording',
    audio: new Blob(['wave'], { type: 'audio/wav' }),
    durationSeconds: 14.8,
    ...overrides,
  }
}

// The save answers with performance-create.json; the list with `listed`.
function performanceAnswer(listed = 'performance/performances-empty.json') {
  return (_url, init) =>
    init.method === 'POST'
      ? fixtureResponse(201, 'performance/performance-create.json')
      : fixtureResponse(200, listed)
}

test('a saved take reads the fields the screens use', () => {
  const data = fixtureData('performance/performance-create.json')
  assert.deepEqual(readPerformanceCreate(data), {
    performance_id: 12,
    source: 'UPLOAD',
    start_ms: 12000,
    end_ms: 27500,
    created_at: '2026-11-25T05:14:08.402913Z',
  })
  assert.throws(() => readPerformanceCreate({ ...data, source: 'MIC' }), {
    path: 'data.source',
  })
  assert.throws(() => readPerformanceCreate({ ...data, start_ms: '12000' }), {
    path: 'data.start_ms',
  })
})

test('a take list reads each take, newest first as the server sends them', () => {
  const list = readPerformanceList(fixtureData('performance/performances.json'))
  assert.deepEqual(
    list.performances.map((item) => [item.performance_id, item.source]),
    [
      [12, 'UPLOAD'],
      [9, 'RECORDING'],
    ],
  )
  assert.throws(() => readPerformanceList({ segment_id: 31 }), {
    path: 'data.performances',
  })
  assert.throws(
    () =>
      readPerformanceList({
        performances: [{ performance_id: 1, source: 'UPLOAD' }],
      }),
    { path: 'data.performances[0].start_ms' },
  )
})

test('a take becomes seconds, its source and when it was saved', () => {
  const take = readPerformanceCreate(
    fixtureData('performance/performance-create.json'),
  )
  assert.deepEqual(
    toSavedPerformance(take, {
      taskId: TASK_ID,
      durationSeconds: 15.2,
      now: NOW,
    }),
    {
      id: '12',
      taskId: TASK_ID,
      source: 'upload',
      rangeStartSeconds: 12,
      rangeEndSeconds: 27.5,
      createdAtLabel: '방금',
      durationSeconds: 15.2,
      latestComparison: null,
    },
  )
  const recorded = toSavedPerformance(
    { ...take, source: 'RECORDING', created_at: '2026-11-24T09:02:51.118064Z' },
    { taskId: TASK_ID, durationSeconds: null, now: NOW },
  )
  assert.equal(recorded.source, 'recording')
  assert.equal(
    recorded.createdAtLabel,
    updatedAtLabel('2026-11-24T09:02:51.118064Z', NOW),
  )
  assert.equal(recorded.durationSeconds, null)
})

test('listing asks for the section of the task and keeps the server order', async () => {
  const { repository, calls } = setup(
    performanceAnswer('performance/performances.json'),
  )
  const takes = await repository.listPerformances(TASK_ID, signal())

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/v1/segments/31/performances')
  assert.equal(calls[0].init.method, 'GET')
  assert.deepEqual(
    takes.map((take) => [take.id, take.source, take.taskId]),
    [
      ['12', 'upload', TASK_ID],
      ['9', 'recording', TASK_ID],
    ],
  )
  // Takes saved elsewhere come without a length.
  assert.deepEqual(
    takes.map((take) => take.durationSeconds),
    [null, null],
  )
  assert.deepEqual(
    takes.map((take) => take.latestComparison),
    [null, null],
  )
})

test('an empty section lists no takes', async () => {
  const { repository } = setup(performanceAnswer())
  assert.deepEqual(await repository.listPerformances(TASK_ID, signal()), [])
})

test('saving an uploaded file sends it with its source as a form', async () => {
  const { repository, calls } = setup(performanceAnswer())
  const saved = await repository.savePerformance(uploadTake(), signal())

  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url, '/api/v1/segments/31/performances')
  assert.equal(init.method, 'POST')
  assert.ok(init.body instanceof FormData)
  assert.deepEqual([...init.body.keys()], ['audio_file', 'source'])
  const sent = init.body.get('audio_file')
  assert.equal(sent.name, '연습 3.mp3')
  // The server accepts only its own list of types.
  assert.equal(sent.type, 'audio/mpeg')
  assert.equal(await sent.text(), 'take')
  assert.equal(init.body.get('source'), 'UPLOAD')

  assert.deepEqual(saved, {
    id: '12',
    taskId: TASK_ID,
    source: 'upload',
    rangeStartSeconds: 12,
    rangeEndSeconds: 27.5,
    createdAtLabel: '방금',
    durationSeconds: 15.2,
    latestComparison: null,
  })
})

test('a recording goes as a named WAV file', async () => {
  const { repository, calls } = setup(performanceAnswer())
  await repository.savePerformance(recordedTake(), signal())

  const { body } = calls[0].init
  const sent = body.get('audio_file')
  // The server tells formats apart by extension.
  assert.equal(sent.name, 'take.wav')
  assert.equal(sent.type, 'audio/wav')
  assert.equal(await sent.text(), 'wave')
  assert.equal(body.get('source'), 'RECORDING')
})

test('a take saved on this page keeps its length when listed again', async () => {
  const { repository } = setup(
    performanceAnswer('performance/performances.json'),
  )
  await repository.savePerformance(uploadTake(), signal())
  const takes = await repository.listPerformances(TASK_ID, signal())
  assert.deepEqual(
    takes.map((take) => [take.id, take.durationSeconds]),
    [
      ['12', 15.2],
      ['9', null],
    ],
  )
})

test('upload progress reaches the caller when it asks for it', async () => {
  const xhrs = []
  const createXhr = () => {
    const xhr = {
      upload: {},
      open(method, url) {
        xhr.method = method
        xhr.url = url
      },
      setRequestHeader() {},
      send(body) {
        xhr.sent = body
        xhr.upload.onprogress({ loaded: 1, total: 4, lengthComputable: true })
        xhr.upload.onload()
        xhr.status = 201
        xhr.responseText = JSON.stringify(
          readFixture('performance/performance-create.json'),
        )
        xhr.onload()
      },
      abort() {},
    }
    xhrs.push(xhr)
    return xhr
  }
  const { repository, calls } = setup(() => assert.fail('no fetch'), {
    createXhr,
  })
  const progress = []
  const saved = await repository.savePerformance(
    uploadTake(),
    signal(),
    (percent) => progress.push(percent),
  )
  assert.deepEqual(progress, [25, 100])
  assert.equal(saved.id, '12')
  assert.equal(xhrs[0].method, 'POST')
  assert.equal(xhrs[0].url, '/api/v1/segments/31/performances')
  assert.equal(xhrs[0].sent.get('source'), 'UPLOAD')
  assert.equal(calls.length, 0)
})

test('a take over the size limit is refused before sending', async () => {
  const { repository, calls } = setup(performanceAnswer())
  const audio = new File([new Uint8Array(MAX_BYTES + 1)], 'long.mp3', {
    type: 'audio/mpeg',
  })
  const error = await failureOf(
    repository.savePerformance(uploadTake({ audio }), signal()),
  )
  assert.equal(error.name, 'ComparisonRepositoryError')
  assert.equal(error.code, 'file-too-large')
  assert.equal(calls.length, 0)

  // The limit itself still goes.
  const atLimit = new File([new Uint8Array(MAX_BYTES)], 'long.mp3', {
    type: 'audio/mpeg',
  })
  await repository.savePerformance(uploadTake({ audio: atLimit }), signal())
  assert.equal(calls.length, 1)
})

for (const [name, answer, code] of [
  [
    'a file larger than the limit',
    () => fixtureResponse(413, 'performance/file-too-large.json'),
    'file-too-large',
  ],
  [
    'a body a proxy refuses',
    () => textResponse(413, '<html>Request Entity Too Large</html>'),
    'file-too-large',
  ],
  [
    'a format the server does not take',
    () => fixtureResponse(400, 'performance/unsupported-audio.json'),
    'invalid-audio',
  ],
  [
    'a malformed form',
    () => fixtureResponse(400, 'common/invalid-input.json'),
    'invalid-audio',
  ],
  [
    'a section that is gone',
    () => fixtureResponse(404, 'workspace/segment-not-found.json'),
    'task-unavailable',
  ],
  [
    'a rejected session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
    'expired',
  ],
  [
    'a storage or database failure',
    () => fixtureResponse(500, 'performance/save-failed.json'),
    'save-failed',
  ],
  [
    'no response',
    () => Promise.reject(new TypeError('Failed to fetch')),
    'save-failed',
  ],
  [
    'a changed response',
    () => jsonResponse(201, { success: true, data: { performance_id: 12 } }),
    'save-failed',
  ],
]) {
  test(`${name} refuses the take as ${code}`, async () => {
    const { repository } = setup(() => answer())
    const error = await failureOf(
      repository.savePerformance(uploadTake(), signal()),
    )
    assert.equal(error.name, 'ComparisonRepositoryError')
    assert.equal(error.code, code)
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

for (const [name, answer, code] of [
  [
    'a section that is gone',
    () => fixtureResponse(404, 'workspace/segment-not-found.json'),
    'task-unavailable',
  ],
  [
    'a rejected session',
    () => fixtureResponse(401, 'common/unauthorized-session.json'),
    'expired',
  ],
  [
    'a server error',
    () => fixtureResponse(500, 'common/internal-error-no-trace.json'),
    'list-failed',
  ],
  [
    'no response',
    () => Promise.reject(new TypeError('Failed to fetch')),
    'list-failed',
  ],
  [
    'a changed response',
    () => jsonResponse(200, { success: true, data: { segment_id: 31 } }),
    'list-failed',
  ],
]) {
  test(`${name} fails the take list as ${code}`, async () => {
    const { repository } = setup(() => answer())
    const error = await failureOf(
      repository.listPerformances(TASK_ID, signal()),
    )
    assert.equal(error.name, 'ComparisonRepositoryError')
    assert.equal(error.code, code)
    assert.ok(apiErrorOf(error) instanceof ApiError)
  })
}

test('a cancelled list or save stays an AbortError', async () => {
  const { repository } = setup(pendingFetch())
  const listing = new AbortController()
  const pendingList = repository.listPerformances(TASK_ID, listing.signal)
  listing.abort()
  await assert.rejects(pendingList, { name: 'AbortError' })

  const saving = new AbortController()
  const pendingSave = repository.savePerformance(uploadTake(), saving.signal)
  saving.abort()
  await assert.rejects(pendingSave, { name: 'AbortError' })

  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    repository.savePerformance(uploadTake(), aborted.signal),
    { name: 'AbortError' },
  )
})
