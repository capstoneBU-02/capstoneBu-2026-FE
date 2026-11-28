import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockComparisonRepository } from '../src/features/comparison/mockComparisonRepository.ts'

const signal = () => new AbortController().signal

// A run takes 800 ms: see comparison-run.test.mjs.
const timing = {
  queueMs: 100,
  stageQueueMs: 50,
  stageMs: { align: 200, transcription: 300, compare: 100 },
}
const RUN_MS = 800

const TASK_ID = 'task-verse'

function setup(options = {}) {
  const clock = { now: 0 }
  const sections = new Map([
    [
      TASK_ID,
      {
        rangeStartSeconds: 10,
        rangeEndSeconds: 30,
        hasSeparatedAudio: true,
        inputKind: 'original',
      },
    ],
  ])
  const repository = createMockComparisonRepository({
    sectionOf: (taskId) => sections.get(taskId),
    loadBaselineAudio: async (taskId, kind) =>
      new Blob([`${taskId}:${kind}`], { type: 'audio/wav' }),
    now: () => clock.now,
    timing,
    requestDelayMs: 0,
    ...options,
  })
  return { clock, repository, sections }
}

const take = (overrides = {}) => ({
  taskId: TASK_ID,
  source: 'recording',
  audio: new Blob(['take'], { type: 'audio/wav' }),
  durationSeconds: 20,
  ...overrides,
})

async function saved(repository, overrides) {
  return repository.savePerformance(take(overrides), signal())
}

// A saved performance whose comparison has finished.
async function compared(context, overrides) {
  const performance = await saved(context.repository, overrides)
  const status = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  context.clock.now += RUN_MS
  return { performance, comparisonId: status.id }
}

const failedOnce = () => [
  {
    kind: 'failed',
    stage: 'transcription',
    code: 'AI_WORKER_ERROR',
    retryable: true,
  },
  { kind: 'success' },
]

test('a saved performance keeps the section it was played against', async () => {
  const { repository, sections } = setup()

  const performance = await saved(repository)
  sections.set(TASK_ID, { ...sections.get(TASK_ID), rangeEndSeconds: 40 })

  assert.equal(performance.taskId, TASK_ID)
  assert.equal(performance.source, 'recording')
  assert.equal(performance.rangeStartSeconds, 10)
  assert.equal(performance.rangeEndSeconds, 30)
  assert.equal(performance.durationSeconds, 20)
  assert.equal(performance.latestComparison, null)
})

test('performances are listed newest first, per task', async () => {
  const { repository, sections } = setup()
  sections.set('task-solo', sections.get(TASK_ID))

  const first = await saved(repository)
  const second = await saved(repository, { source: 'upload' })
  await saved(repository, { taskId: 'task-solo' })

  const list = await repository.listPerformances(TASK_ID, signal())
  assert.deepEqual(
    list.map((performance) => performance.id),
    [second.id, first.id],
  )
})

test('a performance needs a known task and a file with sound', async () => {
  const { repository } = setup()

  await assert.rejects(saved(repository, { taskId: 'task-other' }), {
    code: 'task-unavailable',
  })
  await assert.rejects(saved(repository, { audio: new Blob([]) }), {
    code: 'invalid-audio',
  })
})

test('a comparison moves on the session clock until it finishes', async () => {
  const { clock, repository } = setup()
  const performance = await saved(repository)

  const requested = await repository.requestComparison(performance.id, signal())
  assert.deepEqual(requested, { id: requested.id, state: 'queued' })

  clock.now = 400
  const running = await repository.loadStatus(requested.id, signal())
  assert.equal(running.state, 'processing')
  assert.equal(running.currentStage, 'transcription')

  clock.now = RUN_MS
  const finished = await repository.loadStatus(requested.id, signal())
  assert.equal(finished.state, 'success')
  assert.equal(finished.failure, null)
  assert.equal(finished.notComparableReason, null)
})

test('the performance list points at the latest comparison (REC-04)', async () => {
  const context = setup()
  const { performance, comparisonId } = await compared(context)

  const [listed] = await context.repository.listPerformances(TASK_ID, signal())
  assert.equal(listed.id, performance.id)
  assert.deepEqual(listed.latestComparison, {
    id: comparisonId,
    state: 'success',
  })
})

