import { useEffect, useId, useState, type ReactNode } from 'react'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { PlayerBar } from '../../player/PlayerBar.tsx'
import {
  useSectionPlayer,
  type SectionPlayback,
} from '../../player/useSectionPlayer.ts'
import { TaskUnavailablePanel } from '../../support/TaskUnavailablePanel.tsx'
import {
  formatTaskRange,
  isTaskInProgress,
  songInputLabel,
  taskHeadlineStatus,
} from '../format.ts'
import type { TaskDetail } from '../model.ts'
import { processingPhase, statusAnnouncement } from '../processing.ts'
import { trackLead, trackRange, type TrackId } from '../tracks.ts'
import { useTaskAudio, type TaskAudioSource } from '../useTaskAudio.ts'
import type { CopyStatus } from '../useCopyStatus.ts'
import type { UseTaskDetailResult } from '../useTaskDetail.ts'
import type { TaskTabSource } from '../useTaskTab.ts'
import pageStyles from '../WorkspacePage.module.css'
import { CopyToggle } from './CopyToggle.tsx'
import { ProcessingPanel } from './ProcessingPanel.tsx'
import { LoadingState, ProblemState } from './StateMessage.tsx'
import {
  NoGuitarPanel,
  TaskFailurePanel,
  type TaskRecoveryActions,
} from './TaskFailurePanel.tsx'
import { TaskTab } from './TaskTab.tsx'
import { TaskTracks } from './TaskTracks.tsx'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from './TaskWorkspace.module.css'

// What a task's screen loads: the audio of its tracks and its tab.
export type TaskSource = TaskAudioSource & TaskTabSource

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

// A failed task gets the recovery its failure allows; a finished one shows
// its tab, which loads again whenever the task finishes again or its section
// changes.
function TaskBody({
  detail,
  refreshFailed,
  recovery,
  source,
  player,
  playback,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  recovery: TaskRecoveryActions
  source: TaskTabSource
  player: SectionPlayback
  playback: TrackId
}) {
  const { task } = detail
  if (isTaskInProgress(task))
    return <ProcessingPanel detail={detail} refreshFailed={refreshFailed} />
  if (task.processingStatus === 'failed')
    return task.failureKind === 'no-guitar' ? (
      <NoGuitarPanel detail={detail} {...recovery} />
    ) : (
      <TaskFailurePanel detail={detail} {...recovery} />
    )
  // The tab is made from these. A section changed elsewhere, as from another
  // browser tab, can finish again before this screen sees it processing.
  const madeFrom = [
    task.id,
    task.part,
    task.tuningId,
    task.rangeStartSeconds,
    task.rangeEndSeconds,
  ].join(':')
  return (
    <TaskTab
      key={madeFrom}
      taskId={task.id}
      source={source}
      player={player}
      lead={trackLead(playback, task)}
    />
  )
}

function TaskWorkspace({
  detail,
  refreshFailed,
  source,
  recovery,
  copy,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  source: TaskSource
  recovery: TaskRecoveryActions
  copy: CopyStatus
}) {
  const { task, song, previousResults } = detail
  const previousId = useId()
  const announcement = useStatusAnnouncement(detail)
  const taskAudio = useTaskAudio(detail, source)
  const { tracks, playback, choices, onPlayingChange } = taskAudio
  const playbackState = taskAudio.audio[playback]?.state
  // One player for the task: switching tracks plays on from the same time.
  const player = useSectionPlayer(
    playbackState?.status === 'ready' ? playbackState.buffer : null,
    trackRange(playback, task),
  )
  useEffect(() => {
    onPlayingChange(player.playing)
  }, [onPlayingChange, player.playing])
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
        <header className={`${styles.header} ${styles.taskHeader}`}>
          <div className={styles.heading}>
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
          </div>
          {task.processingStatus === 'completed' && (
            <CopyToggle task={task} copy={copy} />
          )}
        </header>
        <TaskTracks task={task} {...taskAudio} player={player} />
        <TaskBody
          detail={detail}
          refreshFailed={refreshFailed}
          recovery={recovery}
          source={source}
          player={player}
          playback={playback}
        />
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
        playback={player}
        source={
          choices.length > 0
            ? { options: choices, value: playback, onChange: taskAudio.choose }
            : tracks.find((track) => track.id === playback)?.label
        }
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
  | {
      renderDetail: (detail: TaskDetail) => ReactNode
      source?: never
      recovery?: never
      copy?: never
    }
  | {
      source: TaskSource
      recovery: TaskRecoveryActions
      copy: CopyStatus
      renderDetail?: never
    }
)

export function TaskPanel({
  result,
  onRetry,
  onReturnHome,
  renderDetail,
  source,
  recovery,
  copy,
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
          source={source}
          recovery={recovery}
          copy={copy}
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
