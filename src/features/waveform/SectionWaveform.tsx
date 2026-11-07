import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { songLengthTenths } from '../new-section/sectionTime.ts'
import { RangeTrack, type WaveformSection } from './RangeTrack.tsx'
import {
  rangeFromForm,
  zoomWindow,
  type SectionRange,
  type TimeWindow,
} from './timeline.ts'
import type { SongAudio } from './useSongAudio.ts'
import styles from './Waveform.module.css'

type Props = {
  songDurationSeconds: number
  audio: SongAudio
  // The time inputs' text: the waveform and the inputs share one value.
  start: string
  end: string
  // The name the new section will get, shown on the selection.
  label: string
  sections: readonly WaveformSection[]
  // The range is longer than the policy allows.
  over: boolean
  disabled: boolean
  onRange: (startSeconds: number, endSeconds: number) => void
}

const OVERVIEW_HEIGHT = 112
const ZOOM_HEIGHT = 64
const STATUS_TEXT = {
  loading: '파형을 불러오고 있어요.',
  failed: '파형을 불러오지 못했어요. 시작과 끝 시간은 직접 입력할 수 있어요.',
  ready: '',
} as const

export function SectionWaveform({
  songDurationSeconds,
  audio,
  start,
  end,
  label,
  sections,
  over,
  disabled,
  onRange,
}: Props) {
  const songTenths = songLengthTenths(songDurationSeconds)
  const range = rangeFromForm(start, end, songTenths)
  // While a zoom handle is dragged the zoom keeps its scale under the pointer.
  const [frozenZoom, setFrozenZoom] = useState<TimeWindow | null>(null)
  const zoom = range ? (frozenZoom ?? zoomWindow(range, songTenths)) : null
  const { state, retrying } = audio
  const groupRef = useRef<HTMLDivElement>(null)
  const retriedRef = useRef(false)
  const emit = (next: SectionRange) =>
    onRange(next.startTenths / 10, next.endTenths / 10)

  // The retry button goes away once the waveform loads; keep focus nearby.
  useEffect(() => {
    if (state.status !== 'ready' || !retriedRef.current) return
    retriedRef.current = false
    if (document.activeElement === document.body)
      groupRef.current?.focus({ preventScroll: true })
  }, [state.status])

  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      role="group"
      aria-label="구간 파형"
      className={styles.waveform}
      data-state={state.status}
    >
      {state.status === 'ready' ? (
        <>
          <RangeTrack
            variant="overview"
            window={{ start: 0, end: songTenths / 10 }}
            songTenths={songTenths}
            range={range}
            peaks={state.peaks}
            height={OVERVIEW_HEIGHT}
            over={over}
            disabled={disabled}
            sections={sections}
            label={label}
            onRange={emit}
          />
          <div className={styles.zoom}>
            {range && zoom ? (
              <RangeTrack
                variant="zoom"
                window={zoom}
                songTenths={songTenths}
                range={range}
                peaks={state.peaks}
                height={ZOOM_HEIGHT}
                over={over}
                disabled={disabled}
                onRange={emit}
                onDragging={(dragging) => setFrozenZoom(dragging ? zoom : null)}
              />
            ) : (
              <p className={styles.zoomHint}>
                구간을 고르면 여기서 자세히 조정할 수 있어요.
              </p>
            )}
          </div>
        </>
      ) : null}
      {/* One live region for the whole lifetime, so each change is read. */}
      <div
        className={
          state.status === 'ready' ? styles.statusIdle : styles.placeholder
        }
      >
        <p className={styles.status} role="status">
          {STATUS_TEXT[state.status]}
        </p>
        {(state.status === 'failed' || retrying) && (
          <Button
            compact
            aria-disabled={retrying}
            data-busy={retrying}
            onClick={() => {
              if (retrying) return
              retriedRef.current = true
              audio.retry()
            }}
          >
            다시 시도
          </Button>
        )}
      </div>
    </div>
  )
}
