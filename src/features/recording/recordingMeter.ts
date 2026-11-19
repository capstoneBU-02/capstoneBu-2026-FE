const METER_FLOOR_DB = -60

export function formatRecordingClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  // Rounded as whole tenths so 59.96 reads 01:00.0, never 00:60.0.
  const tenths = Math.round(safe * 10)
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths - minutes * 600) / 10
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

// Loudness is heard in decibels: a linear meter would look empty for most of
// what a guitar plays.
export function meterLevel(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0
  const decibels = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, 1 - decibels / METER_FLOOR_DB))
}

export function litSegments(level: number, segments: number): number {
  return Math.min(segments, Math.ceil(level * segments))
}

// The section until the take runs past it; the drawing then shrinks to fit.
export function waveformSpanSeconds(
  elapsedSeconds: number,
  sectionSeconds: number,
): number {
  return Math.max(elapsedSeconds, sectionSeconds)
}

function loudestBetween(
  peaks: readonly number[],
  start: number,
  end: number,
): number {
  let loudest = 0
  for (let index = start; index < end; index += 1) {
    loudest = Math.max(loudest, peaks[index])
  }
  return loudest
}

export function waveformBars(
  peaks: readonly number[],
  elapsedSeconds: number,
  spanSeconds: number,
  barCount: number,
): readonly number[] {
  if (peaks.length === 0 || spanSeconds <= 0 || barCount <= 0) return []
  const filled = Math.min(
    barCount,
    Math.round((barCount * elapsedSeconds) / spanSeconds),
  )
  return Array.from({ length: filled }, (_, bar) => {
    const start = Math.floor((bar * peaks.length) / filled)
    const end = Math.ceil(((bar + 1) * peaks.length) / filled)
    return loudestBetween(peaks, start, Math.max(end, start + 1))
  })
}
