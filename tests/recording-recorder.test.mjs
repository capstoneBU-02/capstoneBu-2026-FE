import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecordedTake } from '../src/features/recording/recordedTake.ts'
import {
  formatRecordingClock,
  litSegments,
  meterLevel,
  waveformBars,
  waveformSpanSeconds,
} from '../src/features/recording/recordingMeter.ts'
import { RECORDING_SAMPLE_RATE } from '../src/features/recording/wavEncoder.ts'

async function wavHeader(blob) {
  const view = new DataView(await blob.arrayBuffer())
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  }
}

function tone(seconds, sampleRate, amplitude = 0.5) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  return samples.map(
    (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / sampleRate) * amplitude,
  )
}

test('a take at the recording rate becomes 48 kHz mono 16-bit WAV', async () => {
  const take = buildRecordedTake(
    { samples: tone(1, RECORDING_SAMPLE_RATE), sampleRate: 48_000 },
    10,
  )

  assert.equal(take.audio.type, 'audio/wav')
  assert.deepEqual(await wavHeader(take.audio), {
    channels: 1,
    sampleRate: 48_000,
    bitsPerSample: 16,
    dataBytes: 96_000,
  })
  assert.equal(take.durationSeconds, 1)
  assert.equal(take.silent, false)
})

test('a take from another input rate is resampled to 48 kHz', async () => {
  const take = buildRecordedTake(
    { samples: tone(2, 44_100), sampleRate: 44_100 },
    10,
  )

  const header = await wavHeader(take.audio)
  assert.equal(header.sampleRate, 48_000)
  assert.equal(header.dataBytes, 2 * 2 * 48_000)
  assert.equal(take.durationSeconds, 2)
})

test('a take never runs past the limit the server accepts', () => {
  const limit = 47.4
  const take = buildRecordedTake(
    { samples: tone(47.45, 48_000), sampleRate: 48_000 },
    limit,
  )

  assert.ok(take.durationSeconds <= limit)
  assert.ok(take.durationSeconds > limit - 0.001)
})

test('a take under the silence peak is marked silent', () => {
  const quiet = buildRecordedTake(
    { samples: tone(0.5, 48_000, 0.001), sampleRate: 48_000 },
    10,
  )
  const heard = buildRecordedTake(
    { samples: tone(0.5, 48_000, 0.2), sampleRate: 48_000 },
    10,
  )

  assert.equal(quiet.silent, true)
  assert.equal(heard.silent, false)
})

test('the clock shows minutes, seconds and tenths', () => {
  assert.equal(formatRecordingClock(0), '00:00.0')
  assert.equal(formatRecordingClock(14.6), '00:14.6')
  assert.equal(formatRecordingClock(83.25), '01:23.3')
})

test('the clock carries a rounded tenth into the next minute', () => {
  assert.equal(formatRecordingClock(59.96), '01:00.0')
})

test('the clock reads a section length despite float subtraction', () => {
  assert.equal(formatRecordingClock(65.8 - 42.1), '00:23.7')
})

test('the clock treats an unreadable time as zero', () => {
  assert.equal(formatRecordingClock(Number.NaN), '00:00.0')
  assert.equal(formatRecordingClock(-3), '00:00.0')
})

test('the meter follows loudness in decibels', () => {
  assert.equal(meterLevel(0), 0)
  assert.equal(meterLevel(1), 1)
  assert.equal(meterLevel(2), 1)
  assert.equal(meterLevel(Number.NaN), 0)
  assert.ok(Math.abs(meterLevel(0.1) - 2 / 3) < 0.001)
})

test('the meter lights no segment for silence and all for full level', () => {
  assert.equal(litSegments(0, 24), 0)
  assert.equal(litSegments(1, 24), 24)
  assert.equal(litSegments(0.5, 24), 12)
})

test('the meter lights a segment for any sound at all', () => {
  assert.equal(litSegments(0.001, 24), 1)
})

test('the waveform fills as far as the take has reached', () => {
  const peaks = [0.1, 0.2, 0.3, 0.4]

  assert.deepEqual(waveformBars(peaks, 5, 10, 4), [0.2, 0.4])
})

test('each bar shows the loudest moment it covers', () => {
  const peaks = [0.1, 0.9, 0.2, 0.3, 0.8, 0.4]

  assert.deepEqual(waveformBars(peaks, 10, 10, 2), [0.9, 0.8])
})

test('the waveform stretches a short take over its bars', () => {
  assert.deepEqual(waveformBars([0.5], 10, 10, 3), [0.5, 0.5, 0.5])
})

test('the waveform draws nothing before any sound arrives', () => {
  assert.deepEqual(waveformBars([], 0, 10, 4), [])
  assert.deepEqual(waveformBars([0.5], 5, 10, 0), [])
  assert.deepEqual(waveformBars([0.5], 5, 0, 4), [])
})

test('the waveform never draws more bars than it has room for', () => {
  assert.equal(waveformBars([0.1, 0.2], 20, 10, 4).length, 4)
})

test('the waveform spans the section until the take runs past it', () => {
  assert.equal(waveformSpanSeconds(5, 23.7), 23.7)
  assert.equal(waveformSpanSeconds(30, 23.7), 30)
})
