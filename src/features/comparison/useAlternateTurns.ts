import { useEffect, useEffectEvent, useRef } from 'react'
import type { SectionPlayback } from '../player/useSectionPlayer.ts'
import {
  alternateTurnAt,
  nextListenPass,
  type ListenTrack,
} from './comparisonListening.ts'
import type { TimeMap } from './timeMap.ts'

// A hidden page gets no animation frames, though its sound plays on. Its
// timers may still fire a second apart; each tick reads the position afresh,
// so a late one only switches late.
const HIDDEN_TICK_MS = 100

// Calls back on every animation frame, or on a timer while the page is
// hidden. Returns the stop.
function everyFrame(callback: () => void): () => void {
  let frame = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    cancelAnimationFrame(frame)
    clearInterval(timer)
  }
  const start = () => {
    stop()
    if (document.hidden) {
      timer = setInterval(callback, HIDDEN_TICK_MS)
      return
    }
    frame = requestAnimationFrame(function step() {
      callback()
      frame = requestAnimationFrame(step)
    })
  }
  const restart = () => {
    callback()
    start()
  }
  start()
  document.addEventListener('visibilitychange', restart)
  return () => {
    document.removeEventListener('visibilitychange', restart)
    stop()
  }
}

// Swaps the two sounds while 번갈아 plays. The turn follows the position, so a
// seek lands on the sound that belongs there.
export function useAlternateTurns({
  active,
  playback,
  turn,
  map,
  rangeSeconds,
  regionSelected,
  resetKey,
  onTurn,
}: {
  active: boolean
  playback: Pick<SectionPlayback, 'playing' | 'elapsed' | 'subscribeSeek'>
  turn: ListenTrack
  map: TimeMap
  rangeSeconds: number
  regionSelected: boolean
  resetKey: string
  onTurn: (next: ListenTrack) => void
}) {
  const { playing, elapsed, subscribeSeek } = playback
  const passRef = useRef(0)
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    passRef.current = 0
    lastRef.current = null
  }, [active, resetKey])

  useEffect(
    () =>
      subscribeSeek(() => {
        lastRef.current = null
      }),
    [subscribeSeek],
  )

  // The sound whose turn it is this many seconds into the range. Choosing
  // 번갈아 starts on its first pass.
  const turnAt = (elapsedInRange: number) =>
    alternateTurnAt(map, {
      passIndex: active ? passRef.current : 0,
      elapsedInRange,
      rangeSeconds,
      regionSelected,
    })

  const tick = useEffectEvent(() => {
    const seconds = elapsed()
    passRef.current = nextListenPass(passRef.current, lastRef.current, seconds)
    lastRef.current = seconds
    const next = turnAt(seconds)
    if (next !== turn) onTurn(next)
  })

  useEffect(() => {
    if (!active) return
    // A stop is read too: one at the range end has gone back to its start,
    // which counts the pass, so the next play starts on the next turn.
    if (!playing) {
      tick()
      return
    }
    return everyFrame(() => tick())
  }, [active, playing])

  return { turnAt }
}
