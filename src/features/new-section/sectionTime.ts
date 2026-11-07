import { formatTime } from '../workspace/format.ts'

// Section boundaries are whole tenths of a second, the precision of the
// mm:ss.d inputs. Integers keep comparisons free of floating-point drift.
const TIME_PATTERN = /^(\d{1,2}):([0-5]\d)(?:\.(\d))?$/

export function parseSectionTime(text: string): number | null {
  const match = TIME_PATTERN.exec(text.trim())
  if (!match) return null
  const [, minutes, seconds, tenths = '0'] = match
  return Number(minutes) * 600 + Number(seconds) * 10 + Number(tenths)
}

export function formatSectionTime(tenths: number): string {
  return formatTime(tenths / 10)
}

export function formatSectionLength(tenths: number): string {
  return `${(tenths / 10).toFixed(1)}초`
}

export function secondsToTenths(seconds: number): number {
  return Math.round(seconds * 10)
}

// A section may end only at a tenth the file really reaches: 252.49 s
// allows 04:12.4 but not 04:12.5.
export function songLengthTenths(durationSeconds: number): number {
  return Math.floor(durationSeconds * 10 + 1e-6)
}
