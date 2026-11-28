import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiErrorOf, createHttpClient } from '../src/api/http.ts'
import { createRemoteFiles } from '../src/api/remoteFile.ts'
import { createHttpComparisonRepository } from '../src/features/comparison/httpRepository.ts'
import {
  fakeFetch,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
  readFixture,
} from './fixtures/api/fetch.mjs'

// Comparing through the http repository against a fake server. Comparison 41
// compares take 12; its links in playback.json expire at 05:25:02.
const signal = () => new AbortController().signal
const API = '/api/v1'
const NOW = new Date('2026-11-25T05:15:30Z')
const ORIGINAL_URL =
  'https://storage.example.com/tracks/7/original.mp3?X-Amz-Expires=600&X-Amz-Signature=e5f6'
const PERFORMANCE_URL =
  'https://storage.example.com/performances/12/take.mp3?X-Amz-Expires=600&X-Amz-Signature=c9d0'

const fixture = (status, name) => () =>
  fixtureResponse(status, `comparison/${name}.json`)
const workspace = (status, name) => () =>
  fixtureResponse(status, `workspace/${name}.json`)
const expiredSession = () =>
  fixtureResponse(401, 'common/unauthorized-session.json')
const serverError = () =>
  fixtureResponse(500, 'common/internal-error-no-trace.json')
const noResponse = () => Promise.reject(new TypeError('Failed to fetch'))
const changed = () => jsonResponse(200, { success: true, data: { id: 41 } })

// Answers by "METHOD url". A list answers its calls in turn, repeating the
// last; an unknown request fails the call with its key.
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

function setup(routes) {
  const { fetch, calls } = Array.isArray(routes.calls) ? routes : server(routes)
  let clock = NOW
  const repository = createHttpComparisonRepository({
    client: createHttpClient({
      baseUrl: API,
      credentials: 'same-origin',
      fetch,
    }),
    files: createRemoteFiles({ fetch, now: () => clock.getTime() }),
    clock: () => clock,
  })
  return {
    repository,
    calls,
    setClock(time) {
      clock = time
    },
  }
}

// Each failing answer gives the code, with the server failure kept as cause.
function refusals(label, key, call, cases) {
  for (const [name, answer, code] of cases) {
    test(`${name} fails ${label} as ${code}`, async () => {
      const { repository } = setup({ [key]: answer })
      const error = await call(repository).then(
        () => assert.fail('expected a failure'),
        (failure) => failure,
      )
      assert.equal(error.name, 'ComparisonRepositoryError')
      assert.equal(error.code, code)
      assert.ok(apiErrorOf(error) instanceof ApiError)
    })
  }
}

// --- requestComparison -----------------------------------------------------

const REQUEST = `POST ${API}/performances/12/comparisons`

test('comparing a take posts it and returns the new comparison', async () => {
  const { repository, calls } = setup({ [REQUEST]: fixture(202, 'created') })
  const comparison = await repository.requestComparison('12', signal())
  assert.deepEqual(comparison, { id: '41', state: 'queued' })
  assert.deepEqual(keys(calls), [REQUEST])
  assert.equal(calls[0].init.body, undefined)
})

test('a take compared before returns that comparison as it ended', async () => {
  const { repository } = setup({ [REQUEST]: fixture(200, 'reused') })
  assert.deepEqual(await repository.requestComparison('12', signal()), {
    id: '40',
    state: 'success',
  })
})

refusals(
  'the request',
  REQUEST,
  (repository) => repository.requestComparison('12', signal()),
  [
    [
      'a take that is gone',
      fixture(404, 'performance-not-found'),
      'performance-unavailable',
    ],
    [
      'a section that is gone',
      workspace(404, 'segment-not-found'),
      'task-unavailable',
    ],
    [
      'a section changed since the take',
      fixture(409, 'segment-range-mismatch'),
      'section-changed',
    ],
    [
      'a guitar not separated yet',
      workspace(409, 'stem-not-ready'),
      'stem-not-ready',
    ],
    [
      'a take already being compared',
      fixture(409, 'comparison-in-progress'),
      'comparison-in-progress',
    ],
    [
      'a queue that refuses the job',
      fixture(503, 'job-enqueue-failed'),
      'enqueue-failed',
    ],
    ['a rejected session', expiredSession, 'expired'],
    ['a server error', serverError, 'enqueue-failed'],
    ['no response', noResponse, 'enqueue-failed'],
    ['a changed response', changed, 'enqueue-failed'],
  ],
)

// --- loadStatus, loadResult, loadPlayback ----------------------------------

const STATUS = `GET ${API}/comparisons/41`
const RESULT = `GET ${API}/comparisons/41/result`
const PLAYBACK = `GET ${API}/comparisons/41/playback`

