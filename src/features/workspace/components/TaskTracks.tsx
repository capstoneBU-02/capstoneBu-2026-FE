import { useEffect, useRef } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { PEAKS_PER_SECOND, type WaveformPeaks } from '../../waveform/peaks.ts'
import type { TimeWindow } from '../../waveform/timeline.ts'
import { TimeRuler } from '../../waveform/TimeRuler.tsx'
import { useElementWidth } from '../../waveform/useElementWidth.ts'
import type { SongAudio } from '../../waveform/useSongAudio.ts'
import { WaveformCanvas } from '../../waveform/WaveformCanvas.tsx'
import type { WorkspaceTask } from '../model.ts'
import { trackWindow, type TaskTrack, type TrackId } from '../tracks.ts'
import type { TaskAudio } from '../useTaskAudio.ts'
import pageStyles from '../WorkspacePage.module.css'
import styles from './TaskTracks.module.css'

const LANE_HEIGHT = 56
// Silence: every bar at its minimum height.
const FLAT_PEAKS: WaveformPeaks = {
  peaksPerSecond: PEAKS_PER_SECOND,
  values: new Float32Array(1),
}
const NOTE_TEXT = {
  pending: '기타를 분리하면 여기에 표시돼요',
  missing: '기타를 분리하지 못했어요',
} as const
const STATUS_TEXT = {
  loading: '파형을 불러오고 있어요.',
  failed: '파형을 불러오지 못했어요.',
  ready: '',
} as const

type LaneProps = {
  window: TimeWindow
  width: number
  playing: boolean
}

function Waveform({
  peaks,
  window,
  width,
  playing,
}: LaneProps & { peaks: WaveformPeaks }) {
  // The bar colours come from the row's CSS, which the canvas reads only
  // when it draws: a new key redraws it when the row starts or stops playing.
  return (
    <WaveformCanvas
      key={playing ? 'playing' : 'quiet'}
      peaks={peaks}
      window={window}
      range={null}
      over={false}
      width={width}
      height={LANE_HEIGHT}
    />
  )
}

function AudioLane({
  label,
  audio,
  ...lane
}: LaneProps & { label: string; audio: SongAudio }) {
  const { state, retrying } = audio
  const laneRef = useRef<HTMLDivElement>(null)
  const retriedRef = useRef(false)
  const message = STATUS_TEXT[state.status]

  // The retry button goes away once the waveform loads; keep focus nearby.
  useEffect(() => {
    if (state.status !== 'ready' || !retriedRef.current) return
    retriedRef.current = false
    if (document.activeElement === document.body)
      laneRef.current?.focus({ preventScroll: true })
  }, [state.status])

  return (
    <div
      ref={laneRef}
      tabIndex={-1}
      role="group"
      aria-label={`${label} 파형`}
      className={styles.lane}
      data-state={state.status}
    >
      {state.status === 'ready' && <Waveform peaks={state.peaks} {...lane} />}
      {/* One live region for the lane's lifetime, so each change is read. */}
      <p
        className={state.status === 'ready' ? pageStyles.srOnly : styles.note}
        role="status"
      >
        {message && <span className={pageStyles.srOnly}>{label} </span>}
        {message}
      </p>
      {(state.status === 'failed' || retrying) && (
        <Button
          compact
          aria-label={`${label} 다시 시도`}
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
  )
}

function TrackLane({
  track,
  audio,
  ...lane
}: LaneProps & { track: TaskTrack; audio: SongAudio | null }) {
  if (track.content === 'pending' || track.content === 'missing')
    return (
      <div className={styles.lane}>
        <p className={styles.note}>{NOTE_TEXT[track.content]}</p>
      </div>
    )
  if (track.content === 'flat')
    return (
      <div className={styles.lane}>
        <Waveform peaks={FLAT_PEAKS} {...lane} />
        <p className={pageStyles.srOnly}>기타 소리가 거의 없어요.</p>
      </div>
    )
  return audio ? (
    <AudioLane label={track.label} audio={audio} {...lane} />
  ) : null
}

// The section's tracks on one time ruler, in song time. The row that plays
// stands out.
export function TaskTracks({
  task,
  tracks,
  audio,
  playback,
}: { task: WorkspaceTask } & Pick<TaskAudio, 'tracks' | 'audio' | 'playback'>) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(rulerRef)
  const windowOf = (id: TrackId) => trackWindow(id, task)
  return (
    <section className={styles.tracks} aria-label="트랙">
      <div className={styles.row}>
        <div ref={rulerRef} className={styles.ruler}>
          <TimeRuler window={windowOf('input')} width={width} minor />
        </div>
      </div>
      {/* Safari drops the list role when list-style is none. */}
      <ul role="list" className={styles.list}>
        {tracks.map((track) => {
          const playing = track.id === playback
          return (
            <li key={track.id} className={styles.row} data-playing={playing}>
              <span className={styles.label}>
                {track.label}
                {track.content === 'flat' && (
                  <span className={styles.alertDot} aria-hidden="true" />
                )}
              </span>
              <TrackLane
                track={track}
                audio={audio[track.id]}
                window={windowOf(track.id)}
                width={width}
                playing={playing}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
