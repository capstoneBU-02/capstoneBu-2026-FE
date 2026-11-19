import { isSilentTake, type RecordedTake } from './recordingState.ts'
import {
  RECORDING_SAMPLE_RATE,
  encodeWav,
  measureLevel,
  resampleLinear,
} from './wavEncoder.ts'

export interface CapturedAudio {
  readonly samples: Float32Array
  readonly sampleRate: number
}

export function buildRecordedTake(
  { samples, sampleRate }: CapturedAudio,
  limitSeconds: number,
): RecordedTake {
  const resampled = resampleLinear(samples, sampleRate, RECORDING_SAMPLE_RATE)
  // Input arrives in blocks, so the last one can overshoot the limit, and the
  // server refuses a take longer than the limit.
  const frames = Math.min(
    resampled.length,
    Math.floor(limitSeconds * RECORDING_SAMPLE_RATE),
  )
  const kept = resampled.subarray(0, frames)
  return {
    audio: encodeWav(kept, RECORDING_SAMPLE_RATE),
    durationSeconds: frames / RECORDING_SAMPLE_RATE,
    silent: isSilentTake(measureLevel(kept).peak),
  }
}
