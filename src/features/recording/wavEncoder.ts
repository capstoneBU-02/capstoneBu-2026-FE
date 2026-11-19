export const RECORDING_SAMPLE_RATE = 48_000

const WAV_HEADER_BYTES = 44
const WAV_FORMAT_CHUNK_BYTES = 16
const WAV_PCM_FORMAT = 1
const WAV_CHANNELS = 1
const WAV_BITS_PER_SAMPLE = 16
const WAV_BYTES_PER_SAMPLE = WAV_BITS_PER_SAMPLE / 8

// 16-bit PCM reaches one step further below zero than above it.
const PCM_NEGATIVE_SCALE = 32_768
const PCM_POSITIVE_SCALE = 32_767

export function mergeChunks(chunks: readonly Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function assertSampleRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`Sample rate must be a positive number: ${rate}`)
  }
}

export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  assertSampleRate(fromRate)
  assertSampleRate(toRate)
  if (fromRate === toRate) return samples.slice()

  const length = Math.round((samples.length * toRate) / fromRate)
  const resampled = new Float32Array(length)
  const lastIndex = samples.length - 1
  for (let index = 0; index < length; index += 1) {
    // Computed from the index so rounding error cannot build up over a long take.
    const position = (index * fromRate) / toRate
    const before = Math.min(Math.floor(position), lastIndex)
    const after = Math.min(before + 1, lastIndex)
    const weight = position - before
    resampled[index] =
      samples[before] + (samples[after] - samples[before]) * weight
  }
  return resampled
}

function toPcm16(sample: number) {
  if (Number.isNaN(sample)) return 0
  const clamped = Math.max(-1, Math.min(1, sample))
  const scale = clamped < 0 ? PCM_NEGATIVE_SCALE : PCM_POSITIVE_SCALE
  return Math.round(clamped * scale)
}

function writeTag(view: DataView, offset: number, tag: string) {
  for (let index = 0; index < tag.length; index += 1) {
    view.setUint8(offset + index, tag.charCodeAt(index))
  }
}

function writeWavHeader(view: DataView, dataBytes: number, sampleRate: number) {
  const blockAlign = WAV_CHANNELS * WAV_BYTES_PER_SAMPLE

  writeTag(view, 0, 'RIFF')
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true)
  writeTag(view, 8, 'WAVE')
  writeTag(view, 12, 'fmt ')
  view.setUint32(16, WAV_FORMAT_CHUNK_BYTES, true)
  view.setUint16(20, WAV_PCM_FORMAT, true)
  view.setUint16(22, WAV_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true)
  writeTag(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * WAV_BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeWavHeader(view, dataBytes, sampleRate)
  samples.forEach((sample, index) => {
    const offset = WAV_HEADER_BYTES + index * WAV_BYTES_PER_SAMPLE
    view.setInt16(offset, toPcm16(sample), true)
  })
  return new Blob([buffer], { type: 'audio/wav' })
}

export function measureLevel(samples: Float32Array): {
  rms: number
  peak: number
} {
  if (samples.length === 0) return { rms: 0, peak: 0 }

  let sumOfSquares = 0
  let peak = 0
  for (const sample of samples) {
    const magnitude = Number.isNaN(sample) ? 0 : Math.abs(sample)
    sumOfSquares += magnitude * magnitude
    peak = Math.max(peak, magnitude)
  }
  return { rms: Math.sqrt(sumOfSquares / samples.length), peak }
}
