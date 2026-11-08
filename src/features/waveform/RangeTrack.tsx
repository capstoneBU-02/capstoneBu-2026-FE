import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatSectionTime } from '../new-section/sectionTime.ts'
import type { WaveformPeaks } from './peaks.ts'
import {
  dragIntent,
  keyboardRange,
  moveHandle,
  nearestHandle,
  ratioToTime,
  shiftRange,
  spanFrom,
  timeToRatio,
  type RangeHandle,
  type SectionRange,
  type TimeWindow,
} from './timeline.ts'
import { TimeRuler } from './TimeRuler.tsx'
import { useElementWidth } from './useElementWidth.ts'
import { WaveformCanvas } from './WaveformCanvas.tsx'
import styles from './Waveform.module.css'

export interface WaveformSection {
  readonly id: string
  readonly name: string
  readonly startSeconds: number
  readonly endSeconds: number
}

type Props = {
  // overview: the whole song, with sliders and drags that select or move the
  // range. zoom: the area around the range, with pointer-only handles.
  variant: 'overview' | 'zoom'
  window: TimeWindow
  songTenths: number
  range: SectionRange | null
  peaks: WaveformPeaks
  height: number
  over: boolean
  disabled: boolean
  sections?: readonly WaveformSection[]
  label?: string
  onRange: (range: SectionRange) => void
  onDragging?: (dragging: boolean) => void
}

type Drag =
  | {
      readonly kind: 'handle'
      readonly pointerId: number
      readonly origin: SectionRange
      readonly handle: RangeHandle
      // Where the press landed relative to the boundary, so it does not jump.
      readonly offset: number
    }
  | {
      readonly kind: 'span' | 'move'
      readonly pointerId: number
      readonly origin: SectionRange | null
      readonly anchor: number
      readonly startX: number
      readonly startY: number
      // A finger or pen may be scrolling the page instead.
      readonly mayScroll: boolean
      readonly moved: boolean
    }

const HANDLE_LABELS: Record<RangeHandle, string> = {
  start: '구간 시작',
  end: '구간 끝',
}

function percent(seconds: number, window: TimeWindow) {
  return `${timeToRatio(seconds, window) * 100}%`
}

function lengthPercent(seconds: number, window: TimeWindow) {
  return `${(seconds / (window.end - window.start)) * 100}%`
}

function sameRange(a: SectionRange | null, b: SectionRange) {
  return a?.startTenths === b.startTenths && a.endTenths === b.endTenths
}

