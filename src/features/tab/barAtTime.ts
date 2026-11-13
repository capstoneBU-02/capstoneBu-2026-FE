import type { TabScore } from './model.ts'

// Index of the bar sounding at a section time, or null before the first bar,
// from the end of the last bar on, and for a time that is not a number.
export function barAtTime(score: TabScore, seconds: number): number | null {
  const { bars } = score
  const inside = seconds >= bars[0].startSeconds && seconds < score.endSeconds
  if (!inside) return null
  // Bar starts increase, so a binary search finds the last start at or before.
  let low = 0
  let high = bars.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (bars[middle].startSeconds <= seconds) low = middle
    else high = middle - 1
  }
  return low
}