test('asking again for a finished comparison returns the same one', async () => {
  const context = setup()
  const { performance, comparisonId } = await compared(context)

  const again = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  assert.equal(again.id, comparisonId)
  assert.equal(again.state, 'success')
})

test('a comparison still running cannot be requested again', async () => {
  const { repository } = setup()
  const performance = await saved(repository)
  await repository.requestComparison(performance.id, signal())

  await assert.rejects(repository.requestComparison(performance.id, signal()), {
    code: 'comparison-in-progress',
  })
})

test('an unknown performance or comparison is not found', async () => {
  const { repository } = setup()

  await assert.rejects(repository.requestComparison('nope', signal()), {
    code: 'performance-unavailable',
  })
  for (const load of [
    repository.loadStatus,
    repository.loadResult,
    repository.loadPlayback,
  ]) {
    await assert.rejects(load('nope', signal()), {
      code: 'comparison-unavailable',
    })
  }
})

test('a changed section refuses a new comparison but keeps the old result', async () => {
  const context = setup()
  const { performance, comparisonId } = await compared(context)
  const waiting = await saved(context.repository)
  context.sections.set(TASK_ID, {
    ...context.sections.get(TASK_ID),
    rangeEndSeconds: 40,
  })

  await assert.rejects(
    context.repository.requestComparison(waiting.id, signal()),
    { code: 'section-changed' },
  )
  await assert.rejects(
    context.repository.requestComparison(performance.id, signal()),
    { code: 'section-changed' },
  )

  const kept = await context.repository.loadResult(comparisonId, signal())
  assert.equal(kept.state, 'success')
})

test('the section is checked before the guitar sound', async () => {
  const { repository, sections } = setup()
  const performance = await saved(repository)
  sections.set(TASK_ID, {
    ...sections.get(TASK_ID),
    rangeEndSeconds: 40,
    hasSeparatedAudio: false,
  })

  await assert.rejects(repository.requestComparison(performance.id, signal()), {
    code: 'section-changed',
  })
})

test('a task that is gone leaves its takes unavailable', async () => {
  const { repository, sections } = setup()
  const performance = await saved(repository)
  sections.delete(TASK_ID)

  await assert.rejects(repository.requestComparison(performance.id, signal()), {
    code: 'performance-unavailable',
  })
})

test('a run past its first stage still blocks another request', async () => {
  const { clock, repository } = setup()
  const performance = await saved(repository)
  const { id } = await repository.requestComparison(performance.id, signal())
  clock.now = 400

  await assert.rejects(repository.requestComparison(performance.id, signal()), {
    code: 'comparison-in-progress',
  })
  await assert.rejects(repository.retry(id, signal()), {
    code: 'not-retryable',
  })
})

test('a restarted run blocks requests and is the one reused after', async () => {
  const context = setup({ outcomesFor: failedOnce })
  const { performance, comparisonId: first } = await compared(context)
  const { id: second } = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  context.clock.now += RUN_MS

  await context.repository.retry(first, signal())
  await assert.rejects(
    context.repository.requestComparison(performance.id, signal()),
    { code: 'comparison-in-progress' },
  )
  await assert.rejects(context.repository.retry(second, signal()), {
    code: 'comparison-in-progress',
  })

  context.clock.now += RUN_MS
  const again = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  assert.deepEqual(again, { id: first, state: 'success' })
  const [listed] = await context.repository.listPerformances(TASK_ID, signal())
  assert.deepEqual(listed.latestComparison, { id: first, state: 'success' })
})

test('a take that could not be compared is not compared again', async () => {
  const context = setup()
  const { performance, comparisonId } = await compared(context, {
    durationSeconds: 8,
  })

  const again = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  assert.deepEqual(again, { id: comparisonId, state: 'not-comparable' })
})

