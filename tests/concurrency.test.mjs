import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapConcurrently } from '../src/shared/concurrency.ts'

// A job per item that settles only when the test says so.
function controlledJobs() {
  const running = new Map()
  let peak = 0
  const started = []
  function job(item) {
    started.push(item)
    return new Promise((resolve, reject) => {
      running.set(item, { resolve, reject })
      peak = Math.max(peak, running.size)
    }).finally(() => running.delete(item))
  }
  return {
    job,
    started,
    peak: () => peak,
    resolve(item, value) {
      running.get(item).resolve(value)
    },
    reject(item, error) {
      running.get(item).reject(error)
    },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('results keep the order of their items whichever finishes first', async () => {
  const jobs = controlledJobs()
  const pending = mapConcurrently(['a', 'b', 'c'], 3, jobs.job)
  await settle()
  jobs.resolve('c', 3)
  jobs.resolve('a', 1)
  jobs.resolve('b', 2)
  assert.deepEqual(await pending, [1, 2, 3])
})

test('no more than the limit run at once, and the next starts as one ends', async () => {
  const jobs = controlledJobs()
  const pending = mapConcurrently([1, 2, 3, 4, 5], 2, jobs.job)
  await settle()
  assert.deepEqual(jobs.started, [1, 2])

  jobs.resolve(2, 'two')
  await settle()
  assert.deepEqual(jobs.started, [1, 2, 3])

  for (const item of [1, 3, 4, 5]) {
    jobs.resolve(item, item)
    await settle()
  }
  assert.deepEqual(await pending, [1, 'two', 3, 4, 5])
  assert.equal(jobs.peak(), 2)
})

test('the first failure rejects and starts nothing more', async () => {
  const jobs = controlledJobs()
  const pending = mapConcurrently([1, 2, 3, 4], 2, jobs.job)
  await settle()
  const failure = new Error('one failed')
  jobs.reject(1, failure)
  await assert.rejects(pending, failure)
  // The one already running still settles on its own.
  jobs.resolve(2, 2)
  await settle()
  assert.deepEqual(jobs.started, [1, 2])
})

test('no items give no results', async () => {
  assert.deepEqual(
    await mapConcurrently([], 4, () => assert.fail('no job')),
    [],
  )
})

test('each job gets its item and index', async () => {
  assert.deepEqual(
    await mapConcurrently(['x', 'y'], 1, async (item, index) => item + index),
    ['x0', 'y1'],
  )
})
