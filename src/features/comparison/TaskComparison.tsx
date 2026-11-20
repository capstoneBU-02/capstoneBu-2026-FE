import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import type { MediaDurationProbe } from '../add-song/mediaDuration.ts'
import { RecordingPanel } from '../recording/RecordingPanel.tsx'
import type { TakeClock } from '../recording/useRecorder.ts'
import { isFromPreviousSection } from './comparisonRules.ts'
import {
  performanceOptions,
  regionLegend,
  type Section,
} from './comparisonView.ts'
import { ComparisonResultView } from './ComparisonResultView.tsx'
import { ComparisonStatusPanel } from './ComparisonStatusPanel.tsx'
import { PerformanceUploadDialog } from './PerformanceUploadDialog.tsx'
import styles from './TaskComparison.module.css'
import type { ComparisonListening } from './useComparisonPlayer.ts'
import type { ComparisonSession } from './useComparisonSession.ts'

export type TakeEntry = 'record' | 'upload'

// The 비교 view of a finished task: which take is open, what became of its
// comparison, and the two ways to add a take.
export function TaskComparison({
  session,
  listening,
  section,
  sectionName,
  probeDuration,
  entry,
  onEntryChange,
  onCaptureChange,
  onUnsavedTakeChange,
}: {
  session: ComparisonSession
  listening: ComparisonListening
  section: Section
  sectionName: string
  probeDuration: MediaDurationProbe
  entry: TakeEntry | null
  onEntryChange: (entry: TakeEntry | null) => void
  onCaptureChange: (take: TakeClock | null) => void
  onUnsavedTakeChange?: (unsaved: boolean) => void
}) {
  const takeSelectId = useId()
  const { state, panel, selected } = session
  const sectionSeconds = section.rangeEndSeconds - section.rangeStartSeconds
  const options = performanceOptions(state.performances, section)
  const legend = state.result && regionLegend(state.result.regions)
  const canRequest =
    selected !== null && !isFromPreviousSection(selected, section)

  // Opening the upload closes the recording panel and the take with it.
  const [takeUnsaved, setTakeUnsaved] = useState(false)
  const reportUnsavedTake = useCallback(
    (unsaved: boolean) => {
      setTakeUnsaved(unsaved)
      onUnsavedTakeChange?.(unsaved)
    },
    [onUnsavedTakeChange],
  )

  // A panel that gives way takes its buttons along, and keyboard focus with them.
  const rootRef = useRef<HTMLDivElement>(null)
  const shownPanelRef = useRef(panel)
  useEffect(() => {
    if (shownPanelRef.current === panel) return
    shownPanelRef.current = panel
    if (document.activeElement === document.body)
      rootRef.current?.focus({ preventScroll: true })
  }, [panel])

  return (
    <div ref={rootRef} className={styles.comparison} tabIndex={-1}>
      {options.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.take} htmlFor={takeSelectId}>
            <span>연주</span>
            <select
              id={takeSelectId}
              value={state.selectedId ?? ''}
              onChange={(event) => session.select(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.detail}
                </option>
              ))}
            </select>
          </label>
          {panel === 'result' && legend && (
            <p className={styles.legend}>
              <span>다르게 들림 {legend.differences}</span>
              {legend.unavailable > 0 && (
                <span>비교 못 함 {legend.unavailable}</span>
              )}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              compact
              disabled={takeUnsaved}
              onClick={() => onEntryChange('upload')}
            >
              파일 올리기
            </Button>
            <Button compact onClick={() => onEntryChange('record')}>
              다시 녹음
            </Button>
          </div>
        </div>
      )}
      {state.notice && (
        <p className={styles.notice} role="alert">
          {state.notice}
        </p>
      )}
      {panel === 'result' && state.result ? (
        <ComparisonResultView
          result={state.result}
          playback={state.playback}
          section={selected ?? section}
          listening={listening}
          onMarkRegion={session.markRegion}
        />
      ) : (
        <ComparisonStatusPanel
          session={session}
          canRequest={canRequest}
          uploadLocked={takeUnsaved}
          onRecord={() => onEntryChange('record')}
          onUpload={() => onEntryChange('upload')}
        />
      )}
      {entry === 'upload' && (
        <PerformanceUploadDialog
          sectionName={sectionName}
          sectionSeconds={sectionSeconds}
          probeDuration={probeDuration}
          onSubmit={session.submitTake}
          onClose={() => onEntryChange(null)}
        />
      )}
      {entry === 'record' && (
        <RecordingPanel
          sectionName={sectionName}
          sectionSeconds={sectionSeconds}
          onSubmit={session.submitTake}
          onUploadInstead={() => onEntryChange('upload')}
          onClose={() => onEntryChange(null)}
          onCaptureChange={onCaptureChange}
          onUnsavedChange={reportUnsavedTake}
        />
      )}
    </div>
  )
}
