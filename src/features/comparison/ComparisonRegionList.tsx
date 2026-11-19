import { useId } from 'react'
import { regionTagLabel, unavailableRegionCopy } from './comparisonCopy.ts'
import styles from './ComparisonRegionList.module.css'
import { regionTimeLabel, type ViewRegion } from './comparisonView.ts'
import type { ComparisonResult } from './model.ts'

function RegionRow({
  region,
  baseline,
  selected,
  name,
  onSelect,
  onMark,
}: {
  region: ViewRegion
  baseline: ComparisonResult['baseline']
  selected: boolean
  name: string
  onSelect: (regionId: string) => void
  onMark: (regionId: string, checked: boolean) => void
}) {
  const { number } = region
  const reason =
    number === null
      ? unavailableRegionCopy(region.unavailableReason, baseline)
      : null

  return (
    <li className={styles.row} data-kind={region.kind} data-selected={selected}>
      <button
        type="button"
        className={styles.select}
        aria-label={reason === null ? name : `${name}, ${reason}`}
        aria-pressed={selected}
        onClick={() => onSelect(region.id)}
      >
        {number === null ? (
          <span className={styles.swatch} />
        ) : (
          <span className={styles.number}>{number}</span>
        )}
        <span className={styles.time}>{regionTimeLabel(region)}</span>
        <span className={styles.tag} data-kind={region.kind}>
          {regionTagLabel(region.kind)}
        </span>
        {reason !== null && <span className={styles.reason}>{reason}</span>}
      </button>
      {/* Outside the button: marking a place must not also choose it. */}
      {number !== null && (
        <label className={styles.mark}>
          <input
            type="checkbox"
            className={styles.box}
            checked={region.checked}
            aria-label={`${number}번 구간을 확인함으로 표시`}
            onChange={(event) => onMark(region.id, event.target.checked)}
          />
          확인함으로 표시
        </label>
      )}
    </li>
  )
}

export function ComparisonRegionList({
  regions,
  baseline,
  selectedId,
  regionName,
  onSelect,
  onMark,
}: {
  regions: readonly ViewRegion[]
  baseline: ComparisonResult['baseline']
  selectedId: string | null
  regionName: (region: ViewRegion) => string
  onSelect: (regionId: string) => void
  onMark: (regionId: string, checked: boolean) => void
}) {
  const headingId = useId()
  const differences = regions.filter((region) => region.number !== null)
  const checkedCount = differences.filter((region) => region.checked).length

  return (
    <section className={styles.list} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId}>다시 들어볼 곳</h2>
        {differences.length > 0 && (
          <span className={styles.count}>
            {checkedCount}/{differences.length} 확인
          </span>
        )}
      </div>
      <ul className={styles.rows}>
        {regions.map((region) => (
          <RegionRow
            key={region.id}
            region={region}
            baseline={baseline}
            selected={region.id === selectedId}
            name={regionName(region)}
            onSelect={onSelect}
            onMark={onMark}
          />
        ))}
      </ul>
    </section>
  )
}
