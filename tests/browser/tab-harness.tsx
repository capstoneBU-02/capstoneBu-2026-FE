import { StrictMode, useEffect, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEMO_TAB_INPUTS } from '../../src/features/tab/demoTabScores.ts'
import { parseTabScore } from '../../src/features/tab/parseTabScore.ts'
import type { TabScore } from '../../src/features/tab/model.ts'
import { TabPanel, type TabSource } from '../../src/features/tab/TabPanel.tsx'
import '../../src/index.css'

// Renders the tab panel alone. score=<id> picks a demo transcription, and
// score=long repeats the standard one to 48 bars. The playback time lives
// outside React, as it does in the player: setTime changes only the time, as
// playback does; seek also tells the panel, as a restart while paused does,
// and neither re-renders anything. rerender re-renders the panel alone.

interface TabTestControls {
  score(): TabScore
  setTime(seconds: number): void
  seek(seconds: number): void
  rerender(): void
  setPlaying(playing: boolean): void
  // Unmounts the panel and mounts a new one, as opening another task does.
  remount(): void
}

declare global {
  interface Window {
    tabTest: TabTestControls
  }
}

interface RawBar {
  readonly number: number
  readonly startSeconds: number
}

interface RawScore {
  readonly bars: readonly RawBar[]
  readonly endSeconds: number
}

const LONG_REPEATS = 12

function repeated(input: RawScore, times: number): RawScore {
  const length = input.endSeconds
  return {
    ...input,
    bars: Array.from({ length: times }, (_, round) =>
      input.bars.map((bar) => ({
        ...bar,
        number: bar.number + round * input.bars.length,
        startSeconds: bar.startSeconds + round * length,
      })),
    ).flat(),
    endSeconds: length * times,
  }
}

function inputFor(name: string): unknown {
  if (name === 'long') {
    const standard = DEMO_TAB_INPUTS['e-standard'] as RawScore
    return repeated(standard, LONG_REPEATS)
  }
  return DEMO_TAB_INPUTS[name]
}

const name = new URLSearchParams(window.location.search).get('score')
const parsed = parseTabScore(inputFor(name ?? 'e-standard'))
if (!parsed.ok) throw new Error(parsed.error)
const score = parsed.score
const tab: TabSource = { status: 'ready', score }

let time = 0
const elapsed = () => time
const seekListeners = new Set<() => void>()
function subscribeSeek(listener: () => void) {
  seekListeners.add(listener)
  return () => {
    seekListeners.delete(listener)
  }
}

window.tabTest = {
  score: () => score,
  setTime(seconds) {
    time = seconds
  },
  seek(seconds) {
    time = seconds
    seekListeners.forEach((listener) => listener())
  },
  // Harness replaces these once it renders.
  rerender() {},
  setPlaying() {},
  remount() {},
}

export function Harness() {
  const [playing, setPlaying] = useState(false)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const [mount, remount] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    window.tabTest.rerender = rerender
    window.tabTest.setPlaying = setPlaying
    window.tabTest.remount = remount
  }, [])

  return (
    <main>
      <TabPanel
        key={mount}
        tab={tab}
        playing={playing}
        elapsed={elapsed}
        subscribeSeek={subscribeSeek}
      />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
