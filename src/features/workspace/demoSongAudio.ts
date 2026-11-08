import { runInSlices } from '../../shared/scheduling.ts'

// The mock "server" plays a synthesized guitar-like line for fixture songs,
// so the demo ships no recordings and has no copyright to clear. The same
// song id always yields the same audio.
export const DEMO_SAMPLE_RATE = 16_000

const NOTE_SECONDS = 0.25
const RING_SECONDS = 0.75
const ATTACK_SECONDS = 0.004
const RELEASE_SECONDS = 0.02
const DECAY_SECONDS = 0.35
const PHRASE_NOTES = 16
const BLOCK_PHRASES = 4
const MASTER_GAIN = 0.3
const REST_CHANCE = 0.15
// A minor pentatonic across the low guitar strings.
const SCALE_HZ = [
  110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63, 392,
]
const BLOCK_LEVELS = [0.5, 0.75, 1]

const TABLE_SIZE = 2048
const WAVETABLE = (() => {
  const table = new Float32Array(TABLE_SIZE)
  let loudest = 0
  for (let index = 0; index < TABLE_SIZE; index += 1) {
    const phase = (2 * Math.PI * index) / TABLE_SIZE
    const value =
      Math.sin(phase) +
      0.5 * Math.sin(2 * phase) +
      0.3 * Math.sin(3 * phase) +
      0.15 * Math.sin(4 * phase)
    table[index] = value
    loudest = Math.max(loudest, Math.abs(value))
  }
  return table.map((value) => value / loudest)
})()

function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// mulberry32: small, fast and deterministic.
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function envelope(time: number): number {
  const attack = Math.min(1, time / ATTACK_SECONDS)
  const release = Math.min(1, (RING_SECONDS - time) / RELEASE_SECONDS)
  return attack * release * Math.exp(-time / DECAY_SECONDS)
}

function addNote(
  mix: Float32Array,
  firstSample: number,
  frequency: number,
  level: number,
) {
  const ring = Math.round(RING_SECONDS * DEMO_SAMPLE_RATE)
  const last = Math.min(firstSample + ring, mix.length)
  const step = (frequency * TABLE_SIZE) / DEMO_SAMPLE_RATE
  for (let sample = firstSample; sample < last; sample += 1) {
    const offset = sample - firstSample
    const index = Math.floor(offset * step) % TABLE_SIZE
    mix[sample] +=
      WAVETABLE[index] * level * envelope(offset / DEMO_SAMPLE_RATE)
  }
}

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

// 16-bit mono PCM in a RIFF/WAVE container.
export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2
  const header = new DataView(new ArrayBuffer(44))
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      header.setUint8(offset + index, text.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  header.setUint32(4, 36 + dataBytes, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  writeText(36, 'data')
  header.setUint32(40, dataBytes, true)
  let data: Int16Array | DataView = samples
  if (!littleEndian) {
    const view = new DataView(new ArrayBuffer(dataBytes))
    samples.forEach((value, index) => view.setInt16(index * 2, value, true))
    data = view
  }
  return new Blob([header, data as BlobPart], { type: 'audio/wav' })
}

export async function createDemoSongAudio(
  songId: string,
  durationSeconds: number,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted()
  const mix = new Float32Array(
    Math.ceil(durationSeconds * DEMO_SAMPLE_RATE - 1e-6),
  )
  const next = random(seedFrom(songId))
  const noteCount = Math.ceil(durationSeconds / NOTE_SECONDS)
  let blockLevel = 1
  let phraseLevel = 1
  await runInSlices(
    noteCount,
    (note) => {
      if (note % (PHRASE_NOTES * BLOCK_PHRASES) === 0)
        blockLevel = BLOCK_LEVELS[Math.floor(next() * BLOCK_LEVELS.length)]
      if (note % PHRASE_NOTES === 0) phraseLevel = 0.75 + 0.25 * next()
      const pitch = SCALE_HZ[Math.floor(next() * SCALE_HZ.length)]
      const rest = next() < REST_CHANCE
      const accent = note % 4 === 0 ? 1 : 0.7
      const level =
        MASTER_GAIN * blockLevel * phraseLevel * accent * (0.8 + 0.2 * next())
      if (!rest)
        addNote(
          mix,
          Math.round(note * NOTE_SECONDS * DEMO_SAMPLE_RATE),
          pitch,
          level,
        )
    },
    { signal },
  )
  const samples = new Int16Array(mix.length)
  for (let index = 0; index < mix.length; index += 1)
    samples[index] = Math.round(Math.max(-1, Math.min(1, mix[index])) * 32767)
  return encodeWav(samples, DEMO_SAMPLE_RATE)
}