test('how a run ends stays unknown until it ends', async () => {
  const failing = setup({ outcomesFor: failedOnce })
  const failingTake = await saved(failing.repository)
  const { id: failingId } = await failing.repository.requestComparison(
    failingTake.id,
    signal(),
  )
  failing.clock.now = 400
  const running = await failing.repository.loadStatus(failingId, signal())
  assert.equal(running.failure, null)

  const refused = setup()
  const shortTake = await saved(refused.repository, { durationSeconds: 8 })
  const { id: refusedId } = await refused.repository.requestComparison(
    shortTake.id,
    signal(),
  )
  refused.clock.now = 150
  const aligning = await refused.repository.loadStatus(refusedId, signal())
  assert.equal(aligning.notComparableReason, null)
})

test('a take outside the length the server accepts ends as it would there', async () => {
  const tooLong = setup()
  const long = await compared(tooLong, { durationSeconds: 41 })
  const longStatus = await tooLong.repository.loadStatus(
    long.comparisonId,
    signal(),
  )
  assert.equal(longStatus.notComparableReason, 'RERECORD_TOO_LONG')

  const longest = setup()
  const edge = await compared(longest, { durationSeconds: 40 })
  const edgeStatus = await longest.repository.loadStatus(
    edge.comparisonId,
    signal(),
  )
  assert.equal(edgeStatus.state, 'success')

  const unreadable = setup()
  const broken = await compared(unreadable, { durationSeconds: Number.NaN })
  const brokenStatus = await unreadable.repository.loadStatus(
    broken.comparisonId,
    signal(),
  )
  assert.equal(brokenStatus.failure.code, 'PERFORMANCE_INVALID_AUDIO')
  assert.equal(brokenStatus.failure.retry, null)
})

test('a take counts as slow from 1.1 times the section (CMP-02)', async () => {
  for (const [durationSeconds, isSlow] of [
    [21.9, false],
    [22, true],
  ]) {
    const context = setup()
    const { comparisonId } = await compared(context, { durationSeconds })
    const result = await context.repository.loadResult(comparisonId, signal())
    assert.deepEqual(result.overallTempo, { isSlow })
  }
})

test('the tempo is known once the two sounds were aligned (CMP-02)', async () => {
  const context = setup({
    outcomesFor: () => [
      {
        kind: 'not-comparable',
        stage: 'transcription',
        reason: 'RERECORD_FEW_NOTES',
      },
    ],
  })
  const { comparisonId } = await compared(context)

  const result = await context.repository.loadResult(comparisonId, signal())
  assert.deepEqual(result.overallTempo, { isSlow: false })
  assert.deepEqual(result.regions, [])
})

test('a section without separated guitar cannot be compared yet', async () => {
  const { repository, sections } = setup()
  const performance = await saved(repository)
  sections.set(TASK_ID, {
    ...sections.get(TASK_ID),
    hasSeparatedAudio: false,
  })

  await assert.rejects(repository.requestComparison(performance.id, signal()), {
    code: 'stem-not-ready',
  })
})

test('a take much shorter than the section cannot be compared', async () => {
  const context = setup()
  const { comparisonId } = await compared(context, { durationSeconds: 8 })

  const status = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(status.state, 'not-comparable')
  assert.equal(status.notComparableReason, 'RERECORD_TOO_SHORT')
  assert.deepEqual(
    status.stages.map((stage) => stage.status),
    ['done', 'skipped', 'skipped'],
  )

  const result = await context.repository.loadResult(comparisonId, signal())
  assert.equal(result.notComparableReason, 'RERECORD_TOO_SHORT')
  assert.deepEqual(result.regions, [])
  assert.equal(result.overallTempo, null)

  await assert.rejects(context.repository.retry(comparisonId, signal()), {
    code: 'not-retryable',
  })
})

test('a result opens only after the comparison has finished', async () => {
  const { clock, repository } = setup()
  const performance = await saved(repository)
  const { id } = await repository.requestComparison(performance.id, signal())

  await assert.rejects(repository.loadResult(id, signal()), {
    code: 'comparison-not-ready',
  })
  await assert.rejects(repository.loadPlayback(id, signal()), {
    code: 'comparison-not-ready',
  })

  clock.now = RUN_MS
  assert.equal((await repository.loadResult(id, signal())).state, 'success')
})

