import { isSilentTake, type RecordedTake } from './recordingState.ts'
import { encodeWav, measureLevel } from './wavEncoder.ts'

export interface CapturedAudio {
  readonly samples: Float32Array
  readonly sampleRate: number
}

// A take keeps the rate the device recorded it at: the server converts every
// take to 44.1 kHz, so converting it here as well would change it twice.
export function buildRecordedTake(
  { samples, sampleRate }: CapturedAudio,
  limitSeconds: number,
): RecordedTake {
  const rate = Math.round(sampleRate)
  // Input arrives in blocks, so the last one can overshoot the limit, and the
  // server refuses a take longer than the limit.
  const frames = Math.min(samples.length, Math.floor(limitSeconds * rate))
  const kept = samples.subarray(0, frames)
  return {
    audio: encodeWav(kept, rate),
    durationSeconds: frames / rate,
    silent: isSilentTake(measureLevel(kept).peak),
  }
}
