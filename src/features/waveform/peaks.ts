import { runInSlices, type SliceOptions } from '../../shared/scheduling.ts'
import type { TimeWindow } from './timeline.ts'

// Ten-millisecond buckets: fine enough for a zoom of a few seconds, small
// enough (30,000 values for five minutes) to redraw on every change.
export const PEAKS_PER_SECOND = 100

export interface WaveformPeaks {
  readonly peaksPerSecond: number
  // Loudest sample per bucket, scaled so the loudest bucket is 1.
  readonly values: Float32Array
}

export interface PeakOptions extends SliceOptions {
  readonly peaksPerSecond?: number
  // Buckets per step between time checks.
  readonly batchSize?: number
}

// Fills out[from..to) with the loudest absolute sample of any channel.
export function fillPeaks(
  channels: readonly Float32Array[],
  samplesPerPeak: number,
  from: number,
  to: number,
  out: Float32Array,
): void {
  const frames = channels[0]?.length ?? 0
  for (let bucket = from; bucket < to; bucket += 1) {
    const first = Math.floor(bucket * samplesPerPeak)
    const last = Math.min(Math.floor((bucket + 1) * samplesPerPeak), frames)
    let loudest = 0
    for (const samples of channels) {
      for (let index = first; index < last; index += 1) {
        const value = Math.abs(samples[index])
        if (value > loudest) loudest = value
      }
    }
    out[bucket] = loudest
  }
}

function normalize(values: Float32Array) {
  let loudest = 0
  for (const value of values) if (value > loudest) loudest = value
  if (loudest === 0) return
  for (let index = 0; index < values.length; index += 1)
    values[index] /= loudest
}

// Decoded songs hold millions of samples, so the scan runs in slices and
// yields between them instead of blocking input for the whole song.
export async function computePeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  {
    peaksPerSecond = PEAKS_PER_SECOND,
    batchSize = 100,
    ...slices
  }: PeakOptions,
): Promise<WaveformPeaks> {
  const samplesPerPeak = sampleRate / peaksPerSecond
  const frames = channels[0]?.length ?? 0
  const values = new Float32Array(Math.ceil(frames / samplesPerPeak))
  const batches = Math.ceil(values.length / batchSize)
  await runInSlices(
    batches,
    (batch) =>
      fillPeaks(
        channels,
        samplesPerPeak,
        batch * batchSize,
        Math.min((batch + 1) * batchSize, values.length),
        values,
      ),
    slices,
  )
  normalize(values)
  return { peaksPerSecond, values }
}

// One value per bar: the loudest bucket in the bar's slice of the window.
export function peakBars(
  peaks: WaveformPeaks,
  window: TimeWindow,
  barCount: number,
): Float32Array {
  const bars = new Float32Array(Math.max(0, barCount))
  const { values, peaksPerSecond } = peaks
  const secondsPerBar = (window.end - window.start) / barCount
  for (let bar = 0; bar < bars.length; bar += 1) {
    const from = (window.start + bar * secondsPerBar) * peaksPerSecond
    const to = (window.start + (bar + 1) * secondsPerBar) * peaksPerSecond
    const first = Math.floor(from + 1e-9)
    const last = Math.max(first + 1, Math.ceil(to - 1e-9))
    let loudest = 0
    for (let index = first; index < last && index < values.length; index += 1)
      if (values[index] > loudest) loudest = values[index]
    bars[bar] = loudest
  }
  return bars
}
