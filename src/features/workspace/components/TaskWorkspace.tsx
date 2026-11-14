import { useEffect, useId, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { PlayerBar } from '../../player/PlayerBar.tsx'
import {
  useSectionPlayer,
  type SectionPlayback,
} from '../../player/useSectionPlayer.ts'
import { TaskUnavailablePanel } from '../../support/TaskUnavailablePanel.tsx'
import type { TabSource } from '../../tab/TabPanel.tsx'
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
import { useTabDownload } from '../useTabDownload.ts'
import type { UseTaskDetailResult } from '../useTaskDetail.ts'
import { tabMadeFrom, useTaskTab, type TaskTabSource } from '../useTaskTab.ts'
import pageStyles from '../WorkspacePage.module.css'
import { CopyToggle } from './CopyToggle.tsx'
import { PlaybackFailure } from './PlaybackFailure.tsx'
import { ProcessingPanel } from './ProcessingPanel.tsx'
import { LoadingState, ProblemState } from './StateMessage.tsx'
import { TabDownloadFailure, TabDownloadMenu } from './TabDownload.tsx'
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
  tab,
  svgRef,
  player,
  playback,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  recovery: TaskRecoveryActions
  tab: TabSource
  svgRef: Ref<SVGSVGElement>
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
  return (
    <TaskTab
      key={tabMadeFrom(task)}
      tab={tab}
      svgRef={svgRef}
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
  actions,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  source: TaskSource
  recovery: TaskRecoveryActions
  copy: CopyStatus
  actions: HTMLElement | null
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
  const tab = useTaskTab(task, source)
  // The tab drawn on screen. Its drawing code loads on its own and can fail,
  // so a loaded tab is not yet one to download.
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const drawn = tab.status === 'ready' && svg !== null
  const download = useTabDownload({
    tab,
    svg,
    songName: song.name,
    sectionName: task.sectionName,
    // A tab that loads again, even the same one, starts with no failure.
    key: drawn ? tabMadeFrom(task) : '',
  })
  const playbackAudio = taskAudio.audio[playback]
  const playbackTrack = tracks.find((track) => track.id === playback)
  // Only a finished task has a tab to fall back on.
  const playbackFailed =
    task.processingStatus === 'completed' &&
    playbackAudio != null &&
    playbackTrack !== undefined &&
    (playbackAudio.state.status === 'failed' || playbackAudio.retrying)
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
        {playbackFailed && (
          <PlaybackFailure label={playbackTrack.label} audio={playbackAudio} />
        )}
        <TaskTracks
          task={task}
          {...taskAudio}
          player={player}
          bannerTrack={playbackFailed ? playback : null}
        />
        <TaskBody
          detail={detail}
          refreshFailed={refreshFailed}
          recovery={recovery}
          tab={tab}
          svgRef={setSvg}
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
            : playbackTrack?.label
        }
        notice={
          drawn &&
          download.failure && <TabDownloadFailure download={download} />
        }
      />
      {/* 내려받기 sits in the page's top bar, beside 구간 수정. */}
      {drawn &&
        actions &&
        createPortal(<TabDownloadMenu download={download} />, actions)}
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
      actions?: never
    }
  | {
      source: TaskSource
      recovery: TaskRecoveryActions
      copy: CopyStatus
      // Where the top bar keeps the task's actions, for 내려받기.
      actions: HTMLElement | null
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
  actions,
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
          actions={actions}
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
