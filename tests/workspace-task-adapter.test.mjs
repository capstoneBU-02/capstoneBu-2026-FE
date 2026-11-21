import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readCancel,
  readProcessingStatus,
  readRetry,
  readSegment,
  readStemCreated,
  readStemPlayback,
  readTabCreated,
  readWorkFailure,
  segmentNameValue,
  tabRequestFor,
  toMilliseconds,
} from '../src/features/workspace/taskAdapter.ts'
import { taskStateOf } from '../src/features/workspace/taskState.ts'
import { serverTime, updatedAtLabel } from '../src/features/workspace/format.ts'
import { fixtureData } from './fixtures/api/fetch.mjs'

const data = (name) => fixtureData(`workspace/${name}.json`)

test('a segment answer keeps its id, range and change time', () => {
  assert.deepEqual(readSegment(data('segment-create')), {
    segment_id: 31,
    start_ms: 12300,
    end_ms: 27800,
    updated_at: '2026-11-21T06:10:02.114820Z',
  })
  assert.throws(
    () => readSegment({ ...data('segment-create'), start_ms: 12.3 }),
    { name: 'ResponseShapeError', path: 'data.start_ms' },
  )
})

test('stem and tab requests keep the id, status and whether it was reused', () => {
  assert.deepEqual(readStemCreated(data('stem-created')), {
    stem_id: 54,
    status: 'queued',
    is_reused: false,
  })
  assert.deepEqual(readTabCreated(data('tab-created')), {
    tab_id: 88,
    status: 'queued',
    is_reused: false,
  })
  // A tab is never cancelled, so the status says something changed.
  assert.throws(
    () => readTabCreated({ ...data('tab-created'), status: 'canceled' }),
    { path: 'data.status' },
  )
})

test('the processing status reads each side or null', () => {
  assert.deepEqual(readProcessingStatus(data('status-nothing-requested')), {
    segment_id: 31,
    stem: null,
    tab: null,
    updated_at: null,
  })
  assert.deepEqual(readProcessingStatus(data('status-tab-failed')), {
    segment_id: 31,
    stem: {
      stem_id: 54,
      status: 'success',
      current_stage: 'separation',
      playable: true,
      retryable: false,
    },
    tab: {
      tab_id: 88,
      status: 'failed',
      current_stage: 'transcription',
      retryable: true,
    },
    updated_at: '2026-11-21T06:13:02.497115Z',
  })
  const unknown = data('status-queued')
  assert.throws(
    () =>
      readProcessingStatus({
        ...unknown,
        stem: { ...unknown.stem, status: 'paused' },
      }),
    { path: 'data.stem.status' },
  )
})

test('stem and tab details are read for their failure only', () => {
  assert.deepEqual(readWorkFailure(data('stem-failed')), {
    failure: {
      error_code: 'AI_WORKER_TIMEOUT',
      retryable: true,
      max_retries: 3,
      retries_left: 2,
    },
  })
  assert.deepEqual(readWorkFailure(data('tab-failed')).failure, {
    error_code: 'TAB_NO_NOTES',
    retryable: true,
    max_retries: 3,
    retries_left: 3,
  })
  assert.deepEqual(readWorkFailure({ ...data('stem-failed'), failure: null }), {
    failure: null,
  })
})

test('retry, cancel and playback answers read what the repository uses', () => {
  assert.deepEqual(readRetry(data('stem-retry')), { status: 'queued' })
  assert.deepEqual(readRetry(data('tab-retry')), { status: 'queued' })
  assert.deepEqual(readCancel(data('stem-cancel')), {
    stem_id: 54,
    status: 'canceled',
  })
  const playback = readStemPlayback(data('stem-playback'))
  assert.equal(playback.expires_at, '2026-11-21T06:23:20.000000Z')
  assert.deepEqual(playback.tracks[0], {
    type: 'guitar',
    available: true,
    url: 'https://storage.example.com/stems/54/guitar.wav?X-Amz-Expires=600&X-Amz-Signature=a1b2',
  })
  assert.deepEqual(
    readStemPlayback({
      ...data('stem-playback'),
      tracks: [{ type: 'guitar', label: '기타', available: false, url: null }],
    }).tracks,
    [{ type: 'guitar', available: false, url: null }],
  )
})