test('a result lists differences and places it could not compare', async () => {
  const context = setup()
  const { comparisonId } = await compared(context, { durationSeconds: 24 })

  const result = await context.repository.loadResult(comparisonId, signal())
  assert.equal(result.baseline, 'original-song')
  assert.deepEqual(result.overallTempo, { isSlow: true })
  assert.deepEqual(
    result.regions.map((region) => region.kind),
    ['pitch-difference', 'missing-note', 'timing-difference', 'unavailable'],
  )

  const [first] = result.regions
  assert.ok(first.endSeconds > first.startSeconds)
  assert.ok(
    Math.abs(first.performanceStartSeconds / first.startSeconds - 1.2) < 0.01,
  )
  assert.equal(first.unavailableReason, null)
  assert.equal(result.regions[3].unavailableReason, 'LOW_CONFIDENCE')
})

test('a take at the section pace is not called slow', async () => {
  const context = setup()
  const { comparisonId } = await compared(context)

  const { overallTempo } = await context.repository.loadResult(
    comparisonId,
    signal(),
  )
  assert.deepEqual(overallTempo, { isSlow: false })
})

test('a checked place stays checked for that comparison only', async () => {
  const context = setup()
  const first = await compared(context)
  const { regions } = await context.repository.loadResult(
    first.comparisonId,
    signal(),
  )

  await context.repository.markRegion(
    first.comparisonId,
    regions[0].id,
    true,
    signal(),
  )
  const reloaded = await context.repository.loadResult(
    first.comparisonId,
    signal(),
  )
  assert.deepEqual(
    reloaded.regions.map((region) => region.checked),
    [true, false, false, false],
  )

  const second = await compared(context)
  const fresh = await context.repository.loadResult(
    second.comparisonId,
    signal(),
  )
  assert.ok(fresh.regions.every((region) => !region.checked))

  await context.repository.markRegion(
    first.comparisonId,
    regions[0].id,
    false,
    signal(),
  )
  const cleared = await context.repository.loadResult(
    first.comparisonId,
    signal(),
  )
  assert.equal(cleared.regions[0].checked, false)
})

test('marking a place that does not exist fails', async () => {
  const context = setup()
  const { comparisonId } = await compared(context)

  await assert.rejects(
    context.repository.markRegion(comparisonId, 'nope', true, signal()),
    { code: 'region-unavailable' },
  )
})

test('a failed comparison reports what can be retried', async () => {
  const context = setup({ outcomesFor: failedOnce })
  const { comparisonId } = await compared(context)

  const status = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(status.state, 'failed')
  assert.deepEqual(status.failure, {
    stage: 'transcription',
    code: 'AI_WORKER_ERROR',
    retry: { left: 3, limit: 3 },
  })
  await assert.rejects(context.repository.loadResult(comparisonId, signal()), {
    code: 'comparison-not-ready',
  })
})

test('a retry starts from the stage that failed', async () => {
  const context = setup({ outcomesFor: failedOnce })
  const { comparisonId } = await compared(context)

  const retried = await context.repository.retry(comparisonId, signal())
  assert.deepEqual(retried, { id: comparisonId, state: 'queued' })

  const waiting = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(waiting.failure, null)
  assert.deepEqual(
    waiting.stages.map((stage) => stage.status),
    ['done', 'waiting', 'waiting'],
  )

  context.clock.now += RUN_MS
  const finished = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(finished.state, 'success')
})

test('a retry never goes back before the stage it restarts from', async () => {
  const failedAt = (stage) => ({
    kind: 'failed',
    stage,
    code: 'AI_WORKER_ERROR',
    retryable: true,
  })
  const context = setup({
    outcomesFor: () => [failedAt('compare'), failedAt('align')],
  })
  const { comparisonId } = await compared(context)

  await context.repository.retry(comparisonId, signal())
  context.clock.now += RUN_MS

  const status = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(status.failure.stage, 'compare')
  assert.deepEqual(
    status.stages.map((stage) => stage.status),
    ['done', 'done', 'failed'],
  )
})

