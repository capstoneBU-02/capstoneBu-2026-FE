import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readComparisonCreated,
  readComparisonPlayback,
  readComparisonResult,
  readComparisonRetry,
  readComparisonStatus,
  readRegionCheck,
  toComparisonPlayback,
  toComparisonRef,
  toComparisonResult,
  toComparisonStatus,
} from '../src/features/comparison/adapter.ts'
import { fixtureData } from './fixtures/api/fetch.mjs'

// The comparison bodies of tests/fixtures/api/comparison as the screens read
// them. Comparison 41 compares take 12 with segment 31 (코러스).
const data = (name) => fixtureData(`comparison/${name}.json`)
const statusOf = (body) => toComparisonStatus(readComparisonStatus(body))
const status = (name) => statusOf(data(name))
const stagesOf = (view) => view.stages.map((stage) => stage.status)

test('a new or reused comparison reads its id and state', () => {
  assert.deepEqual(readComparisonCreated(data('created')), {
    comparison_id: 41,
    status: 'queued',
  })
  assert.deepEqual(toComparisonRef(readComparisonCreated(data('created'))), {
    id: '41',
    state: 'queued',
  })
  // A take compared before answers with that comparison, already finished.
  assert.deepEqual(toComparisonRef(readComparisonCreated(data('reused'))), {
    id: '40',
    state: 'success',
  })
  assert.throws(
    () => readComparisonCreated({ ...data('created'), status: 'cancelled' }),
    { path: 'data.status' },
  )
})

test('a retry reads the comparison sent again', () => {
  assert.deepEqual(toComparisonRef(readComparisonRetry(data('retry'))), {
    id: '41',
    state: 'queued',
  })
  assert.throws(() => readComparisonRetry({ status: 'queued' }), {
    path: 'data.comparison_id',
  })
})

test('a comparison status reads the fields the screens use', () => {
  assert.deepEqual(readComparisonStatus(data('status-failed')), {
    comparison_id: 41,
    status: 'failed',
    current_stage: 'transcription',
    not_comparable_reason: null,
    stages: [
      { stage: 'align', status: 'success' },
      { stage: 'transcription', status: 'failed' },
      { stage: 'compare', status: 'queued' },
    ],
    failure: {
      stage: 'transcription',
      error_code: 'AI_WORKER_ERROR',
      retryable: true,
      max_retries: 3,
      retries_left: 2,
    },
  })
  const body = data('status-processing')
  assert.throws(() => readComparisonStatus({ ...body, status: 'done' }), {
    path: 'data.status',
  })
  assert.throws(
    () => readComparisonStatus({ ...body, current_stage: 'separation' }),
    { path: 'data.current_stage' },
  )
  assert.throws(
    () =>
      readComparisonStatus({
        ...body,
        stages: [{ stage: 'align', status: 'running' }],
      }),
    { path: 'data.stages[0].status' },
  )
})

test('a finished comparison keeps the server reason it could not compare', () => {
  assert.deepEqual(status('status-not-comparable'), {
    id: '41',
    state: 'not-comparable',
    currentStage: 'align',
    stages: [
      { id: 'align', status: 'done' },
      { id: 'transcription', status: 'skipped' },
      { id: 'compare', status: 'skipped' },
    ],
    notComparableReason: 'RERECORD_TOO_LONG',
    failure: null,
  })
})