test('section names map to the server names without their number', () => {
  for (const [name, value] of [
    ['인트로', 'INTRO'],
    ['벌스 2', 'VERSE'],
    ['프리코러스', 'PRE_CHORUS'],
    ['코러스 12', 'CHORUS'],
    ['브리지', 'BRIDGE'],
    ['인터루드', 'INTERLUDE'],
    ['아웃트로 3', 'OUTRO'],
  ])
    assert.equal(segmentNameValue(name), value, name)
  // The server has no solo; the name stays on the screen alone.
  assert.equal(segmentNameValue('솔로 2'), undefined)
  assert.equal(segmentNameValue('후렴'), undefined)
})

test('times travel as whole milliseconds', () => {
  assert.equal(toMilliseconds(12.3), 12300)
  assert.equal(toMilliseconds(0.1), 100)
  assert.equal(toMilliseconds(27.8), 27800)
  assert.equal(toMilliseconds(299.9), 299900)
})

test('only the tunings the server takes become a tab request', () => {
  assert.deepEqual(tabRequestFor('e-standard'), {
    result_type: 'original',
    tuning_id: 'e_standard',
    capo: 0,
  })
  assert.equal(tabRequestFor('drop-d'), null)
  assert.equal(tabRequestFor('e-flat'), null)
})

