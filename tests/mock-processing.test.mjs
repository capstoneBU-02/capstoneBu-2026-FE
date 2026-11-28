import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStates } from '../src/features/workspace/mockProcessing.ts'

const timing = {
  queueMs: 100,
  separationMs: 400,
  cutMs: 200,
  transcriptionMs: 600,
}
const run = (taskId, enqueuedAt, guitar = 'separate') => ({
  taskId,
  enqueuedAt,
  guitar,
})

test('a run waits, separates, makes the tab and completes', () => {
  const runs = [run('a', 0)]
  const at = (now) => runStates(runs, now, timing).get('a')

  assert.deepEqual(at(0), { status: 'queued', ahead: 0 })
  assert.deepEqual(at(99), { status: 'queued', ahead: 0 })
  assert.deepEqual(at(100), {
    status: 'processing',
    guitarReady: false,
    percent: 0,
  })
  assert.deepEqual(at(500), {
    status: 'processing',
    guitarReady: true,
    percent: 40,
  })
  assert.deepEqual(at(1099), {
    status: 'processing',
    guitarReady: true,
    percent: 99,
  })
  assert.deepEqual(at(1100), { status: 'completed' })
})

test('separated-guitar input cuts its section, then makes the tab (JOB-02)', () => {
  const runs = [run('a', 0, 'cut')]
  const at = (now) => runStates(runs, now, timing).get('a')

  assert.deepEqual(at(100), {
    status: 'processing',
    guitarReady: false,
    percent: 0,
  })
  assert.deepEqual(at(300), {
    status: 'processing',
    guitarReady: true,
    percent: 25,
  })
  assert.deepEqual(at(899), {
    status: 'processing',
    guitarReady: true,
    percent: 99,
  })
  assert.deepEqual(at(900), { status: 'completed' })
})

test('one worker takes runs in order and counts the runs ahead', () => {
  const runs = [run('a', 0), run('b', 10), run('c', 20)]
  const at = (now) => Object.fromEntries(runStates(runs, now, timing))

  assert.deepEqual(at(50), {
    a: { status: 'queued', ahead: 0 },
    b: { status: 'queued', ahead: 1 },
    c: { status: 'queued', ahead: 2 },
  })
  assert.equal(at(200).a.status, 'processing')
  assert.deepEqual(at(200).c, { status: 'queued', ahead: 2 })
  // b starts when a completes, c when b completes.
  assert.equal(at(1100).a.status, 'completed')
  assert.equal(at(1100).b.status, 'processing')
  assert.deepEqual(at(1100).c, { status: 'queued', ahead: 1 })
  assert.equal(at(2100).b.status, 'completed')
  assert.equal(at(2100).c.status, 'processing')
})

test('a task queued again keeps the timing of the runs around it', () => {
  // a completes at 1100 and b at 2100; a is queued again at 1200.
  const runs = [run('a', 0), run('b', 10), run('a', 1200)]
  const at = (now) => Object.fromEntries(runStates(runs, now, timing))

  assert.deepEqual(at(1300), {
    a: { status: 'queued', ahead: 1 },
    b: { status: 'processing', guitarReady: false, percent: 20 },
  })
  assert.equal(at(2100).a.status, 'processing')
})

test('a stopped run frees the worker from the moment it stopped', () => {
  // a runs from 100 and stops at 300; c stops while it waits.
  const runs = [
    { ...run('a', 0), canceledAt: 300 },
    run('b', 10),
    { ...run('c', 20), canceledAt: 50 },
    run('d', 30),
  ]
  const at = (now) => Object.fromEntries(runStates(runs, now, timing))

  // A stopped run has no state and counts for no one behind it.
  assert.deepEqual(at(300), {
    b: { status: 'processing', guitarReady: false, percent: 0 },
    d: { status: 'queued', ahead: 1 },
  })
  assert.equal(at(1300).b.status, 'completed')
  assert.equal(at(1300).d.status, 'processing')
})

test('a retried run that keeps the separated guitar starts at the tab', () => {
  const runs = [run('a', 0, 'kept')]
  assert.deepEqual(runStates(runs, 100, timing).get('a'), {
    status: 'processing',
    guitarReady: true,
    percent: 0,
  })
})
