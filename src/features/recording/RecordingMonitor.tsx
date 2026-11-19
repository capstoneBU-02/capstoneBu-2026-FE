import { useEffect, useRef, type ReactNode } from 'react'
import type { MicrophoneCapture } from './recorderEngine.ts'
import {
  formatRecordingClock,
  litSegments,
  meterLevel,
  waveformBars,
  waveformSpanSeconds,
} from './recordingMeter.ts'
import styles from './RecordingPanel.module.css'

const BAR_WIDTH = 2
const BAR_STEP = 4
const MIN_BAR_HEIGHT = 2
const METER_SEGMENTS = 24
const METER_GAP = 2
// Where the meter turns from a safe level to one close to clipping.
const METER_WARM = 0.75
const METER_HOT = 0.9

interface Palette {
  readonly wave: string
  readonly rest: string
  readonly head: string
  readonly safe: string
  readonly warm: string
  readonly hot: string
}

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return {
    wave: token('--state-alert'),
    rest: token('--console-line'),
    head: token('--console-text'),
    safe: token('--state-done'),
    warm: token('--accent-default'),
    hot: token('--state-alert'),
  }
}

// Sized on every frame so the drawing follows a column that changes width.
function prepareCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return null
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelWidth = Math.round(width * ratio)
  const pixelHeight = Math.round(height * ratio)
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  return { context, width, height }
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  palette: Palette,
  capture: MicrophoneCapture,
  sectionSeconds: number,
) {
  const prepared = prepareCanvas(canvas)
  if (!prepared) return
  const { context, width, height } = prepared
  const elapsed = capture.elapsedSeconds()
  const span = waveformSpanSeconds(elapsed, sectionSeconds)
  const bars = waveformBars(
    capture.peaks(),
    elapsed,
    span,
    Math.floor(width / BAR_STEP),
  )
  const middle = height / 2
  const head = span > 0 ? Math.min(width - 1, (elapsed / span) * width) : 0

  context.fillStyle = palette.wave
  bars.forEach((peak, index) => {
    const barHeight = Math.max(MIN_BAR_HEIGHT, meterLevel(peak) * height)
    context.fillRect(
      index * BAR_STEP,
      middle - barHeight / 2,
      BAR_WIDTH,
      barHeight,
    )
  })

  context.strokeStyle = palette.rest
  context.setLineDash([2, 4])
  context.beginPath()
  context.moveTo(head, middle)
  context.lineTo(width, middle)
  context.stroke()
  context.setLineDash([])

  context.fillStyle = palette.head
  context.fillRect(head, 0, BAR_WIDTH, height)
}

function segmentColor(position: number, palette: Palette) {
  if (position >= METER_HOT) return palette.hot
  return position >= METER_WARM ? palette.warm : palette.safe
}

function drawMeter(
  canvas: HTMLCanvasElement,
  palette: Palette,
  capture: MicrophoneCapture,
) {
  const prepared = prepareCanvas(canvas)
  if (!prepared) return
  const { context, width, height } = prepared
  const lit = litSegments(
    meterLevel(capture.peaks().at(-1) ?? 0),
    METER_SEGMENTS,
  )
  const segment = (width - METER_GAP * (METER_SEGMENTS - 1)) / METER_SEGMENTS

  for (let index = 0; index < METER_SEGMENTS; index += 1) {
    context.fillStyle =
      index < lit ? segmentColor(index / METER_SEGMENTS, palette) : palette.rest
    context.fillRect(index * (segment + METER_GAP), 0, segment, height)
  }
}

// The take's clock, waveform and input level. All three are drawn straight to
// the page: a render per frame would compete with the sound being recorded.
export function RecordingMonitor({
  capture,
  sectionSeconds,
  controls,
  hint,
}: {
  capture: MicrophoneCapture
  sectionSeconds: number
  controls: ReactNode
  hint: string
}) {
  const clockRef = useRef<HTMLSpanElement>(null)
  const waveformRef = useRef<HTMLCanvasElement>(null)
  const meterRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const clock = clockRef.current
    const waveform = waveformRef.current
    const meter = meterRef.current
    if (!clock || !waveform || !meter) return
    const palette = readPalette(waveform)
    let frame = 0

    function draw() {
      if (!clock || !waveform || !meter) return
      clock.textContent = formatRecordingClock(capture.elapsedSeconds())
      drawWaveform(waveform, palette, capture, sectionSeconds)
      drawMeter(meter, palette, capture)
      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [capture, sectionSeconds])

  return (
    <>
      <div className={styles.monitor}>
        <p className={styles.clock}>
          <span ref={clockRef} className={styles.elapsed} role="timer">
            {formatRecordingClock(0)}
          </span>
          <span className={styles.total}>
            / {formatRecordingClock(sectionSeconds)}
          </span>
        </p>
        <canvas
          ref={waveformRef}
          className={styles.waveform}
          data-recording="waveform"
          aria-hidden="true"
        />
      </div>
      <div className={styles.footer}>
        <div className={styles.actions}>{controls}</div>
        <canvas ref={meterRef} className={styles.meter} aria-hidden="true" />
        <p className={styles.hint}>{hint}</p>
      </div>
    </>
  )
}
