import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import {
  CAPTURE_PROCESSOR_SOURCE,
  receiveCapture,
} from '../src/features/recording/captureWorklet.ts'

// The browser hands the worklet sound in quanta of this many frames.
const QUANTUM = 128
const BLOCK = 2048

// The worklet's own source and the page's side, joined by a port whose
// messages wait until the test delivers them, as they do between the audio
// thread and the page. Every sample is the number of the frame it was heard
// at, so a take shows where its sound came from.
function connectCapture() {
  const toPage = []
  const toWorklet = []
  let Processor = null
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (data) => toPage.push(data),
      }
    }
  }
  runInNewContext(CAPTURE_PROCESSOR_SOURCE, {
    AudioWorkletProcessor,
    registerProcessor(_name, processor) {
      Processor = processor
    },
  })
  const worklet = new Processor()
  const page = {
    onmessage: null,
    postMessage: (data) => toWorklet.push(data),
  }
  const capture = receiveCapture(page, () => {})
  let heard = 0

  return {
    capture,
    heard: () => heard,
    hear(frames) {
      for (let quantum = 0; quantum < frames / QUANTUM; quantum += 1) {
        const input = Float32Array.from({ length: QUANTUM }, () => heard++)
        worklet.process([[input]])
      }
    },
    deliverToWorklet() {
      for (const data of toWorklet.splice(0)) worklet.port.onmessage?.({ data })
    },
    deliverToPage() {
      for (const data of toPage.splice(0)) page.onmessage?.({ data })
    },
  }
}

test('a take keeps every block the worklet hears, in order', () => {
  const capture = connectCapture()

  capture.hear(BLOCK * 2 + QUANTUM)
  capture.deliverToPage()

  const samples = capture.capture.finish()
  assert.equal(capture.capture.frames(), BLOCK * 2)
  assert.equal(samples.length, BLOCK * 2)
  assert.equal(samples[0], 0)
  assert.equal(samples[BLOCK * 2 - 1], BLOCK * 2 - 1)
})

test('처음부터 drops the sound heard before it in a block not yet full', () => {
  const capture = connectCapture()
  capture.hear(QUANTUM * 10)
  capture.deliverToPage()

  capture.capture.restart()
  capture.deliverToWorklet()
  const restartedAt = capture.heard()
  capture.hear(BLOCK)
  capture.deliverToPage()

  const samples = capture.capture.finish()
  assert.equal(samples[0], restartedAt)
  assert.equal(samples.length, BLOCK)
})

test('a block already on its way when 처음부터 is pressed is not counted', () => {
  const capture = connectCapture()
  capture.hear(BLOCK)

  capture.capture.restart()
  capture.deliverToPage()

  assert.equal(capture.capture.frames(), 0)
  assert.deepEqual(capture.capture.peaks(), [])

  capture.deliverToWorklet()
  const restartedAt = capture.heard()
  capture.hear(BLOCK)
  capture.deliverToPage()

  const samples = capture.capture.finish()
  assert.equal(capture.capture.frames(), BLOCK)
  assert.equal(samples[0], restartedAt)
})

test('blocks after the take is finished are not kept', () => {
  const capture = connectCapture()
  capture.hear(BLOCK)
  capture.deliverToPage()

  const samples = capture.capture.finish()
  capture.hear(BLOCK)
  capture.deliverToPage()

  assert.equal(samples.length, BLOCK)
  assert.equal(capture.capture.frames(), BLOCK)
})
