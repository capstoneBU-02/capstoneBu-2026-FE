import { parseSectionTime } from '../new-section/sectionTime.ts'

// Seconds shown across a waveform.
export interface TimeWindow {
  readonly start: number
  readonly end: number
}

// The selection in whole tenths, the precision of the time inputs.
export interface SectionRange {
  readonly startTenths: number
  readonly endTenths: number
}

export type RangeHandle = 'start' | 'end'

// Zoom shows this much of the song around each end of the selection.
const ZOOM_PADDING_TENTHS = 25
// Labels closer than this overlap at the Mono/Data size.
const MIN_LABEL_SPACING_PX = 72
const LABEL_STEPS: ReadonlyArray<{ major: number; minor: number }> = [
  { major: 0.5, minor: 0.1 },
  { major: 1, minor: 0.5 },
  { major: 2, minor: 1 },
  { major: 5, minor: 1 },
  { major: 10, minor: 5 },
  { major: 15, minor: 5 },
  { major: 30, minor: 10 },
  { major: 60, minor: 20 },
  { major: 120, minor: 30 },
]

export function timeToRatio(seconds: number, window: TimeWindow): number {
  return (seconds - window.start) / (window.end - window.start)
}

export function ratioToTime(ratio: number, window: TimeWindow): number {
  return window.start + ratio * (window.end - window.start)
}

export function labelSteps(
  window: TimeWindow,
  widthPx: number,
): { major: number; minor: number } {
  const pixelsPerSecond = widthPx / (window.end - window.start)
  return (
    LABEL_STEPS.find(
      ({ major }) => major * pixelsPerSecond >= MIN_LABEL_SPACING_PX,
    ) ?? LABEL_STEPS[LABEL_STEPS.length - 1]
  )
}

// Ticks on whole multiples of step, counted in tenths to avoid drift.
export function tickTimes(window: TimeWindow, step: number): number[] {
  const stepTenths = Math.round(step * 10)
  const first = Math.ceil((window.start * 10 - 1e-6) / stepTenths)
  const last = Math.floor((window.end * 10 + 1e-6) / stepTenths)
  const times: number[] = []
  for (let index = first; index <= last; index += 1)
    times.push((index * stepTenths) / 10 + 0) // + 0 turns -0 into 0
  return times
}

export function formatTickLabel(seconds: number): string {
  const tenths = Math.round(seconds * 10)
  const minutes = Math.floor(tenths / 600)
  const wholeSeconds = Math.floor((tenths % 600) / 10)
  const clock = `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`
  return tenths % 10 === 0 ? clock : `${clock}.${tenths % 10}`
}

export function zoomWindow(
  range: SectionRange,
  songTenths: number,
): TimeWindow {
  return {
    start: Math.max(0, range.startTenths - ZOOM_PADDING_TENTHS) / 10,
    end: Math.min(songTenths, range.endTenths + ZOOM_PADDING_TENTHS) / 10,
  }
}

// The waveform draws the inputs whenever they read as an ordered range. An
// end past the song is drawn at the song end; the form reports the error.
export function rangeFromForm(
  start: string,
  end: string,
  songTenths: number,
): SectionRange | null {
  const startTenths = parseSectionTime(start)
  const endTenths = parseSectionTime(end)
  if (startTenths === null || endTenths === null) return null
  const clampedEnd = Math.min(endTenths, songTenths)
  return startTenths < clampedEnd
    ? { startTenths, endTenths: clampedEnd }
    : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

// A handle stays inside the song and at least a tenth from the other one.
export function moveHandle(
  range: SectionRange,
  handle: RangeHandle,
  tenths: number,
  songTenths: number,
): SectionRange {
  return handle === 'start'
    ? { ...range, startTenths: clamp(tenths, 0, range.endTenths - 1) }
    : {
        ...range,
        endTenths: clamp(tenths, range.startTenths + 1, songTenths),
      }
}

const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 50,
  PageDown: -50,
}

// Slider keys: arrows move a tenth (a second with Shift), Page keys five
// seconds, Home and End to the furthest the handle can go.
export function keyboardRange(
  range: SectionRange,
  handle: RangeHandle,
  { key, shiftKey }: { key: string; shiftKey: boolean },
  songTenths: number,
): SectionRange | null {
  const current = handle === 'start' ? range.startTenths : range.endTenths
  let target: number
  if (key === 'Home') target = -Infinity
  else if (key === 'End') target = Infinity
  else if (key in KEY_STEPS) {
    const step = KEY_STEPS[key]
    target = current + (shiftKey && Math.abs(step) === 1 ? step * 10 : step)
  } else return null
  return moveHandle(range, handle, target, songTenths)
}

// Dragging across the track selects from the press to the pointer.
export function spanFrom(
  anchorTenths: number,
  pointerTenths: number,
  songTenths: number,
): SectionRange {
  const anchor = clamp(anchorTenths, 0, songTenths)
  const pointer = clamp(pointerTenths, 0, songTenths)
  if (pointer !== anchor)
    return {
      startTenths: Math.min(anchor, pointer),
      endTenths: Math.max(anchor, pointer),
    }
  return anchor < songTenths
    ? { startTenths: anchor, endTenths: anchor + 1 }
    : { startTenths: anchor - 1, endTenths: anchor }
}

// Dragging inside the selection moves it whole, keeping its length.
export function shiftRange(
  range: SectionRange,
  deltaTenths: number,
  songTenths: number,
): SectionRange {
  const length = range.endTenths - range.startTenths
  const startTenths = clamp(
    range.startTenths + deltaTenths,
    0,
    songTenths - length,
  )
  return { startTenths, endTenths: startTenths + length }
}

// The handle a press belongs to. Narrow ranges overlap their handles, so the
// boundary closer to the pointer wins; a tie keeps the handle that was hit.
export function nearestHandle(
  range: SectionRange,
  tenths: number,
  hit: RangeHandle,
): RangeHandle {
  const toStart = Math.abs(tenths - range.startTenths)
  const toEnd = Math.abs(tenths - range.endTenths)
  if (toStart === toEnd) return hit
  return toStart < toEnd ? 'start' : 'end'
}

// A press that travels less than this is a click, not a drag.
const DRAG_THRESHOLD_PX = 3

export type DragIntent = 'pending' | 'drag' | 'scroll'

// What a press on the overview turns into once it starts to travel. A mouse
// only drags. A finger or pen may also scroll the page (the track allows
// pan-y), so one that is not clearly heading sideways is left to the browser.
export function dragIntent(
  dx: number,
  dy: number,
  mayScroll: boolean,
): DragIntent {
  const sideways = Math.abs(dx)
  if (!mayScroll) return sideways < DRAG_THRESHOLD_PX ? 'pending' : 'drag'
  const upright = Math.abs(dy)
  if (Math.max(sideways, upright) < DRAG_THRESHOLD_PX) return 'pending'
  return sideways > upright ? 'drag' : 'scroll'
}