export function RangeTrack({
  variant,
  window,
  songTenths,
  range,
  peaks,
  height,
  over,
  disabled,
  sections = [],
  label,
  onRange,
  onDragging,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const lastEmitted = useRef<SectionRange | null>(null)
  const width = useElementWidth(trackRef)
  const isOverview = variant === 'overview'

  function emit(next: SectionRange) {
    if (sameRange(lastEmitted.current, next)) return
    lastEmitted.current = next
    onRange(next)
  }

  // The pointer is held inside the window: the zoom never scrolls under it.
  function tenthsAt(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    return Math.round(ratioToTime(ratio, window) * 10)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (disabled || dragRef.current) return
    if (event.button !== 0 || !event.isPrimary) return
    const hit = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-handle]',
    )
    const { pointerId } = event
    const tenths = tenthsAt(event.clientX)
    let drag: Drag
    if (hit && range) {
      const handle = nearestHandle(
        range,
        tenths,
        hit.dataset.handle as RangeHandle,
      )
      const boundary = handle === 'start' ? range.startTenths : range.endTenths
      drag = {
        kind: 'handle',
        pointerId,
        origin: range,
        handle,
        offset: tenths - boundary,
      }
      if (isOverview) focusHandle(handle)
    } else if (isOverview) {
      const inside =
        range !== null &&
        tenths >= range.startTenths &&
        tenths <= range.endTenths
      drag = {
        kind: inside ? 'move' : 'span',
        pointerId,
        origin: range,
        anchor: tenths,
        startX: event.clientX,
        startY: event.clientY,
        mayScroll: event.pointerType !== 'mouse',
        moved: false,
      }
    } else return
    // Keeps the page from selecting text. Scrolling is up to touch-action.
    event.preventDefault()
    lastEmitted.current = range
    dragRef.current = drag
    event.currentTarget.setPointerCapture(pointerId)
    onDragging?.(true)
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    // Other fingers on the track never steer the drag in progress.
    if (!drag || event.pointerId !== drag.pointerId) return
    // Submitting locks the range, even under a pointer still held down.
    if (disabled) {
      stopDrag()
      return
    }
    const tenths = tenthsAt(event.clientX)
    if (drag.kind === 'handle') {
      if (range)
        emit(moveHandle(range, drag.handle, tenths - drag.offset, songTenths))
      return
    }
    if (!drag.moved) {
      const intent = dragIntent(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        drag.mayScroll,
      )
      if (intent === 'pending') return
      if (intent === 'scroll') {
        // The page scrolls; the range stays as it was.
        stopDrag()
        return
      }
    }
    dragRef.current = { ...drag, moved: true }
    emit(
      drag.kind === 'move' && drag.origin
        ? shiftRange(drag.origin, tenths - drag.anchor, songTenths)
        : spanFrom(drag.anchor, tenths, songTenths),
    )
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (event.pointerId !== drag?.pointerId) return
    // The browser took the gesture over, so the drag never happened. A span
    // started on an empty track has nothing to go back to and stays.
    if (event.type === 'pointercancel' && drag.origin) emit(drag.origin)
    stopDrag()
  }

  function stopDrag() {
    if (!dragRef.current) return
    dragRef.current = null
    onDragging?.(false)
  }

  function focusHandle(handle: RangeHandle) {
    trackRef.current
      ?.querySelector<HTMLElement>(`[data-handle="${handle}"]`)
      ?.focus()
  }

  function handleProps(handle: RangeHandle, current: SectionRange) {
    const value = handle === 'start' ? current.startTenths : current.endTenths
    if (!isOverview) return { 'aria-hidden': true }
    const [min, max] =
      handle === 'start'
        ? [0, current.endTenths - 1]
        : [current.startTenths + 1, songTenths]
    return {
      role: 'slider',
      tabIndex: disabled ? -1 : 0,
      'aria-label': HANDLE_LABELS[handle],
      'aria-valuemin': min / 10,
      'aria-valuemax': max / 10,
      'aria-valuenow': value / 10,
      'aria-valuetext': formatSectionTime(value),
      'aria-disabled': disabled || undefined,
      onKeyDown: (event: KeyboardEvent) => {
        if (disabled) return
        const next = keyboardRange(current, handle, event, songTenths)
        if (!next) return
        event.preventDefault()
        onRange(next)
      },
    } as const
  }

  return (
    <div
      className={styles.lane}
      data-variant={variant}
      data-testid={`${variant}-track`}
    >
      <TimeRuler window={window} width={width} minor={isOverview} />
      <div
        ref={trackRef}
        className={styles.track}
        style={{ height }}
        data-disabled={disabled}
        onPointerDown={startDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {sections.map((section) => (
          <div
            key={section.id}
            className={styles.section}
            style={{
              left: percent(section.startSeconds, window),
              width: lengthPercent(
                section.endSeconds - section.startSeconds,
                window,
              ),
            }}
            aria-hidden="true"
          >
            <span className={styles.sectionLabel}>{section.name}</span>
          </div>
        ))}
        {range && (
          <div
            className={styles.selection}
            data-over={over}
            style={{
              left: percent(range.startTenths / 10, window),
              width: lengthPercent(
                (range.endTenths - range.startTenths) / 10,
                window,
              ),
            }}
            aria-hidden="true"
          >
            {label && <span className={styles.selectionLabel}>{label}</span>}
          </div>
        )}
        {width > 0 && (
          <WaveformCanvas
            peaks={peaks}
            window={window}
            range={range}
            over={over}
            width={width}
            height={height}
          />
        )}
        {range &&
          (['start', 'end'] as const).map((handle) => (
            <div
              key={handle}
              className={styles.handle}
              data-handle={handle}
              data-over={over}
              style={{
                left: percent(
                  (handle === 'start' ? range.startTenths : range.endTenths) /
                    10,
                  window,
                ),
              }}
              {...handleProps(handle, range)}
            >
              <span className={styles.grip} />
            </div>
          ))}
      </div>
    </div>
  )
}
