import { useLayoutEffect, useRef } from 'react'
import { peakBars, type WaveformPeaks } from './peaks.ts'
import type { SectionRange, TimeWindow } from './timeline.ts'
import styles from './Waveform.module.css'

type Props = {
  peaks: WaveformPeaks
  window: TimeWindow
  range: SectionRange | null
  over: boolean
  width: number
  height: number
}

const BAR_WIDTH = 2
const BAR_PITCH = 4
const MIN_BAR_HEIGHT = 2
const VERTICAL_PADDING = 8

function colors(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas)
  return {
    bar: style.getPropertyValue('--wave-bar'),
    selected: style.getPropertyValue('--wave-bar-selected'),
    over: style.getPropertyValue('--wave-bar-over'),
  }
}

function draw(canvas: HTMLCanvasElement, props: Props) {
  const { peaks, window, range, over, width, height } = props
  const scale = globalThis.devicePixelRatio || 1
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context || width <= 0) return
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)
  const palette = colors(canvas)
  const count = Math.floor(width / BAR_PITCH)
  const bars = peakBars(peaks, window, count)
  // Spread the bars over the full width so each sits on its own time.
  const pitch = width / count
  const secondsPerBar = (window.end - window.start) / count
  const usable = height - VERTICAL_PADDING
  for (let index = 0; index < count; index += 1) {
    const tenths = (window.start + (index + 0.5) * secondsPerBar) * 10
    const inside =
      range !== null && tenths >= range.startTenths && tenths <= range.endTenths
    const barHeight = Math.max(MIN_BAR_HEIGHT, bars[index] * usable)
    context.fillStyle = inside
      ? over
        ? palette.over
        : palette.selected
      : palette.bar
    context.fillRect(
      index * pitch + (pitch - BAR_WIDTH) / 2,
      (height - barHeight) / 2,
      BAR_WIDTH,
      barHeight,
    )
  }
}

// Bars inside the selection take the accent; the rest stay neutral.
export function WaveformCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { peaks, window, range, over, width, height } = props
  // Redraws only when a drawn value changes, not on every new object.
  const { start: windowStart, end: windowEnd } = window
  const startTenths = range?.startTenths ?? null
  const endTenths = range?.endTenths ?? null

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const drawnRange =
      startTenths === null || endTenths === null
        ? null
        : { startTenths, endTenths }
    draw(canvas, {
      peaks,
      window: { start: windowStart, end: windowEnd },
      range: drawnRange,
      over,
      width,
      height,
    })
  }, [
    peaks,
    windowStart,
    windowEnd,
    startTenths,
    endTenths,
    over,
    width,
    height,
  ])

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
