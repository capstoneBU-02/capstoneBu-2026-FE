import { useEffect, useId, useRef } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { formatTime } from '../workspace/format.ts'
import {
  comparisonFailureCopy,
  comparisonProgressLabel,
  notComparableCopy,
} from './comparisonCopy.ts'
import type { SessionPanel } from './comparisonSession.ts'
import styles from './ComparisonStatusPanel.module.css'
import type { SavedPerformance } from './model.ts'
import type { ComparisonSession } from './useComparisonSession.ts'

export interface ComparisonStatusPanelProps {
  readonly session: ComparisonSession
  // False for a take from an earlier section, which cannot be compared.
  readonly canRequest: boolean
  // True while a take on screen would be lost to an upload.
  readonly uploadLocked: boolean
  readonly onRecord: () => void
  readonly onUpload: () => void
}

type StatusPanel = Exclude<SessionPanel, 'result'>

interface PanelMessage {
  readonly title: string
  readonly description: string | null
  readonly detail?: string | null
}

interface PanelAction {
  readonly label: string
  readonly icon?: 'refresh'
  readonly run: () => void
  // Answered through session.state.pending, so it must not be sent twice.
  readonly sendsRequest: boolean
}

const TRY_LATER = '잠시 후 다시 시도해 주세요.'
const LOADING_RESULT: PanelMessage = {
  title: '비교 결과를 불러오고 있어요',
  description: null,
}

// Only a take cut short is explained by its length (Figma 33:130).
function lengthDetail(
  selected: SavedPerformance | null,
  reason: string | null,
): string | null {
  if (reason !== 'RERECORD_TOO_SHORT' || selected?.durationSeconds == null)
    return null
  const sectionSeconds = selected.rangeEndSeconds - selected.rangeStartSeconds
  return `연주 ${formatTime(selected.durationSeconds)} · 구간 ${formatTime(sectionSeconds)}`
}

function panelMessage(
  panel: StatusPanel,
  session: ComparisonSession,
  canRequest: boolean,
): PanelMessage {
  const { status, result } = session.state
  switch (panel) {
    case 'loading':
      return { title: '연주 기록을 불러오고 있어요', description: null }
    case 'list-failed':
      return { title: '연주 기록을 불러오지 못했어요', description: TRY_LATER }
    case 'empty':
      return {
        title: '아직 비교한 연주가 없어요',
        description: '이 구간을 녹음하거나 연주 파일을 올려 비교해 보세요.',
      }
    case 'not-requested':
      return canRequest
        ? {
            title: '아직 비교하지 않은 연주예요',
            description: '비교하면 다르게 들리는 곳을 찾아 볼 수 있어요.',
          }
        : {
            title: '이전 구간의 연주예요',
            description:
              '구간이 바뀌기 전에 저장한 연주라 비교할 수 없어요. 다시 녹음하거나 다른 파일을 올려 주세요.',
          }
    case 'running':
      return {
        title: '비교하는 중',
        description: status && comparisonProgressLabel(status),
      }
    case 'failed':
      return comparisonFailureCopy(status?.failure ?? null)
    case 'not-comparable':
      if (result === null) return LOADING_RESULT
      return {
        ...notComparableCopy(result.notComparableReason, result.baseline),
        detail: lengthDetail(session.selected, result.notComparableReason),
      }
    case 'loading-result':
      return LOADING_RESULT
    case 'result-failed':
      return { title: '비교 결과를 불러오지 못했어요', description: TRY_LATER }
  }
}

function panelAction(
  panel: StatusPanel,
  session: ComparisonSession,
  canRequest: boolean,
): PanelAction | null {
  const retry = { label: '다시 시도', icon: 'refresh' } as const
  switch (panel) {
    case 'list-failed':
      return { ...retry, run: session.reloadList, sendsRequest: false }
    case 'result-failed':
      return { ...retry, run: session.reloadResult, sendsRequest: false }
    case 'failed':
      return comparisonFailureCopy(session.state.status?.failure ?? null)
        .canRetry
        ? { ...retry, run: session.retry, sendsRequest: true }
        : null
    case 'not-requested':
      return canRequest
        ? {
            label: '비교하기',
            run: session.requestSelected,
            sendsRequest: true,
          }
        : null
    default:
      return null
  }
}

// What became of the open take's comparison, whenever there is no result to
// show. The result itself belongs to the parent.
export function ComparisonStatusPanel({
  session,
  canRequest,
  uploadLocked,
  onRecord,
  onUpload,
}: ComparisonStatusPanelProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const acted = useRef(false)
  const { panel } = session

  // The pressed button leaves with its panel, which would drop the keyboard
  // back to the top of the page.
  useEffect(() => {
    if (!acted.current) return
    acted.current = false
    if (document.activeElement === document.body) panelRef.current?.focus()
  }, [panel])

  if (panel === 'result') return null

  const { title, description, detail } = panelMessage(
    panel,
    session,
    canRequest,
  )
  const action = panelAction(panel, session, canRequest)
  const blocked =
    action?.sendsRequest === true && session.state.pending !== null

  function runAction() {
    if (action === null || blocked) return
    acted.current = true
    action.run()
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      {/* Stays mounted across panels, so every change of state is read out. */}
      <div role="status">
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {description && <p className={styles.description}>{description}</p>}
        {detail && <p className={styles.detail}>{detail}</p>}
      </div>
      {panel === 'empty' && (
        <div className={styles.actions}>
          <Button variant="primary" compact onClick={onRecord}>
            녹음하기
          </Button>
          <Button compact disabled={uploadLocked} onClick={onUpload}>
            파일 올리기
          </Button>
        </div>
      )}
      {action && (
        <div className={styles.actions}>
          {/* aria-disabled keeps focus here if the request is refused. */}
          <Button
            variant="primary"
            compact
            className={styles.action}
            aria-disabled={blocked}
            onClick={runAction}
          >
            {action.icon && <Icon name={action.icon} />}
            {action.label}
          </Button>
        </div>
      )}
    </section>
  )
}
