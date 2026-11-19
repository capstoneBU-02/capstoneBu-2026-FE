import { Icon } from '../../shared/ui/Icon.tsx'
import {
  baselineLabel,
  comparisonSummaryCopy,
  regionTagLabel,
  tempoNote,
} from './comparisonCopy.ts'
import {
  listenOptions,
  listenPartialNotice,
  NO_TRACK_NOTICE,
} from './comparisonListening.ts'
import { ComparisonRegionList } from './ComparisonRegionList.tsx'
import styles from './ComparisonResultView.module.css'
import { ComparisonTimeline } from './ComparisonTimeline.tsx'
import {
  regionTimeLabel,
  viewRegions,
  type Section,
  type ViewRegion,
} from './comparisonView.ts'
import type { ComparisonPlayback, ComparisonResult } from './model.ts'
import type { ComparisonListening } from './useComparisonPlayer.ts'

export interface ComparisonResultViewProps {
  readonly result: ComparisonResult
  readonly playback: ComparisonPlayback | null
  readonly section: Section
  readonly listening: ComparisonListening
  readonly onMarkRegion: (regionId: string, checked: boolean) => void
}

// A band shows only a number, so both controls for a place share a full name.
function regionName(region: ViewRegion) {
  const time = regionTimeLabel(region)
  const tag = regionTagLabel(region.kind)
  return region.number === null
    ? `${tag} 구간, ${time}`
    : `${region.number}번 구간, ${time}, ${tag}`
}

export function ComparisonResultView({
  result,
  playback,
  section,
  listening,
  onMarkRegion,
}: ComparisonResultViewProps) {
  const { selectedRegionId: selectedId, selectRegion } = listening
  const regions = viewRegions(result.regions, section)
  const summary = comparisonSummaryCopy(result.regions, result.baseline)
  const tempo = tempoNote(result.overallTempo)
  // The result still reads when its sounds could not be listed (CMP-04).
  const partialNotice = playback
    ? listenPartialNotice(listenOptions(playback, result.baseline))
    : NO_TRACK_NOTICE

  return (
    <div className={styles.result}>
      {summary && (
        <div className={styles.summary}>
          <h2>{summary.title}</h2>
          <p>{summary.description}</p>
        </div>
      )}
      {tempo && <p className={styles.note}>{tempo}</p>}
      {/* Stays mounted so a notice for the next take is announced. */}
      <div role="status">
        {partialNotice && (
          <p className={styles.note}>
            <Icon name="info" />
            {partialNotice}
          </p>
        )}
      </div>
      <div
        className={styles.board}
        data-has-list={regions.length > 0 ? 'true' : 'false'}
      >
        <ComparisonTimeline
          regions={regions}
          baselineName={baselineLabel(result.baseline)}
          selectedId={selectedId}
          regionName={regionName}
          onSelect={selectRegion}
          listening={listening}
          sectionSeconds={section.rangeEndSeconds - section.rangeStartSeconds}
        />
        {regions.length > 0 && (
          <ComparisonRegionList
            regions={regions}
            baseline={result.baseline}
            selectedId={selectedId}
            regionName={regionName}
            onSelect={selectRegion}
            onMark={onMarkRegion}
          />
        )}
      </div>
    </div>
  )
}
