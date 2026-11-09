import { useId, type ReactNode } from 'react'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { TaskUnavailablePanel } from '../../support/TaskUnavailablePanel.tsx'
import {
  formatTaskRange,
  songInputLabel,
  taskHeadlineStatus,
} from '../format.ts'
import type { TaskDetail } from '../model.ts'
import type { UseTaskDetailResult } from '../useTaskDetail.ts'
import pageStyles from '../WorkspacePage.module.css'
import { LoadingState, ProblemState } from './StateMessage.tsx'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from './TaskWorkspace.module.css'

export function TaskBreadcrumb({
  songName,
  current,
}: {
  songName: string
  current: string
}) {
  return (
    <nav className={styles.breadcrumb} aria-label="작업 위치">
      <ol>
        <li className={styles.truncate}>{songName}</li>
        <li className={styles.truncate} aria-current="page">
          {current}
        </li>
      </ol>
    </nav>
  )
}

function TaskWorkspace({ detail }: { detail: TaskDetail }) {
  const { task, song, previousResults } = detail
  const pendingId = useId()
  const previousId = useId()
  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1>{task.sectionName}</h1>
          <span className={styles.status}>
            <Icon name={taskStatusIcon(task)} />
            {taskHeadlineStatus(task)}
          </span>
        </div>
        <p className={styles.meta}>
          <span className={styles.range}>{formatTaskRange(task)}</span>
          <span>{task.partLabel}</span>
          <span>{task.tuningLabel}</span>
        </p>
        <p className={styles.meta}>
          <span>입력 · {songInputLabel(song.inputKind)}</span>
          <span className={styles.truncate}>{song.fileName}</span>
        </p>
      </header>
      <section className={styles.pending} aria-labelledby={pendingId}>
        <h2 id={pendingId}>작업 화면 준비 중</h2>
        <p>
          파형, 타브, 비교는 다음 단계에서 연결돼요. 내려받기, 녹음, 카피 완료
          표시도 그때 사용할 수 있어요.
        </p>
      </section>
      {/* SEG-04: each kept result names the section it was made from. */}
      {previousResults.length > 0 && (
        <section className={styles.previous} aria-labelledby={previousId}>
          <h2 id={previousId}>이전 결과</h2>
          <p>구간을 바꾸기 전에 만든 결과예요. 최근 것부터 보여요.</p>
          {/* Safari drops the list role when list-style is none. */}
          <ul role="list">
            {previousResults.map((result) => (
              <li key={result.id} className={styles.meta}>
                <span className={styles.previousName}>
                  {result.sectionName}
                </span>
                <span className={styles.range}>{formatTaskRange(result)}</span>
                <span>{result.partLabel}</span>
                <span>{result.tuningLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function showTaskWorkspace(detail: TaskDetail) {
  return <TaskWorkspace detail={detail} />
}

// The loading, missing and failed states of a task. A loaded task shows as
// its workspace unless the view renders it another way.
export function TaskPanel({
  result,
  onRetry,
  onReturnHome,
  renderDetail = showTaskWorkspace,
}: {
  result: UseTaskDetailResult
  onRetry: () => void
  onReturnHome: () => void
  renderDetail?: (detail: TaskDetail) => ReactNode
}) {
  switch (result.status) {
    case 'success':
      return result.detail && renderDetail(result.detail)
    case 'unavailable':
      // Missing and inaccessible tasks share one message by design.
      return (
        <div className={pageStyles.centeredState}>
          <TaskUnavailablePanel onReturnToWorkspace={onReturnHome} />
        </div>
      )
    case 'error':
      return (
        <ProblemState
          title="작업을 열지 못했어요"
          message="잠시 후 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={onRetry}
        />
      )
    case 'expired':
      // WorkspacePage replaces the whole workspace with its expiry notice.
      return null
    default:
      return <LoadingState title="작업을 여는 중이에요" />
  }
}