test('retries run out after three', async () => {
  const context = setup({
    outcomesFor: () => [
      {
        kind: 'failed',
        stage: 'align',
        code: 'AI_WORKER_TIMEOUT',
        retryable: true,
      },
    ],
  })
  const { comparisonId } = await compared(context)

  for (const left of [2, 1, 0]) {
    await context.repository.retry(comparisonId, signal())
    context.clock.now += RUN_MS
    const status = await context.repository.loadStatus(comparisonId, signal())
    assert.deepEqual(status.failure.retry, { left, limit: 3 })
  }

  await assert.rejects(context.repository.retry(comparisonId, signal()), {
    code: 'retry-limit',
  })
})

test('a failure that cannot be retried offers no retry', async () => {
  const context = setup({
    outcomesFor: () => [
      {
        kind: 'failed',
        stage: 'align',
        code: 'PERFORMANCE_INVALID_AUDIO',
        retryable: false,
      },
    ],
  })
  const { comparisonId } = await compared(context)

  const status = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(status.failure.retry, null)
  await assert.rejects(context.repository.retry(comparisonId, signal()), {
    code: 'not-retryable',
  })
})

test('a comparison still running cannot be retried', async () => {
  const { repository } = setup()
  const performance = await saved(repository)
  const { id } = await repository.requestComparison(performance.id, signal())

  await assert.rejects(repository.retry(id, signal()), {
    code: 'not-retryable',
  })
})

test('a failed comparison can be requested again as a new one', async () => {
  const context = setup({ outcomesFor: failedOnce })
  const { performance, comparisonId } = await compared(context)

  const again = await context.repository.requestComparison(
    performance.id,
    signal(),
  )
  assert.notEqual(again.id, comparisonId)
  assert.equal(again.state, 'queued')

  const [listed] = await context.repository.listPerformances(TASK_ID, signal())
  assert.deepEqual(listed.latestComparison, {
    id: again.id,
    state: 'queued',
  })
  await assert.rejects(context.repository.retry(comparisonId, signal()), {
    code: 'comparison-in-progress',
  })
})

test('a newer run is reported before the retries that ran out', async () => {
  const context = setup({
    outcomesFor: () => [
      {
        kind: 'failed',
        stage: 'align',
        code: 'AI_WORKER_TIMEOUT',
        retryable: true,
      },
    ],
  })
  const { performance, comparisonId } = await compared(context)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await context.repository.retry(comparisonId, signal())
    context.clock.now += RUN_MS
  }

  await context.repository.requestComparison(performance.id, signal())

  await assert.rejects(context.repository.retry(comparisonId, signal()), {
    code: 'comparison-in-progress',
  })
})

test('a place cannot be marked while the comparison is running', async () => {
  const { repository } = setup()
  const performance = await saved(repository)
  const { id } = await repository.requestComparison(performance.id, signal())

  await assert.rejects(
    repository.markRegion(id, `${id}-region-1`, true, signal()),
    { code: 'region-unavailable' },
  )
  await assert.rejects(
    repository.markRegion('nope', 'nope-region-1', true, signal()),
    { code: 'region-unavailable' },
  )
})

test('playback stays open for a take that could not be compared', async () => {
  const context = setup()
  const { comparisonId } = await compared(context, { durationSeconds: 8 })

  const playback = await context.repository.loadPlayback(comparisonId, signal())
  assert.equal(playback.tracks.length, 3)
})

test('loading a baseline sound can be canceled', async () => {
  let received
  const context = setup({
    loadBaselineAudio: async (_taskId, _kind, requestSignal) => {
      received = requestSignal
      return new Blob(['stem'])
    },
  })
  const { comparisonId } = await compared(context)
  const controller = new AbortController()

  await context.repository.loadTrackAudio(
    comparisonId,
    'stem',
    controller.signal,
  )
  assert.equal(received, controller.signal)
})

test('a take that could not be compared has no place to mark', async () => {
  const context = setup()
  const { comparisonId } = await compared(context, { durationSeconds: 5 })

  await assert.rejects(
    context.repository.markRegion(
      comparisonId,
      `${comparisonId}-region-1`,
      true,
      signal(),
    ),
    { code: 'region-unavailable' },
  )
})

