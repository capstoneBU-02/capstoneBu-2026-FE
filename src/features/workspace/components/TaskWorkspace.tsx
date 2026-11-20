import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { MediaDurationProbe } from '../../add-song/mediaDuration.ts'
import type { ComparisonRepository } from '../../comparison/repository.ts'
import {
  TaskComparison,
  type TakeEntry,
} from '../../comparison/TaskComparison.tsx'
import {
  taskViewPanelId,
  taskViewTabId,
  type TaskView,
} from '../../comparison/taskView.ts'
import { TaskViewTabs } from '../../comparison/TaskViewTabs.tsx'
import { useComparisonPlayer } from '../../comparison/useComparisonPlayer.ts'
import { useComparisonSession } from '../../comparison/useComparisonSession.ts'
import { PlayerBar } from '../../player/PlayerBar.tsx'
import {
  useSectionPlayer,
  type SectionPlayback,
} from '../../player/useSectionPlayer.ts'
import type { TakeClock } from '../../recording/useRecorder.ts'
import { TaskUnavailablePanel } from '../../support/TaskUnavailablePanel.tsx'
import type { TabSource } from '../../tab/TabPanel.tsx'
import {
  formatTaskRange,
  isTaskInProgress,
  songInputLabel,
  taskHeadlineStatus,
} from '../format.ts'
import type { TaskDetail } from '../model.ts'
import {
  failedStage,
  processingPhase,
  statusAnnouncement,
} from '../processing.ts'
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
  takeFocus,
  dropFocus,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  recovery: TaskRecoveryActions
  tab: TabSource
  svgRef: Ref<SVGSVGElement>
  player: SectionPlayback
  playback: TrackId
  takeFocus: () => boolean
  dropFocus: () => void
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
      takeFocus={takeFocus}
      dropFocus={dropFocus}
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
  comparison,
  probeDuration,
  onUnsavedTakeChange,
}: {
  detail: TaskDetail
  refreshFailed: boolean
  source: TaskSource
  recovery: TaskRecoveryActions
  copy: CopyStatus
  actions: HTMLElement | null
  comparison: ComparisonRepository | null
  probeDuration: MediaDurationProbe | undefined
  onUnsavedTakeChange: ((unsaved: boolean) => void) | undefined
}) {
  const { task, song, previousResults } = detail
  const previousId = useId()
  const viewsId = useId()
  // Only a finished task has a section to play against.
  const comparable =
    comparison !== null &&
    probeDuration !== undefined &&
    task.processingStatus === 'completed'
  const session = useComparisonSession({
    repository: comparable ? comparison : null,
    taskId: comparable ? task.id : null,
    sectionName: task.sectionName,
    onExpired: source.onExpired,
  })
  const [chosenView, setChosenView] = useState<TaskView>('tab')
  const view = comparable ? chosenView : 'tab'
  const [takeEntry, setTakeEntry] = useState<TakeEntry | null>(null)
  // The recording panel stays on screen over 타브, but the upload opens in 비교.
  function enterTake(entry: TakeEntry | null) {
    if (entry !== null) setChosenView('comparison')
    setTakeEntry(entry)
  }
  // A take keeps the section it was played on, even after the section moves.
  const takeSection = session.selected ?? task
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
  const listening = useComparisonPlayer({
    repository: comparable ? comparison : null,
    result: session.panel === 'result' ? session.state.result : null,
    playback: session.state.playback,
    performanceSeconds: session.selected?.durationSeconds ?? null,
    sectionSeconds: takeSection.rangeEndSeconds - takeSection.rangeStartSeconds,
    visible: view === 'comparison',
    onExpired: source.onExpired,
  })
  // The bar plays the comparison while its result is on screen.
  // A take being recorded keeps the section playing along with it.
  const [capturing, setCapturing] = useState(false)
  // A take begun before the section's audio loaded, waiting for it.
  const takeWaiting = useRef<TakeClock | null>(null)
  const listeningNow = view === 'comparison' && listening.active && !capturing
  const pauseHidden = useEffectEvent(() => {
    if (capturing) return
    if (listeningNow) player.pause()
    else listening.playback.pause()
  })
  useEffect(() => {
    pauseHidden()
  }, [listeningNow])
  function playAlong(take: TakeClock | null) {
    setCapturing(take !== null)
    listening.playback.pause()
    takeWaiting.current = take && !player.available ? take : null
    if (take) player.playOnce()
    else player.pause()
  }
  // Audio that loads during the take joins at the time already recorded, so
  // the two stay together. A take already past the section stays on its own.
  const joinTake = useEffectEvent(() => {
    const take = takeWaiting.current
    takeWaiting.current = null
    if (!take) return
    const recorded = take.elapsedSeconds()
    if (recorded < player.length) player.playOnce(recorded)
  })
  useEffect(() => {
    if (player.available) joinTake()
  }, [player.available])
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
                {taskHeadlineStatus(task, failedStage(detail.stages))}
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
        {listeningNow
          ? listening.failure && <PlaybackFailure {...listening.failure} />
          : playbackFailed && (
              <PlaybackFailure
                label={playbackTrack.label}
                audio={playbackAudio}
              />
            )}
        {comparable && (
          <TaskViewTabs
            baseId={viewsId}
            value={view}
            comparedCount={session.comparedCount}
            onChange={setChosenView}
          />
        )}
        {comparable && (
          <div
            id={taskViewPanelId(viewsId, 'comparison')}
            role="tabpanel"
            aria-labelledby={taskViewTabId(viewsId, 'comparison')}
            hidden={view !== 'comparison'}
          >
            <TaskComparison
              session={session}
              listening={listening}
              section={task}
              sectionName={task.sectionName}
              probeDuration={probeDuration}
              entry={takeEntry}
              onEntryChange={enterTake}
              onCaptureChange={playAlong}
              onUnsavedTakeChange={onUnsavedTakeChange}
            />
          </div>
        )}
        {/* The tab stays drawn behind 비교, so 내려받기 keeps working. */}
        <div
          id={comparable ? taskViewPanelId(viewsId, 'tab') : undefined}
          role={comparable ? 'tabpanel' : undefined}
          aria-labelledby={
            comparable ? taskViewTabId(viewsId, 'tab') : undefined
          }
          hidden={view !== 'tab'}
        >
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
            takeFocus={download.takeFocus}
            dropFocus={download.dropFocus}
          />
          {/* SEG-04: each kept result names the section it was made from. */}
          {previousResults.length > 0 && (
            <section className={styles.previous} aria-labelledby={previousId}>
              <h2 id={previousId}>이전 결과</h2>
              <p>구간을 바꾸기 전에 만든 결과예요. 최근 것부터 보여요.</p>
              {/* Safari drops the list role when list-style is none. */}
              <ul role="list">
                {previousResults.map((result, index) => (
                  <li key={result.id} className={styles.meta}>
                    <span>결과 {previousResults.length - index}</span>
                    <span className={styles.previousName}>
                      {result.sectionName}
                    </span>
                    <span className={styles.range}>
                      {formatTaskRange(result)}
                    </span>
                    <span>{result.partLabel}</span>
                    <span>{result.tuningLabel}</span>
                    <span>비교 {result.comparisonCount}회</span>
                    <span>
                      {result.copyStatus === 'confirmed'
                        ? '카피 완료'
                        : result.copyStatus === 'needs-review'
                          ? '확인 필요'
                          : '카피 미확인'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <PlayerBar
        playback={listeningNow ? listening.playback : player}
        source={
          listeningNow
            ? listening.source
            : choices.length > 0
              ? {
                  options: choices,
                  value: playback,
                  onChange: taskAudio.choose,
                }
              : playbackTrack?.label
        }
        notice={
          drawn &&
          download.failure && <TabDownloadFailure download={download} />
        }
      />
      {/* 내려받기 and 녹음 sit in the page's top bar, beside 구간 수정. */}
      {actions &&
        createPortal(
          <>
            {task.processingStatus === 'completed' && (
              <div className={styles.downloadSlot}>
                <Button
                  compact
                  disabled
                  aria-hidden="true"
                  tabIndex={-1}
                  className={styles.downloadPlaceholder}
                >
                  <Icon name="download" />
                  내려받는 중…
                </Button>
                {drawn && <TabDownloadMenu download={download} />}
              </div>
            )}
            {comparable && (
              <Button
                variant="primary"
                compact
                onClick={() => enterTake('record')}
              >
                녹음
              </Button>
            )}
          </>,
          actions,
        )}
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
      comparison?: never
      probeDuration?: never
      onUnsavedTakeChange?: never
    }
  | {
      source: TaskSource
      recovery: TaskRecoveryActions
      copy: CopyStatus
      // Where the top bar keeps the task's actions, for 내려받기.
      actions: HTMLElement | null
      // Without a repository a finished task shows its tab alone.
      comparison?: ComparisonRepository | null
      probeDuration?: MediaDurationProbe
      onUnsavedTakeChange?: (unsaved: boolean) => void
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
  comparison = null,
  probeDuration,
  onUnsavedTakeChange,
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
          comparison={comparison}
          probeDuration={probeDuration}
          onUnsavedTakeChange={onUnsavedTakeChange}
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
