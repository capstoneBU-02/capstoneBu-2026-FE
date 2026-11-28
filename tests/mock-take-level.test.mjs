import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMockSilentTake } from '../src/features/comparison/mockTakeLevel.ts'

const bytesOf = (text) => [...text].map((char) => char.charCodeAt(0))

function chunk(tag, body, size = body.length) {
  const header = new DataView(new ArrayBuffer(8))
  bytesOf(tag).forEach((byte, index) => header.setUint8(index, byte))
  header.setUint32(4, size, true)
  const padding = body.length % 2 === 1 ? [0] : []
  return [...new Uint8Array(header.buffer), ...body, ...padding]
}

function fmt({ format = 1, bitsPerSample = 16 } = {}) {
  const view = new DataView(new ArrayBuffer(16))
  view.setUint16(0, format, true)
  view.setUint16(2, 1, true)
  view.setUint32(4, 8_000, true)
  view.setUint32(8, 8_000 * (bitsPerSample / 8), true)
  view.setUint16(12, bitsPerSample / 8, true)
  view.setUint16(14, bitsPerSample, true)
  return chunk('fmt ', [...new Uint8Array(view.buffer)])
}

function data(samples, size) {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return chunk('data', [...new Uint8Array(view.buffer)], size)
}

function file(chunks, { riff = 'RIFF', wave = 'WAVE' } = {}) {
  const body = [...bytesOf(wave), ...chunks.flat()]
  return new Blob([new Uint8Array(chunk(riff, body))], { type: 'audio/wav' })
}

const silence = new Array(400).fill(0)
// About -12 dBFS.
const loud = Array.from({ length: 400 }, (_, index) =>
  index % 2 === 0 ? 8_000 : -8_000,
)

test('the samples are found past an odd chunk and its padding byte', async () => {
  const note = chunk('LIST', bytesOf('abc'))
  assert.equal(await isMockSilentTake(file([fmt(), note, data(silence)])), true)
  assert.equal(await isMockSilentTake(file([fmt(), note, data(loud)])), false)
})

test('a data chunk longer than the file is read up to its end', async () => {
  const cut = data(silence, 1_000_000)
  assert.equal(await isMockSilentTake(file([fmt(), cut])), true)
})

test('a take the mock cannot read is never silent', async () => {
  for (const [name, audio] of [
    ['24-bit samples', file([fmt({ bitsPerSample: 24 }), data(silence)])],
    ['float samples', file([fmt({ format: 3 }), data(silence)])],
    ['samples before their format', file([data(silence), fmt()])],
    ['no format', file([data(silence)])],
    ['no samples chunk', file([fmt()])],
    ['not RIFF', file([fmt(), data(silence)], { riff: 'RIFX' })],
    ['not WAVE', file([fmt(), data(silence)], { wave: 'AVI ' })],
    [
      'shorter than a header',
      new Blob([new Uint8Array([...bytesOf('RIFF'), 0, 0, 0, 0])]),
    ],
  ])
    assert.equal(await isMockSilentTake(audio), false, name)
})
