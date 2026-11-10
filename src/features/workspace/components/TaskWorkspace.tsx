import { useId, useState, type ReactNode } from 'react'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { PlayerBar } from '../../player/PlayerBar.tsx'
import { TaskUnavailablePanel } from '../../support/TaskUnavailablePanel.tsx'
import {
  formatTaskRange,
  isTaskInProgress,
  songInputLabel,
  taskHeadlineStatus,
} from '../format.ts'
import type { TaskDetail } from '../model.ts'
import { processingPhase, statusAnnouncement } from '../processing.ts'
import { trackRange } from '../tracks.ts'
import { useTaskAudio, type TaskAudioSource } from '../useTaskAudio.ts'
import type { UseTaskDetailResult } from '../useTaskDetail.ts'
import pageStyles from '../WorkspacePage.module.css'
import { ProcessingPanel } from './ProcessingPanel.tsx'
import { LoadingState, ProblemState } from './StateMessage.tsx'
import { TaskTracks } from './TaskTracks.tsx'
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

// What changed since the task opened, read once per change of status or
// running stage. Progress alone is not read out.
function useStatusAnnouncement({ task, stages }: TaskDetail): string {
  const phase = processingPhase(task, stages)
  const [announced, setAnnounced] = useState({ phase, message: '' })
  if (announced.phase !== phase)
    setAnnounced({ phase, message: statusAnnouncement(task, stages) })
  return announced.message
}

function TaskWorkspace({
  detail,
  refreshFailed,
  audioSource,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  audioSource: TaskAudioSource
}) {
  const { task, song, previousResults } = detail
  const pendingId = useId()
  const previousId = useId()
  const announcement = useStatusAnnouncement(detail)
  const taskAudio = useTaskAudio(detail, audioSource)
  const { playback } = taskAudio
  const playbackState = taskAudio.audio[playback]?.state
  return (
    <div className={styles.workspace}>
      <div className={styles.content}>
        {/* The processing panel has a status of its own; this one is named so
          the two are never mixed up. */}
        <p
          className={pageStyles.srOnly}
          role="status"
          data-announcer="task-status"
        >
          {announcement}
        </p>
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
        <TaskTracks task={task} {...taskAudio} />
        {isTaskInProgress(task) ? (
          <ProcessingPanel detail={detail} refreshFailed={refreshFailed} />
        ) : (
          <section className={styles.pending} aria-labelledby={pendingId}>
            <h2 id={pendingId}>작업 화면 준비 중</h2>
            <p>
              타브와 비교는 다음 단계에서 연결돼요. 내려받기, 녹음, 카피 완료
              표시도 그때 사용할 수 있어요.
            </p>
          </section>
        )}
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
                  <span className={styles.range}>
                    {formatTaskRange(result)}
                  </span>
                  <span>{result.partLabel}</span>
                  <span>{result.tuningLabel}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <PlayerBar
        buffer={playbackState?.status === 'ready' ? playbackState.buffer : null}
        range={trackRange(playback, task)}
        source={taskAudio.tracks.find((track) => track.id === playback)?.label}
        onPlayingChange={taskAudio.onPlayingChange}
      />
    </div>
  )
}

// The loading, missing and failed states of a task. A loaded task shows as
// its workspace unless the view renders it another way.
type TaskPanelProps = {
  result: UseTaskDetailResult
  onRetry: () => void
  onReturnHome: () => void
} & (
  | { renderDetail: (detail: TaskDetail) => ReactNode; audioSource?: never }
  | { audioSource: TaskAudioSource; renderDetail?: never }
)

export function TaskPanel({
  result,
  onRetry,
  onReturnHome,
  renderDetail,
  audioSource,
}: TaskPanelProps) {
  switch (result.status) {
    case 'success':
      if (!result.detail) return null
      if (renderDetail) return renderDetail(result.detail)
      // Another task starts with nothing announced and nothing playing.
      return (
        <TaskWorkspace
          key={result.detail.task.id}
          detail={result.detail}
          refreshFailed={result.refreshFailed}
          audioSource={audioSource}
        />
      )
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