test('a comparison status is read from the comparison', async () => {
  const { repository, calls } = setup({
    [STATUS]: fixture(200, 'status-processing'),
  })
  const status = await repository.loadStatus('41', signal())
  assert.equal(status.state, 'processing')
  assert.equal(status.currentStage, 'transcription')
  assert.deepEqual(keys(calls), [STATUS])
})

test('a finished comparison reads its result and its sounds', async () => {
  const { repository, calls } = setup({
    [RESULT]: fixture(200, 'result'),
    [PLAYBACK]: fixture(200, 'playback'),
  })
  const result = await repository.loadResult('41', signal())
  assert.equal(result.comparisonId, '41')
  assert.equal(result.regions.length, 4)
  const playback = await repository.loadPlayback('41', signal())
  assert.deepEqual(
    playback.tracks.map((track) => [track.kind, track.offsetSeconds]),
    [
      ['original', 12],
      ['stem', 0],
      ['performance', 0],
    ],
  )
  assert.deepEqual(keys(calls), [RESULT, PLAYBACK])
})

const LOAD_FAILURES = [
  [
    'a comparison that is gone',
    fixture(404, 'comparison-not-found'),
    'comparison-unavailable',
  ],
  ['a rejected session', expiredSession, 'expired'],
  // Not "gone": the screen asks again or offers to.
  ['a server error', serverError, 'load-failed'],
  ['no response', noResponse, 'load-failed'],
  ['a changed response', changed, 'load-failed'],
]
const NOT_READY = [
  'a comparison still running',
  fixture(409, 'comparison-not-ready'),
  'comparison-not-ready',
]

refusals(
  'the status',
  STATUS,
  (repository) => repository.loadStatus('41', signal()),
  LOAD_FAILURES,
)
refusals(
  'the result',
  RESULT,
  (repository) => repository.loadResult('41', signal()),
  [...LOAD_FAILURES, NOT_READY],
)
refusals(
  'the playback',
  PLAYBACK,
  (repository) => repository.loadPlayback('41', signal()),
  [...LOAD_FAILURES, NOT_READY],
)

// --- loadTrackAudio --------------------------------------------------------

const ORIGINAL = `GET ${ORIGINAL_URL}`
const PERFORMANCE = `GET ${PERFORMANCE_URL}`
const file = (text) => () => new Response(text, { status: 200 })

test('each sound downloads from its own signed URL', async () => {
  const { repository, calls } = setup({
    [PLAYBACK]: fixture(200, 'playback'),
    [ORIGINAL]: file('original'),
    [PERFORMANCE]: file('take'),
  })
  const original = await repository.loadTrackAudio('41', 'original', signal())
  assert.equal(await original.text(), 'original')
  const take = await repository.loadTrackAudio('41', 'performance', signal())
  assert.equal(await take.text(), 'take')
  assert.deepEqual(keys(calls), [PLAYBACK, ORIGINAL, PLAYBACK, PERFORMANCE])
  // Storage gets no cookies.
  assert.equal(calls[1].init.credentials, 'omit')
})

test('a signed sound URL is reused until a minute before it expires', async () => {
  const { repository, calls, setClock } = setup({
    [PLAYBACK]: fixture(200, 'playback'),
    [ORIGINAL]: file('original'),
  })
  await repository.loadTrackAudio('41', 'original', signal())
  await repository.loadTrackAudio('41', 'original', signal())
  assert.deepEqual(keys(calls), [PLAYBACK, ORIGINAL, ORIGINAL])

  setClock(new Date('2026-11-25T05:24:30Z'))
  await repository.loadTrackAudio('41', 'original', signal())
  assert.deepEqual(keys(calls).slice(3), [PLAYBACK, ORIGINAL])
})

test('a kept sound URL the storage refuses is signed again once', async () => {
  const { repository, calls } = setup({
    [PLAYBACK]: fixture(200, 'playback'),
    [ORIGINAL]: [
      file('original'),
      () => new Response('', { status: 403 }),
      file('original'),
    ],
  })
  await repository.loadTrackAudio('41', 'original', signal())
  const blob = await repository.loadTrackAudio('41', 'original', signal())
  assert.equal(await blob.text(), 'original')
  assert.deepEqual(keys(calls).slice(2), [ORIGINAL, PLAYBACK, ORIGINAL])
})

test('a sound the playback lists without a link has none to load', async () => {
  const { repository, calls } = setup({
    [PLAYBACK]: fixture(200, 'playback-partial'),
  })
  await assert.rejects(repository.loadTrackAudio('41', 'original', signal()), {
    name: 'ComparisonRepositoryError',
    code: 'audio-unavailable',
  })
  assert.deepEqual(keys(calls), [PLAYBACK])
})

