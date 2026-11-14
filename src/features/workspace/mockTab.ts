import {
  DEMO_TAB_INPUTS,
  type DemoTabBar,
  type DemoTabInput,
} from '../tab/demoTabScores.ts'

// The mock server's transcription of a finished task: the demo tab of its
// tuning, repeated bar by bar until it covers the section. Like a server
// reply it is raw input, and the screen checks it with parseTabScore.
export function mockTabInput(
  tuningId: string,
  sectionSeconds: number,
): unknown {
  const demo = DEMO_TAB_INPUTS[tuningId] ?? DEMO_TAB_INPUTS['e-standard']
  const { bars, endSeconds } = repeatedBars(demo, sectionSeconds)
  // A fresh copy each time, as a new reply would be.
  return structuredClone({ ...demo, bars, endSeconds })
}

function repeatedBars(demo: DemoTabInput, sectionSeconds: number) {
  const bars: DemoTabBar[] = []
  let endSeconds = 0
  let offset = 0
  while (bars.length === 0 || endSeconds < sectionSeconds) {
    for (const [index, bar] of demo.bars.entries()) {
      if (bars.length > 0 && endSeconds >= sectionSeconds) break
      const next = demo.bars[index + 1]?.startSeconds ?? demo.endSeconds
      bars.push({
        ...bar,
        number: bars.length + 1,
        startSeconds: offset + bar.startSeconds,
      })
      endSeconds = offset + next
    }
    offset += demo.endSeconds
  }
  return { bars, endSeconds }
}