for (const [name, fixture, state, currentStage, stages] of [
  [
    'waiting for its first stage',
    'status-queued',
    'queued',
    null,
    ['waiting', 'waiting', 'waiting'],
  ],
  [
    'running a stage',
    'status-processing',
    'processing',
    'transcription',
    ['done', 'running', 'waiting'],
  ],
  // Between two stages the server names the stage that just finished.
  [
    'waiting between two stages',
    'status-between-stages',
    'queued',
    'align',
    ['done', 'waiting', 'waiting'],
  ],
  // Sent again: the stage that failed waits for its turn, as the one before
  // it just finished.
  [
    'sent again after a failure',
    'status-retried',
    'queued',
    'align',
    ['done', 'waiting', 'waiting'],
  ],
  [
    'finished',
    'status-success',
    'success',
    'compare',
    ['done', 'done', 'done'],
  ],
  [
    'failed at a stage',
    'status-failed',
    'failed',
    'transcription',
    ['done', 'failed', 'waiting'],
  ],
  // A job the server gave up on leaves its stage running in the server's list.
  [
    'given up while running',
    'status-failed-stale',
    'failed',
    'compare',
    ['done', 'done', 'failed'],
  ],
  [
    'given up before starting',
    'status-failed-unstarted',
    'failed',
    null,
    ['failed', 'waiting', 'waiting'],
  ],
  [
    'failed on the take itself',
    'status-failed-invalid-audio',
    'failed',
    'align',
    ['failed', 'waiting', 'waiting'],
  ],
]) {
  test(`a comparison ${name} shows its stages as the screens name them`, () => {
    const view = status(fixture)
    assert.equal(view.id, '41')
    assert.equal(view.state, state)
    assert.equal(view.currentStage, currentStage)
    assert.deepEqual(stagesOf(view), stages)
    assert.deepEqual(
      view.stages.map((stage) => stage.id),
      ['align', 'transcription', 'compare'],
    )
    assert.equal(view.notComparableReason, null)
  })
}

test('a comparison sent again from its first stage has no stage behind it', () => {
  const body = data('status-retried')
  const view = statusOf({
    ...body,
    current_stage: 'align',
    stages: [
      { stage: 'align', status: 'failed' },
      { stage: 'transcription', status: 'queued' },
      { stage: 'compare', status: 'queued' },
    ],
  })
  assert.equal(view.currentStage, null)
  assert.deepEqual(stagesOf(view), ['waiting', 'waiting', 'waiting'])
})

test('stages come in their own order, a missing one waiting', () => {
  const body = data('status-processing')
  const view = statusOf({
    ...body,
    stages: [
      { stage: 'transcription', status: 'processing' },
      { stage: 'align', status: 'success' },
    ],
  })
  assert.deepEqual(view.stages, [
    { id: 'align', status: 'done' },
    { id: 'transcription', status: 'running' },
    { id: 'compare', status: 'waiting' },
  ])
})

for (const [name, fixture, failure] of [
  [
    'a failure with tries left',
    'status-failed',
    {
      stage: 'transcription',
      code: 'AI_WORKER_ERROR',
      retry: { left: 2, limit: 3 },
    },
  ],
  [
    'a job given up while running',
    'status-failed-stale',
    {
      stage: 'compare',
      code: 'AI_WORKER_TIMEOUT',
      retry: { left: 3, limit: 3 },
    },
  ],
  // Without a stage from the server it failed before the first one.
  [
    'a job given up before starting',
    'status-failed-unstarted',
    { stage: 'align', code: 'AI_WORKER_TIMEOUT', retry: { left: 3, limit: 3 } },
  ],
  [
    'a take that cannot be read',
    'status-failed-invalid-audio',
    { stage: 'align', code: 'PERFORMANCE_INVALID_AUDIO', retry: null },
  ],
  // Out of tries, it still shows the limit (TaskDetail.retry).
  [
    'a failure out of tries',
    'status-failed-limit',
    { stage: 'compare', code: 'AI_WORKER_ERROR', retry: { left: 0, limit: 3 } },
  ],
]) {
  test(`${name} keeps its stage, code and tries`, () => {
    assert.deepEqual(status(fixture).failure, failure)
  })
}

test('only a failed comparison has a failure', () => {
  assert.equal(status('status-processing').failure, null)
  assert.equal(status('status-success').failure, null)
})