for (const [name, routes, code] of [
  [
    'storage that cannot be reached',
    { [PLAYBACK]: fixture(200, 'playback'), [ORIGINAL]: noResponse },
    'audio-unavailable',
  ],
  [
    'a fresh URL the storage refuses',
    {
      [PLAYBACK]: fixture(200, 'playback'),
      [ORIGINAL]: () => new Response('', { status: 403 }),
    },
    'audio-unavailable',
  ],
  [
    'a comparison still running',
    { [PLAYBACK]: fixture(409, 'comparison-not-ready') },
    'audio-unavailable',
  ],
  ['a rejected session', { [PLAYBACK]: expiredSession }, 'expired'],
]) {
  test(`${name} fails a sound as ${code}`, async () => {
    const { repository } = setup(routes)
    await assert.rejects(
      repository.loadTrackAudio('41', 'original', signal()),
      {
        name: 'ComparisonRepositoryError',
        code,
      },
    )
  })
}

// --- markRegion ------------------------------------------------------------

const MARK = `PATCH ${API}/comparisons/41/regions/501`

test('marking a place sends whether it was checked', async () => {
  const { repository, calls } = setup({
    [MARK]: fixture(200, 'region-checked'),
  })
  assert.equal(
    await repository.markRegion('41', '501', true, signal()),
    undefined,
  )
  assert.deepEqual(keys(calls), [MARK])
  assert.deepEqual(JSON.parse(calls[0].init.body), { is_checked: true })
  assert.equal(
    new Headers(calls[0].init.headers).get('content-type'),
    'application/json',
  )
})

refusals(
  'a mark',
  MARK,
  (repository) => repository.markRegion('41', '501', false, signal()),
  [
    [
      'a place that is gone',
      fixture(404, 'region-not-found'),
      'region-unavailable',
    ],
    [
      'a comparison that is gone',
      fixture(404, 'comparison-not-found'),
      'comparison-unavailable',
    ],
    ['a rejected session', expiredSession, 'expired'],
    ['a server error', serverError, 'mark-failed'],
    ['no response', noResponse, 'mark-failed'],
    ['a changed response', changed, 'mark-failed'],
  ],
)

// --- retry -----------------------------------------------------------------

const RETRY = `POST ${API}/comparisons/41/retry`

test('a failed comparison is sent again and waits in the queue', async () => {
  const { repository, calls } = setup({ [RETRY]: fixture(202, 'retry') })
  assert.deepEqual(await repository.retry('41', signal()), {
    id: '41',
    state: 'queued',
  })
  assert.deepEqual(keys(calls), [RETRY])
})

refusals('a retry', RETRY, (repository) => repository.retry('41', signal()), [
  [
    'a comparison that is gone',
    fixture(404, 'comparison-not-found'),
    'comparison-unavailable',
  ],
  [
    'a failure that cannot be sent again',
    fixture(409, 'comparison-not-retryable'),
    'not-retryable',
  ],
  [
    'a failure out of tries',
    workspace(409, 'retry-limit-exceeded'),
    'retry-limit',
  ],
  [
    'a comparison already sent again',
    fixture(409, 'comparison-in-progress'),
    'comparison-in-progress',
  ],
  [
    'a queue that refuses the job',
    fixture(503, 'job-enqueue-failed'),
    'enqueue-failed',
  ],
  ['a rejected session', expiredSession, 'expired'],
  ['a server error', serverError, 'enqueue-failed'],
  ['no response', noResponse, 'enqueue-failed'],
  // A code is looked up in the table itself, never on its prototype.
  [
    'a code the table inherits',
    () =>
      jsonResponse(409, {
        success: false,
        error: { code: 'constructor', message: 'An unknown refusal.' },
      }),
    'enqueue-failed',
  ],
])

// --- cancelling ------------------------------------------------------------

test('a cancelled comparison call stays an AbortError', async () => {
  const { repository } = setup(pendingFetch())
  for (const call of [
    (aborting) => repository.requestComparison('12', aborting),
    (aborting) => repository.loadStatus('41', aborting),
    (aborting) => repository.loadResult('41', aborting),
    (aborting) => repository.loadPlayback('41', aborting),
    (aborting) => repository.loadTrackAudio('41', 'stem', aborting),
    (aborting) => repository.markRegion('41', '501', true, aborting),
    (aborting) => repository.retry('41', aborting),
  ]) {
    const controller = new AbortController()
    const pending = call(controller.signal)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
  }
})

test('the playback body keeps its links out of the screen model', async () => {
  const { repository } = setup({ [PLAYBACK]: fixture(200, 'playback') })
  const playback = await repository.loadPlayback('41', signal())
  const sent = readFixture('comparison/playback.json').data.tracks
  assert.equal(sent.length, playback.tracks.length)
  assert.ok(!JSON.stringify(playback).includes('storage.example.com'))
})
