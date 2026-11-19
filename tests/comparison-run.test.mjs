import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparisonRunState } from '../src/features/comparison/mockComparisonRun.ts'

// Waits 100, aligns to 300, waits to 350, transcribes to 650, waits to 700 and
// compares to 800.
const timing = {
  queueMs: 100,
  stageQueueMs: 50,
  stageMs: { align: 200, transcription: 300, compare: 100 },
}

const success = { kind: 'success' }
const run = (outcome = success, startStage = 'align', enqueuedAt = 0) => ({
  enqueuedAt,
  startStage,
  outcome,
})

const stages = (state) =>
  state.stages.map((stage) => `${stage.id}:${stage.status}`)

test('a run waits, then goes through the three stages in order', () => {
  const at = (now) => comparisonRunState(run(), now, timing)

  assert.equal(at(99).state, 'queued')
  assert.equal(at(99).currentStage, null)
  assert.deepEqual(stages(at(99)), [
    'align:waiting',
    'transcription:waiting',
    'compare:waiting',
  ])

  assert.equal(at(100).state, 'processing')
  assert.equal(at(100).currentStage, 'align')
  assert.deepEqual(stages(at(100)), [
    'align:running',
    'transcription:waiting',
    'compare:waiting',
  ])

  assert.equal(at(350).currentStage, 'transcription')
  assert.deepEqual(stages(at(350)), [
    'align:done',
    'transcription:running',
    'compare:waiting',
  ])

  assert.equal(at(700).currentStage, 'compare')
  assert.deepEqual(stages(at(700)), [
    'align:done',
    'transcription:done',
    'compare:running',
  ])
})

test('between stages the run is queued and names the stage it finished', () => {
  const between = comparisonRunState(run(), 300, timing)

  assert.equal(between.state, 'queued')
  assert.equal(between.currentStage, 'align')
  assert.deepEqual(stages(between), [
    'align:done',
    'transcription:waiting',
    'compare:waiting',
  ])
})

test('a successful run ends with every stage done', () => {
  const end = comparisonRunState(run(), 800, timing)

  assert.equal(end.state, 'success')
  assert.equal(end.currentStage, 'compare')
  assert.deepEqual(stages(end), [
    'align:done',
    'transcription:done',
    'compare:done',
  ])
})

test('a run that cannot be compared skips the stages left', () => {
  const outcome = {
    kind: 'not-comparable',
    stage: 'align',
    reason: 'RERECORD_TOO_SHORT',
  }

  assert.equal(
    comparisonRunState(run(outcome), 299, timing).state,
    'processing',
  )

  const end = comparisonRunState(run(outcome), 300, timing)
  assert.equal(end.state, 'not-comparable')
  assert.equal(end.currentStage, 'align')
  assert.deepEqual(stages(end), [
    'align:done',
    'transcription:skipped',
    'compare:skipped',
  ])
})

test('a run that fails stops at that stage', () => {
  const outcome = {
    kind: 'failed',
    stage: 'transcription',
    code: 'AI_WORKER_ERROR',
    retryable: true,
  }

  const end = comparisonRunState(run(outcome), 650, timing)
  assert.equal(end.state, 'failed')
  assert.equal(end.currentStage, 'transcription')
  assert.deepEqual(stages(end), [
    'align:done',
    'transcription:failed',
    'compare:waiting',
  ])
})

test('a retry keeps the stages before the one that failed (CMP retry)', () => {
  const retried = run(success, 'transcription', 1_000)
  const at = (now) => comparisonRunState(retried, now, timing)

  assert.equal(at(1_050).state, 'queued')
  assert.equal(at(1_050).currentStage, 'align')
  assert.deepEqual(stages(at(1_050)), [
    'align:done',
    'transcription:waiting',
    'compare:waiting',
  ])

  // Waits 100, transcribes 300, waits 50 and compares 100.
  assert.equal(at(1_100).currentStage, 'transcription')
  assert.equal(at(1_549).state, 'processing')
  assert.equal(at(1_550).state, 'success')
})