test('a comparison result becomes seconds, kinds and checks', () => {
  assert.deepEqual(toComparisonResult(readComparisonResult(data('result'))), {
    comparisonId: '41',
    state: 'success',
    notComparableReason: null,
    baseline: 'original-song',
    overallTempo: { isSlow: true },
    regions: [
      {
        id: '501',
        kind: 'pitch-difference',
        startSeconds: 0.4,
        endSeconds: 0.7,
        performanceStartSeconds: 0.42,
        performanceEndSeconds: 0.73,
        unavailableReason: null,
        checked: false,
      },
      {
        id: '502',
        kind: 'missing-note',
        startSeconds: 1.1,
        endSeconds: 1.35,
        performanceStartSeconds: 1.15,
        performanceEndSeconds: 1.4,
        unavailableReason: null,
        checked: false,
      },
      {
        id: '503',
        kind: 'timing-difference',
        startSeconds: 1.8,
        endSeconds: 2.05,
        performanceStartSeconds: 1.88,
        performanceEndSeconds: 2.14,
        unavailableReason: null,
        checked: true,
      },
      {
        id: '504',
        kind: 'unavailable',
        startSeconds: 2.4,
        endSeconds: 2.8,
        performanceStartSeconds: 2.5,
        performanceEndSeconds: 2.9,
        unavailableReason: 'LOW_CONFIDENCE',
        checked: false,
      },
    ],
  })
})

test('a result that could not compare keeps its reason and has no places', () => {
  assert.deepEqual(
    toComparisonResult(readComparisonResult(data('result-not-comparable'))),
    {
      comparisonId: '41',
      state: 'not-comparable',
      notComparableReason: 'RERECORD_TOO_LONG',
      baseline: 'separated-input',
      overallTempo: null,
      regions: [],
    },
  )
})

test('a changed result fails with the field path', () => {
  const body = data('result')
  assert.throws(() => readComparisonResult({ ...body, status: 'failed' }), {
    path: 'data.status',
  })
  assert.throws(
    () =>
      readComparisonResult({
        ...body,
        baseline: { ...body.baseline, source: 'cover' },
      }),
    { path: 'data.baseline.source' },
  )
  assert.throws(
    () =>
      readComparisonResult({
        ...body,
        regions: [{ ...body.regions[0], type: 'extra_note' }],
      }),
    { path: 'data.regions[0].type' },
  )
  assert.throws(
    () =>
      readComparisonResult({
        ...body,
        regions: [{ ...body.regions[0], start_ms: 0.4 }],
      }),
    { path: 'data.regions[0].start_ms' },
  )
})

test('playback lists each sound with where the section starts in it', () => {
  assert.deepEqual(
    toComparisonPlayback(readComparisonPlayback(data('playback'))),
    {
      comparisonId: '41',
      isPartial: false,
      tracks: [
        { kind: 'original', available: true, offsetSeconds: 12 },
        { kind: 'stem', available: true, offsetSeconds: 0 },
        { kind: 'performance', available: true, offsetSeconds: 0 },
      ],
    },
  )
  const partial = toComparisonPlayback(
    readComparisonPlayback(data('playback-partial')),
  )
  assert.equal(partial.isPartial, true)
  assert.deepEqual(partial.tracks[0], {
    kind: 'original',
    available: false,
    offsetSeconds: 12,
  })
})

test('a sound without a link cannot play, whatever the server says', () => {
  const body = data('playback')
  const view = toComparisonPlayback(
    readComparisonPlayback({
      ...body,
      tracks: [{ ...body.tracks[0], url: null }],
    }),
  )
  assert.equal(view.tracks[0].available, false)
  assert.throws(
    () =>
      readComparisonPlayback({
        ...body,
        tracks: [{ ...body.tracks[0], type: 'mix' }],
      }),
    { path: 'data.tracks[0].type' },
  )
  assert.throws(() => readComparisonPlayback({ ...body, expires_at: null }), {
    path: 'data.expires_at',
  })
})

test('a region check reads the mark the server kept', () => {
  assert.deepEqual(readRegionCheck(data('region-checked')), {
    region_id: 501,
    is_checked: true,
  })
  assert.throws(() => readRegionCheck({ region_id: 501 }), {
    path: 'data.is_checked',
  })
})
