import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECORDING_SAMPLE_RATE,
  encodeWav,
  measureLevel,
  mergeChunks,
  resampleLinear,
} from '../src/features/recording/wavEncoder.ts'

const HEADER_BYTES = 44

const floats = (...values) => Float32Array.from(values)

function readTag(view, offset) {
  return String.fromCharCode(
    ...new Uint8Array(view.buffer, view.byteOffset + offset, 4),
  )
}

async function parseWav(blob) {
  const view = new DataView(await blob.arrayBuffer())
  const sampleCount = (view.byteLength - HEADER_BYTES) / 2
  return {
    riffTag: readTag(view, 0),
    riffSize: view.getUint32(4, true),
    waveTag: readTag(view, 8),
    formatTag: readTag(view, 12),
    formatSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: readTag(view, 36),
    dataSize: view.getUint32(40, true),
    samples: Array.from({ length: sampleCount }, (_, index) =>
      view.getInt16(HEADER_BYTES + index * 2, true),
    ),
  }
}

async function encodedSamples(...values) {
  const wav = await parseWav(encodeWav(floats(...values), 48_000))
  return wav.samples
}

test('recordings are made at 48 kHz', () => {
  assert.equal(RECORDING_SAMPLE_RATE, 48_000)
})

test('chunks are joined in the order they arrived', () => {
  assert.deepEqual(
    mergeChunks([floats(1, 2), floats(), floats(3)]),
    floats(1, 2, 3),
  )
})

test('no chunks merge into an empty recording', () => {
  assert.equal(mergeChunks([]).length, 0)
})

test('a merged recording does not share memory with its chunk', () => {
  const chunk = floats(0.5)
  const merged = mergeChunks([chunk])

  chunk[0] = 0
  assert.equal(merged[0], 0.5)
})

test('resampling at the same rate returns a copy', () => {
  const samples = floats(0.25, -0.5)
  const copy = resampleLinear(samples, 48_000, 48_000)

  assert.deepEqual(copy, samples)
  assert.notEqual(copy, samples)
  assert.notEqual(copy.buffer, samples.buffer)
})

test('44.1 kHz input gets the length it has at 48 kHz', () => {
  const lengths = [
    [44_100, 48_000],
    [441, 480],
    [1_000, 1_088],
    [1, 1],
  ]

  for (const [input, output] of lengths) {
    const samples = new Float32Array(input)
    assert.equal(resampleLinear(samples, 44_100, 48_000).length, output)
  }
})

test('48 kHz input gets the length it has at 44.1 kHz', () => {
  const samples = new Float32Array(480)
  assert.equal(resampleLinear(samples, 48_000, 44_100).length, 441)
})

test('upsampling interpolates and holds the last sample at the end', () => {
  assert.deepEqual(resampleLinear(floats(0, 1), 1, 2), floats(0, 0.5, 1, 1))
})

test('downsampling reads the samples at the new positions', () => {
  assert.deepEqual(resampleLinear(floats(0, 1, 2, 3), 2, 1), floats(0, 2))
})

test('resampling leaves the input untouched', () => {
  const samples = floats(0, 1)
  resampleLinear(samples, 1, 2)
  assert.deepEqual(samples, floats(0, 1))
})

test('resampling nothing gives nothing', () => {
  assert.equal(resampleLinear(floats(), 44_100, 48_000).length, 0)
})

test('a rate that is not a positive number is refused', () => {
  const invalidRates = [0, -1, Number.NaN, Number.POSITIVE_INFINITY]

  for (const rate of invalidRates) {
    assert.throws(() => resampleLinear(floats(1), rate, 48_000), RangeError)
    assert.throws(() => resampleLinear(floats(1), 48_000, rate), RangeError)
    assert.throws(() => resampleLinear(floats(), rate, 48_000), RangeError)
    assert.throws(() => resampleLinear(floats(1), rate, rate), RangeError)
  }
})

test('the WAV header describes mono 16-bit PCM', async () => {
  const blob = encodeWav(floats(0, 0, 0), 48_000)
  const wav = await parseWav(blob)

  assert.equal(blob.type, 'audio/wav')
  assert.equal(blob.size, HEADER_BYTES + 6)
  assert.equal(wav.riffTag, 'RIFF')
  assert.equal(wav.riffSize, 36 + 6)
  assert.equal(wav.waveTag, 'WAVE')
  assert.equal(wav.formatTag, 'fmt ')
  assert.equal(wav.formatSize, 16)
  assert.equal(wav.audioFormat, 1)
  assert.equal(wav.channels, 1)
  assert.equal(wav.sampleRate, 48_000)
  assert.equal(wav.byteRate, 96_000)
  assert.equal(wav.blockAlign, 2)
  assert.equal(wav.bitsPerSample, 16)
  assert.equal(wav.dataTag, 'data')
  assert.equal(wav.dataSize, 6)
})

test('the WAV header follows the sample rate it is given', async () => {
  const wav = await parseWav(encodeWav(floats(0), 44_100))

  assert.equal(wav.sampleRate, 44_100)
  assert.equal(wav.byteRate, 88_200)
})

test('an empty recording is a header with no data', async () => {
  const blob = encodeWav(floats(), 48_000)
  const wav = await parseWav(blob)

  assert.equal(blob.size, HEADER_BYTES)
  assert.equal(wav.riffSize, 36)
  assert.equal(wav.dataSize, 0)
  assert.deepEqual(wav.samples, [])
})

test('full scale reaches both ends of the 16-bit range', async () => {
  assert.deepEqual(await encodedSamples(-1, 0, 1), [-32_768, 0, 32_767])
})

test('samples are written little-endian', async () => {
  const blob = encodeWav(floats(1, -1), 48_000)
  const bytes = new Uint8Array(await blob.arrayBuffer())

  assert.deepEqual([...bytes.subarray(HEADER_BYTES)], [0xff, 0x7f, 0x00, 0x80])
})

test('negatives and positives scale by their own range', async () => {
  assert.deepEqual(await encodedSamples(-0.5, 0.25), [-16_384, 8_192])
})

test('samples beyond full scale are clamped', async () => {
  assert.deepEqual(
    await encodedSamples(
      2,
      -2,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
    [32_767, -32_768, 32_767, -32_768],
  )
})

test('a sample that is not a number is written as silence', async () => {
  assert.deepEqual(await encodedSamples(Number.NaN, 1), [0, 32_767])
})

test('encoding leaves the input untouched', () => {
  const samples = floats(2, Number.NaN)
  encodeWav(samples, 48_000)

  assert.equal(samples[0], 2)
  assert.ok(Number.isNaN(samples[1]))
})

test('an empty recording has no level', () => {
  assert.deepEqual(measureLevel(floats()), { rms: 0, peak: 0 })
})

test('level reports the RMS and the largest magnitude', () => {
  assert.deepEqual(measureLevel(floats(0.5, -0.5)), { rms: 0.5, peak: 0.5 })
  assert.deepEqual(measureLevel(floats(-1, 0, 0, 0)), { rms: 0.5, peak: 1 })
})

test('a sample that is not a number counts as silence in the level', () => {
  assert.deepEqual(measureLevel(floats(Number.NaN)), { rms: 0, peak: 0 })
  assert.deepEqual(measureLevel(floats(Number.NaN, 1)), {
    rms: Math.sqrt(0.5),
    peak: 1,
  })
})
