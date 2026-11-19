import { useRef, type CSSProperties } from 'react'
import { useElementWidth } from '../waveform/useElementWidth.ts'
import { WaveformCanvas } from '../waveform/WaveformCanvas.tsx'
import { PlayPosition } from '../workspace/components/PlayPosition.tsx'
import type { ListenTrack } from './comparisonListening.ts'
import styles from './ComparisonTimeline.module.css'
import type { ViewRegion } from './comparisonView.ts'
import type {
  ComparisonLane,
  ComparisonListening,
} from './useComparisonPlayer.ts'

// The height of a lane in ComparisonTimeline.module.css.
const LANE_HEIGHT = 72

function percent(ratio: number) {
  return `${ratio * 100}%`
}

function bandPosition(region: ViewRegion): CSSProperties {
  return {
    left: percent(region.startRatio),
    width: percent(region.endRatio - region.startRatio),
  }
}

function targetPosition(region: ViewRegion) {
  return {
    '--center': percent((region.startRatio + region.endRatio) / 2),
    '--band': percent(region.endRatio - region.startRatio),
  } as CSSProperties
}

function Lane({
  lane,
  sound,
  sectionSeconds,
  width,
  regions,
  selectedId,
}: {
  lane: ListenTrack
  sound: ComparisonLane | null
  sectionSeconds: number
  width: number
  regions: readonly ViewRegion[]
  selectedId: string | null
}) {
  return (
    <div className={styles.lane} data-lane={lane}>
      {regions.map((region) => (
        <span
          key={region.id}
          className={styles.band}
          style={bandPosition(region)}
          data-region-id={region.id}
          data-kind={region.kind}
          data-selected={region.id === selectedId}
        />
      ))}
      {sound && width > 0 && (
        <div className={styles.wave}>
          <WaveformCanvas
            peaks={sound.peaks}
            window={{ start: 0, end: sectionSeconds }}
            range={null}
            over={false}
            width={width}
            height={LANE_HEIGHT}
            timeOf={sound.timeOf}
          />
        </div>
      )}
    </div>
  )
}

// The bands are drawn once per lane, but each place is one control laid over
// both lanes, so the keyboard stops at it once.
export function ComparisonTimeline({
  regions,
  baselineName,
  selectedId,
  regionName,
  onSelect,
  listening,
  sectionSeconds,
}: {
  regions: readonly ViewRegion[]
  baselineName: string
  selectedId: string | null
  regionName: (region: ViewRegion) => string
  onSelect: (regionId: string) => void
  listening: ComparisonListening
  sectionSeconds: number
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(trackRef)
  const lane = (name: ListenTrack) => (
    <Lane
      lane={name}
      sound={listening.lanes[name]}
      sectionSeconds={sectionSeconds}
      width={width}
      regions={regions}
      selectedId={selectedId}
    />
  )
  return (
    <section className={styles.timeline} aria-label="구간 타임라인">
      <div className={styles.labels}>
        <p className={styles.label}>
          {baselineName}
          <span>기준</span>
        </p>
        <p className={styles.label}>내 연주</p>
      </div>
      <div ref={trackRef} className={styles.track}>
        {lane('baseline')}
        {lane('performance')}
        {listening.active && (
          <PlayPosition
            rowsRef={trackRef}
            section={{ start: 0, end: sectionSeconds }}
            lead={listening.lead}
            player={listening.playback}
          />
        )}
        {regions.map((region) => (
          <button
            key={region.id}
            type="button"
            className={styles.target}
            style={targetPosition(region)}
            aria-label={regionName(region)}
            aria-pressed={region.id === selectedId}
            onClick={() => onSelect(region.id)}
          >
            <span className={styles.marker} data-kind={region.kind}>
              {region.number}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
