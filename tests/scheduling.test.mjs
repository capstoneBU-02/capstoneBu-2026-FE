import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { yieldToMain } from '../src/shared/scheduling.ts'

const original = {
  scheduler: globalThis.scheduler,
  MessageChannel: globalThis.MessageChannel,
}

afterEach(() => {
  globalThis.scheduler = original.scheduler
  globalThis.MessageChannel = original.MessageChannel
})

// Counts the channels opened while the fallback runs.
function countChannels() {
  const counter = { opened: 0 }
  globalThis.MessageChannel = class extends original.MessageChannel {
    constructor() {
      super()
      counter.opened += 1
    }
  }
  return counter
}

test('yielding uses scheduler.yield where the browser has it', async () => {
  let yields = 0
  globalThis.scheduler = {
    yield: () => {
      yields += 1
      return Promise.resolve()
    },
  }
  const channels = countChannels()
  await yieldToMain()
  assert.equal(yields, 1)
  assert.equal(channels.opened, 0)
})

// A zero timeout waits at least 4 ms once nested, and a second or more in a
// background tab; a posted message does not.
test('without scheduler.yield, yielding waits for a posted message', async () => {
  globalThis.scheduler = undefined
  const channels = countChannels()
  await yieldToMain()
  await yieldToMain()
  assert.equal(channels.opened, 2)
})