test('playback names each sound and serves the take that was saved', async () => {
  const context = setup()
  const audio = new Blob(['my take'], { type: 'audio/wav' })
  const { comparisonId } = await compared(context, { audio })

  const playback = await context.repository.loadPlayback(comparisonId, signal())
  assert.equal(playback.isPartial, false)
  assert.deepEqual(playback.tracks, [
    { kind: 'original', available: true, offsetSeconds: 10 },
    { kind: 'stem', available: true, offsetSeconds: 0 },
    { kind: 'performance', available: true, offsetSeconds: 0 },
  ])

  const mine = await context.repository.loadTrackAudio(
    comparisonId,
    'performance',
    signal(),
  )
  assert.equal(await mine.text(), 'my take')
  const stem = await context.repository.loadTrackAudio(
    comparisonId,
    'stem',
    signal(),
  )
  assert.equal(await stem.text(), `${TASK_ID}:stem`)
})

test('a sound that cannot play leaves the rest to check (CMP-04)', async () => {
  const context = setup({ unavailableTracks: ['stem'] })
  const { comparisonId } = await compared(context)

  const playback = await context.repository.loadPlayback(comparisonId, signal())
  assert.equal(playback.isPartial, true)
  assert.equal(
    playback.tracks.find((track) => track.kind === 'stem').available,
    false,
  )
  await assert.rejects(
    context.repository.loadTrackAudio(comparisonId, 'stem', signal()),
    { code: 'audio-unavailable' },
  )
})

test('separated input is the baseline when there is no original (CMP-01)', async () => {
  const context = setup()
  context.sections.set(TASK_ID, {
    ...context.sections.get(TASK_ID),
    inputKind: 'separated-guitar',
  })
  const { comparisonId } = await compared(context)

  const result = await context.repository.loadResult(comparisonId, signal())
  assert.equal(result.baseline, 'separated-input')

  // The server sends the same three sounds whatever the input (CMP-04); the
  // original is then the uploaded guitar.
  const playback = await context.repository.loadPlayback(comparisonId, signal())
  assert.equal(playback.isPartial, false)
  assert.deepEqual(playback.tracks, [
    { kind: 'original', available: true, offsetSeconds: 10 },
    // The mock plays the whole upload where the server cuts the section.
    { kind: 'stem', available: true, offsetSeconds: 10 },
    { kind: 'performance', available: true, offsetSeconds: 0 },
  ])
  const original = await context.repository.loadTrackAudio(
    comparisonId,
    'original',
    signal(),
  )
  assert.equal(await original.text(), `${TASK_ID}:original`)
})

test('what a request returns cannot change what the mock keeps', async () => {
  const context = setup()
  const { comparisonId } = await compared(context)

  const result = await context.repository.loadResult(comparisonId, signal())
  const startSeconds = result.regions[0].startSeconds
  result.regions[0].checked = true
  result.regions[0].startSeconds = 99
  result.regions.pop()

  const reloaded = await context.repository.loadResult(comparisonId, signal())
  assert.equal(reloaded.regions.length, 4)
  assert.equal(reloaded.regions[0].checked, false)
  assert.equal(reloaded.regions[0].startSeconds, startSeconds)

  const playback = await context.repository.loadPlayback(comparisonId, signal())
  playback.tracks[0].available = false
  const replayed = await context.repository.loadPlayback(comparisonId, signal())
  assert.equal(replayed.tracks[0].available, true)

  const status = await context.repository.loadStatus(comparisonId, signal())
  status.stages[0].status = 'failed'
  const polled = await context.repository.loadStatus(comparisonId, signal())
  assert.equal(polled.stages[0].status, 'done')
})

test('a canceled request stops waiting', async () => {
  const { repository } = setup({ requestDelayMs: 50 })
  const controller = new AbortController()

  const pending = repository.listPerformances(TASK_ID, controller.signal)
  controller.abort()

  await assert.rejects(pending, { name: 'AbortError' })
})
