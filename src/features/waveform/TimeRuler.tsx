import {
  formatTickLabel,
  labelSteps,
  tickTimes,
  timeToRatio,
  type TimeWindow,
} from './timeline.ts'
import styles from './Waveform.module.css'

// Room a mm:ss label needs right of its tick; a label without it is left
// off so the last one never spills past the waveform.
const LABEL_ROOM_PX = 38

type Props = {
  window: TimeWindow
  width: number
  // The overview marks minor steps between labels; the zoom does not.
  minor: boolean
}

function percent(seconds: number, window: TimeWindow) {
  return `${timeToRatio(seconds, window) * 100}%`
}

export function TimeRuler({ window, width, minor }: Props) {
  if (width <= 0) return <div className={styles.ruler} aria-hidden="true" />
  const steps = labelSteps(window, width)
  const labelled = new Set(tickTimes(window, steps.major))
  const minorTimes = minor
    ? tickTimes(window, steps.minor).filter((time) => !labelled.has(time))
    : []
  return (
    <div className={styles.ruler} aria-hidden="true">
      {minorTimes.map((time) => (
        <span
          key={`minor-${time}`}
          className={styles.minorTick}
          style={{ left: percent(time, window) }}
        />
      ))}
      {[...labelled].map((time) => (
        <span
          key={time}
          className={styles.majorTick}
          style={{ left: percent(time, window) }}
        >
          {timeToRatio(time, window) * width + LABEL_ROOM_PX <= width &&
            formatTickLabel(time)}
        </span>
      ))}
    </div>
  )
}
