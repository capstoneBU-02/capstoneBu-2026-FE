// The mock's stand-in for the server's silence check on a take: the RMS of
// every sample, below -50 dBFS (ai_silence_dbfs), fails the comparison with
// PERFORMANCE_INVALID_AUDIO before the length checks. The mock reads only
// 16-bit PCM WAV, as the recorder saves it; it compares any other file.

const SILENCE_DBFS = -50
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8
const PCM_FORMAT = 1
const BITS_PER_SAMPLE = 16

interface PcmData {
  readonly offset: number
  readonly sampleCount: number
}

function tagAt(view: DataView, offset: number) {
  let tag = ''
  for (let index = 0; index < 4; index += 1)
    tag += String.fromCharCode(view.getUint8(offset + index))
  return tag
}

function isPcm16(view: DataView, offset: number, size: number) {
  return (
    size >= 16 &&
    offset + 16 <= view.byteLength &&
    view.getUint16(offset, true) === PCM_FORMAT &&
    view.getUint16(offset + 14, true) === BITS_PER_SAMPLE
  )
}

// Where the samples of a 16-bit PCM WAV are, or null when the mock cannot
// read the file.
function pcm16Data(view: DataView): PcmData | null {
  if (view.byteLength < HEADER_BYTES) return null
  if (tagAt(view, 0) !== 'RIFF' || tagAt(view, 8) !== 'WAVE') return null
  let readable = false
  let offset = HEADER_BYTES
  while (offset + CHUNK_HEADER_BYTES <= view.byteLength) {
    const tag = tagAt(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + CHUNK_HEADER_BYTES
    if (tag === 'fmt ') readable = isPcm16(view, body, size)
    if (tag === 'data') {
      if (!readable) return null
      const bytes = Math.min(size, view.byteLength - body)
      return { offset: body, sampleCount: Math.floor(bytes / 2) }
    }
    // Chunks keep an even length.
    offset = body + size + (size % 2)
  }
  return null
}

function levelDbfs(view: DataView, data: PcmData) {
  let sum = 0
  for (let index = 0; index < data.sampleCount; index += 1) {
    const sample = view.getInt16(data.offset + index * 2, true) / 32_768
    sum += sample * sample
  }
  const rms = data.sampleCount > 0 ? Math.sqrt(sum / data.sampleCount) : 0
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

export async function isMockSilentTake(audio: Blob): Promise<boolean> {
  const view = new DataView(await audio.arrayBuffer())
  const data = pcm16Data(view)
  return data !== null && levelDbfs(view, data) < SILENCE_DBFS
}
