import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { barAtTime } from './barAtTime.ts'
import { layoutTab, type TabLayout } from './layout.ts'
import type { TabScore } from './model.ts'
import styles from './TabPanel.module.css'
import { TabView } from './TabView.tsx'

export interface TabStaffProps {
  readonly score: TabScore
  readonly playing: boolean
  // Seconds since the section start, read on demand like the player's clock.
  elapsed(): number
  // Calls back when the time moves without playback, as a restart while
  // paused does, and returns the unsubscribe.
  subscribeSeek(listener: () => void): () => void
  // The drawn tab SVG, for a download of the tab as it shows.
  readonly svgRef?: Ref<SVGSVGElement>
}

interface Painted {
  readonly layout: TabLayout
  readonly bar: number | null
}

// Moves the current-bar box straight in the DOM, as the player writes its
// time: playback re-renders nothing, and the tab SVG stays as drawn.
function paintCurrentBar(
  element: HTMLElement,
  layout: TabLayout,
  bar: number | null,
) {
  const box = bar === null ? null : layout.bars[bar]
  if (box === null) {
    element.hidden = true
    delete element.dataset.bar
    return
  }
  element.hidden = false
  element.dataset.bar = String(box.number)
  element.style.left = `${box.x}px`
  element.style.top = `${box.y}px`
  element.style.width = `${box.width}px`
  element.style.height = `${box.height}px`
}

function useCurrentBar(
  { score, playing, elapsed, subscribeSeek }: TabStaffProps,
  layout: TabLayout | null,
) {
  const ref = useRef<HTMLDivElement>(null)
  const painted = useRef<Painted | null>(null)

  // Reads the latest layout and clock, so the frame loop and the seek
  // subscription never restart for them.
  const paint = useEffectEvent(() => {
    const element = ref.current
    if (element === null || layout === null) return
    const bar = barAtTime(score, elapsed())
    const last = painted.current
    if (last !== null && last.layout === layout && last.bar === bar) return
    painted.current = { layout, bar }
    paintCurrentBar(element, layout, bar)
  })

  // A render can bring a new layout, as a resize does, so every render
  // paints. The check above leaves the DOM alone when nothing moved.
  useLayoutEffect(() => {
    paint()
  })

  // A restart while paused moves the time without a render.
  useEffect(() => subscribeSeek(() => paint()), [subscribeSeek])

  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      paint()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing])

  return ref
}

// Width of the box the tab fills, kept up to date as the page resizes.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

// Loaded only when a tab is shown, so the rest of the app never downloads
// the layout and drawing code.
export default function TabStaff(props: TabStaffProps) {
  const { score, svgRef } = props
  const [scrollerRef, width] = useWidth()
  const layout = useMemo(
    () => (width === null ? null : layoutTab(score, width)),
    [score, width],
  )
  const currentBarRef = useCurrentBar(props, layout)
  // Only a tab wider than its area scrolls, and only then takes keyboard
  // focus, so the arrow keys can scroll it.
  const scrolls = layout !== null && width !== null && layout.width > width

  return (
    <div
      ref={scrollerRef}
      className={styles.scroller}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? '타브 악보 가로 스크롤' : undefined}
      tabIndex={scrolls ? 0 : undefined}
    >
      {layout !== null && (
        <div className={styles.canvas}>
          <TabView score={score} layout={layout} svgRef={svgRef} />
          <div
            ref={currentBarRef}
            className={styles.currentBar}
            data-mark="current-bar"
            aria-hidden="true"
            hidden
          />
        </div>
      )}
    </div>
  )
}
