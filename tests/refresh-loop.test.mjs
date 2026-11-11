import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startRefreshLoop } from '../src/features/workspace/refreshLoop.ts'

// The refresh rules the open task and the list share (#17, #28).

function fakePage({ hidden = false } = {}) {
  const document = Object.assign(new EventTarget(), { hidden })
  const window = new EventTarget()
  return {
    document,
    window,
    hide() {
      document.hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    },
    show() {
      document.hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    },
    focus() {
      window.dispatchEvent(new Event('focus'))
    },
  }
}

// Each refresh waits until the test settles it.
function heldRuns() {
  const calls = []
  return {
    calls,
    run: (signal) =>
      new Promise((resolve) => calls.push({ signal, settle: resolve })),
  }
}

// Lets a settled refresh reach the loop.
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('refreshes one at a time, each a delay after the last', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(99)
  assert.equal(calls.length, 0)
  t.mock.timers.tick(1)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(500)
  assert.equal(calls.length, 1)

  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(99)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(calls.length, 2)
  stop()
})

test('a hidden tab cancels its refresh and catches up when shown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(100)
  page.hide()
  assert.equal(calls[0].signal.aborted, true)
  // The cancelled refresh settling late schedules nothing.
  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)

  page.show()
  assert.equal(calls.length, 2)
  stop()
})

test('a tab hidden from the start waits until it is shown', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage({ hidden: true })
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(1000)
  assert.equal(calls.length, 0)
  page.show()
  assert.equal(calls.length, 1)
  stop()
})

test('without a delay only a shown tab or focus refreshes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: null, run, page })

  t.mock.timers.tick(10_000)
  assert.equal(calls.length, 0)
  page.focus()
  assert.equal(calls.length, 1)
  // One on its way already covers a second focus.
  page.focus()
  assert.equal(calls.length, 1)

  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(10_000)
  assert.equal(calls.length, 1)
  page.hide()
  page.show()
  assert.equal(calls.length, 2)
  stop()
})

test('focus refreshes at once and the wait starts over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(60)
  page.focus()
  assert.equal(calls.length, 1)
  // The timer it replaced does not fire on top of it.
  t.mock.timers.tick(100)
  assert.equal(calls.length, 1)

  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(99)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(calls.length, 2)
  stop()
})

test('a delay set later starts the wait and null drops it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const loop = startRefreshLoop({ delayMs: null, run, page })

  loop.setDelay(100)
  t.mock.timers.tick(100)
  assert.equal(calls.length, 1)
  // The refresh on its way already waits; a new delay adds nothing.
  loop.setDelay(100)
  calls[0].settle('continue')
  await flush()

  loop.setDelay(null)
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  loop.stop()
})

test('a refresh on its way survives a delay dropped meanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const loop = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(100)
  loop.setDelay(null)
  assert.equal(calls[0].signal.aborted, false)
  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  page.focus()
  assert.equal(calls.length, 2)
  loop.stop()
})

test("'stop' from a refresh ends the loop", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const loop = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(100)
  calls[0].settle('stop')
  await flush()
  t.mock.timers.tick(1000)
  page.focus()
  page.hide()
  page.show()
  loop.setDelay(100)
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
})

test('stopping cancels the refresh on its way and stops listening', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = fakePage()
  const { calls, run } = heldRuns()
  const { stop } = startRefreshLoop({ delayMs: 100, run, page })

  t.mock.timers.tick(100)
  stop()
  assert.equal(calls[0].signal.aborted, true)
  calls[0].settle('continue')
  await flush()
  t.mock.timers.tick(1000)
  page.focus()
  page.show()
  assert.equal(calls.length, 1)
})
