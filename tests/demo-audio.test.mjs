import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMO_SAMPLE_RATE,
  createDemoSongAudio,
  encodeWav,
} from '../src/features/workspace/demoSongAudio.ts'

const signal = () => new AbortController().signal

function text(view, offset, length) {
  return String.fromCharCode(
    ...new Uint8Array(view.buffer, view.byteOffset + offset, length),
  )
}

test('a WAV file wraps 16-bit mono PCM in a standard header', async () => {
  const blob = encodeWav(Int16Array.from([0, 32767, -32768]), 8000)
  assert.equal(blob.type, 'audio/wav')
  const view = new DataView(await blob.arrayBuffer())
  assert.equal(view.byteLength, 44 + 6)
  assert.equal(text(view, 0, 4), 'RIFF')
  assert.equal(view.getUint32(4, true), 36 + 6)
  assert.equal(text(view, 8, 4), 'WAVE')
  assert.equal(text(view, 12, 4), 'fmt ')
  assert.equal(view.getUint32(16, true), 16)
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), 8000)
  assert.equal(view.getUint32(28, true), 16000)
  assert.equal(view.getUint16(32, true), 2)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(text(view, 36, 4), 'data')
  assert.equal(view.getUint32(40, true), 6)
  assert.equal(view.getInt16(46, true), 32767)
  assert.equal(view.getInt16(48, true), -32768)
})

test('demo audio is synthesized, deterministic per song and as long as it', async () => {
  const first = await createDemoSongAudio('song-neon-harbor', 2, signal())
  const again = await createDemoSongAudio('song-neon-harbor', 2, signal())
  const other = await createDemoSongAudio('song-paper-moon', 2, signal())
  const bytes = new Uint8Array(await first.arrayBuffer())

  assert.equal(bytes.length, 44 + 2 * DEMO_SAMPLE_RATE * 2)
  assert.deepEqual(bytes, new Uint8Array(await again.arrayBuffer()))
  assert.notDeepEqual(bytes, new Uint8Array(await other.arrayBuffer()))

  const samples = new Int16Array(bytes.buffer.slice(44))
  const loudest = samples.reduce(
    (max, value) => Math.max(max, Math.abs(value)),
    0,
  )
  assert.ok(loudest > 1000, 'the demo should be audible')
  assert.ok(loudest < 32767, 'the demo should not clip')
})

test('demo audio rounds a fractional length up to a whole sample', async () => {
  const blob = await createDemoSongAudio('song-x', 0.00051, signal())
  // 0.00051 s at 16 kHz is 8.16 samples.
  assert.equal(blob.size, 44 + 9 * 2)
})

test('demo audio synthesis can be cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createDemoSongAudio('song-x', 2, controller.signal), {
    name: 'AbortError',
  })
})