const BASE_TASK = {
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

function stateOf(statusName, { failure = null, inputKind = 'original' } = {}) {
  return taskStateOf({
    task: BASE_TASK,
    status: readProcessingStatus(data(statusName)),
    failure: failure && readWorkFailure(data(failure)).failure,
    inputKind,
    updatedAtLabel: '오늘 15:13',
  })
}

const stages = (separation, transcription) => [
  { id: 'separation', status: separation },
  { id: 'transcription', status: transcription },
]

for (const [statusName, options, expected] of [
  [
    'status-nothing-requested',
    {},
    { processingStatus: 'queued', stages: stages('waiting', 'waiting') },
  ],
  [
    'status-queued',
    {},
    { processingStatus: 'queued', stages: stages('waiting', 'waiting') },
  ],
  // Waiting for the next stage is still work under way.
  [
    'status-between-stages',
    {},
    { processingStatus: 'processing', stages: stages('running', 'waiting') },
  ],
  [
    'status-separating',
    {},
    { processingStatus: 'processing', stages: stages('running', 'waiting') },
  ],
  // The tab is requested once the guitar is ready.
  [
    'status-stem-ready',
    {},
    {
      processingStatus: 'processing',
      hasSeparatedAudio: true,
      stages: stages('done', 'running'),
    },
  ],
  [
    'status-tab-running',
    {},
    {
      processingStatus: 'processing',
      hasSeparatedAudio: true,
      stages: stages('done', 'running'),
    },
  ],
  [
    'status-completed',
    {},
    {
      processingStatus: 'completed',
      hasSeparatedAudio: true,
      stages: stages('done', 'done'),
    },
  ],
  [
    'status-stem-failed',
    { failure: 'stem-failed' },
    {
      processingStatus: 'failed',
      stages: stages('failed', 'waiting'),
      retry: { left: 2, limit: 3 },
    },
  ],
  [
    'status-stem-failed',
    { failure: 'stem-no-guitar' },
    {
      processingStatus: 'failed',
      failureKind: 'no-guitar',
      stages: stages('failed', 'waiting'),
    },
  ],
  [
    'status-stem-failed',
    { failure: 'stem-invalid-audio' },
    {
      processingStatus: 'failed',
      failureKind: 'invalid-audio',
      stages: stages('failed', 'waiting'),
    },
  ],
  [
    'status-tab-failed',
    { failure: 'tab-failed' },
    {
      processingStatus: 'failed',
      failureKind: 'transcription',
      hasSeparatedAudio: true,
      stages: stages('done', 'failed'),
      retry: { left: 3, limit: 3 },
    },
  ],
  [
    'status-queued',
    { inputKind: 'separated-guitar' },
    { processingStatus: 'queued', stages: stages('skipped', 'waiting') },
  ],
  // Separated-guitar input still has the song cut and checked first.
  [
    'status-between-stages',
    { inputKind: 'separated-guitar' },
    { processingStatus: 'processing', stages: stages('skipped', 'running') },
  ],
  [
    'status-stem-ready',
    { inputKind: 'separated-guitar' },
    {
      processingStatus: 'processing',
      hasSeparatedAudio: true,
      stages: stages('skipped', 'running'),
    },
  ],
  [
    'status-completed',
    { inputKind: 'separated-guitar' },
    {
      processingStatus: 'completed',
      hasSeparatedAudio: true,
      stages: stages('skipped', 'done'),
    },
  ],
  // Its only stage on screen is the one that failed.
  [
    'status-stem-failed',
    { failure: 'stem-failed', inputKind: 'separated-guitar' },
    {
      processingStatus: 'failed',
      stages: stages('skipped', 'failed'),
      retry: { left: 2, limit: 3 },
    },
  ],
]) {
  const label = [statusName, options.failure, options.inputKind]
    .filter(Boolean)
    .join(' + ')
  test(`processing status: ${label}`, () => {
    const state = stateOf(statusName, options)
    assert.deepEqual(state, {
      task: {
        ...BASE_TASK,
        processingStatus: expected.processingStatus,
        failureKind: expected.failureKind ?? null,
        hasSeparatedAudio: expected.hasSeparatedAudio ?? false,
        updatedAtLabel: '오늘 15:13',
      },
      stages: expected.stages,
      retry: expected.retry ?? null,
    })
  })
}

test('a result the server wants checked counts as finished', () => {
  const status = readProcessingStatus(data('status-completed'))
  const state = taskStateOf({
    task: BASE_TASK,
    status: {
      ...status,
      stem: { ...status.stem, status: 'needs_review' },
      tab: { ...status.tab, status: 'needs_review' },
    },
    failure: null,
    inputKind: 'original',
    updatedAtLabel: '방금',
  })
  assert.equal(state.task.processingStatus, 'completed')
  assert.deepEqual(state.stages, stages('done', 'done'))
})

test('a failure with no tries left still shows the limit', () => {
  const failure = {
    ...readWorkFailure(data('tab-failed')).failure,
    retryable: false,
    retries_left: 0,
  }
  const state = taskStateOf({
    task: BASE_TASK,
    status: readProcessingStatus(data('status-tab-failed')),
    failure,
    inputKind: 'original',
    updatedAtLabel: '방금',
  })
  assert.deepEqual(state.retry, { left: 0, limit: 3 })
})

test('a failure without its details offers no retry', () => {
  const state = stateOf('status-stem-failed')
  assert.equal(state.task.failureKind, null)
  assert.equal(state.retry, null)
})

test('change times read like the list labels', () => {
  const now = new Date(2026, 10, 21, 15, 20)
  const at = (...parts) => new Date(...parts).toISOString()
  assert.equal(updatedAtLabel(at(2026, 10, 21, 15, 19, 30), now), '방금')
  assert.equal(updatedAtLabel(at(2026, 10, 21, 9, 5), now), '오늘 09:05')
  assert.equal(updatedAtLabel(at(2026, 10, 20, 23, 59), now), '어제')
  assert.equal(updatedAtLabel(at(2026, 9, 25, 12, 0), now), '10월 25일')
  // A clock slightly behind the server's still reads as now.
  assert.equal(updatedAtLabel(at(2026, 10, 21, 15, 20, 20), now), '방금')
  assert.equal(updatedAtLabel('not a time', now), '')
})

test('server times keep milliseconds from their microseconds', () => {
  assert.equal(
    serverTime('2026-11-21T06:10:02.114820Z'),
    Date.parse('2026-11-21T06:10:02.114Z'),
  )
  assert.equal(
    serverTime('2026-11-21T06:23:20Z'),
    Date.parse('2026-11-21T06:23:20.000Z'),
  )
  assert.ok(Number.isNaN(serverTime('not a time')))
  assert.equal(
    updatedAtLabel(
      '2026-11-21T06:10:02.114820Z',
      new Date('2026-11-21T06:10:30Z'),
    ),
    '방금',
  )
})
