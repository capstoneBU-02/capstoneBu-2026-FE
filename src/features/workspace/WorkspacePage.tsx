import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { AddSongDialog } from '../add-song/AddSongDialog.tsx'
import {
  createMediaDurationProbe,
  type MediaDurationProbe,
} from '../add-song/mediaDuration.ts'
import { UPLOAD_POLICY } from '../add-song/uploadPolicy.ts'
import { EditSectionScreen } from '../edit-section/EditSectionScreen.tsx'
import {
  canReviseSection,
  otherFileSectionForm,
  sectionEditKind,
  sectionEditUnavailableText,
} from '../edit-section/sectionEdit.ts'
import { NewSectionScreen } from '../new-section/NewSectionScreen.tsx'
import { ReplaceFileDialog } from '../new-section/ReplaceFileDialog.tsx'
import type { SectionForm } from '../new-section/sectionForm.ts'
import { useSectionDrafts } from '../new-section/useSectionDrafts.ts'
import { ConsentDialog } from './components/ConsentDialog.tsx'
import { EmptyWorkspace } from './components/EmptyWorkspace.tsx'
import { LoadingState, ProblemState } from './components/StateMessage.tsx'
import {
  StopNotice,
  StopTaskControl,
  type StopNoticeContent,
} from './components/StopTask.tsx'
import { TaskTable } from './components/TaskTable.tsx'
import { TaskBreadcrumb, TaskPanel } from './components/TaskWorkspace.tsx'
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx'
import { isTaskInProgress } from './format.ts'
import type { SongInputKind, WorkspaceTask } from './model.ts'
import type { WorkspaceRepository } from './repository.ts'
import { useCopyStatus } from './useCopyStatus.ts'
import { useListRefresh } from './useListRefresh.ts'
import { useTaskDetail } from './useTaskDetail.ts'
import { useTaskRecovery } from './useTaskRecovery.ts'
import type { UseWorkspaceResult } from './useWorkspace.ts'
import styles from './WorkspacePage.module.css'
import { SettingsPanel } from '../settings/SettingsPanel.tsx'
import { SupportDialog, type SupportTopic } from '../support/SupportDialog.tsx'
import { TaskUnavailablePanel } from '../support/TaskUnavailablePanel.tsx'
import {
  maskTesterCode,
  workspaceViewKey,
  type WorkspaceView,
} from './navigation.ts'
import { useWorkspaceNavigation } from './useWorkspaceNavigation.ts'
import './consent-feedback.css'

type Filter = 'all' | 'processing' | 'failed'

const TOP_BAR_LABELS: Record<WorkspaceView['name'], string> = {
  home: '내 작업',
  settings: '설정',
  task: '작업 공간',
  'task-not-found': '작업 공간',
  'task-inaccessible': '작업 공간',
  'new-section': '새 구간',
  'song-not-found': '새 구간',
  'edit-section': '구간 수정',
}

const defaultDurationProbe = createMediaDurationProbe(
  UPLOAD_POLICY.metadataTimeoutMs,
)
// Set for the mock's pace; to be revisited with the server's status contract.
const REFRESH_MS = 3_000

interface AddSongRequest {
  readonly workspaceId: string
  readonly files: readonly File[]
  readonly title?: string
  // Set when 파일 바꾸기 adds a replacement for this song's draft.
  readonly replacesSongId?: string
  readonly inputKind?: SongInputKind
  // The new song's first draft, set by 다른 파일 올리기.
  readonly draft?: SectionForm
}

interface ReplaceFileRequest {
  readonly workspaceId: string
  readonly songId: string
}

function hasDraggedFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

export function WorkspacePage({
  workspace,
  repository,
  onReenter,
  onLeave,
  focusOnEntry = false,
  probeDuration = defaultDurationProbe,
  refreshMs = REFRESH_MS,
}: {
  workspace: UseWorkspaceResult
  repository: WorkspaceRepository
  onReenter?: () => void
  onLeave?: () => void
  focusOnEntry?: boolean
  probeDuration?: MediaDurationProbe
  // How often the open task and the list are loaded again while a task is
  // queued or processing; null keeps the first loads only.
  refreshMs?: number | null
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const { view, navigate, leave } = useWorkspaceNavigation()
  const [consentWorkspaceId, setConsentWorkspaceId] = useState<string | null>(
    null,
  )
  const viewKey = workspaceViewKey(view)
  // The task and its 구간 수정 share one request, so the button and the
  // editor see the same copy of the task.
  // Only the task view follows the task while it runs; 구간 수정 keeps the
  // copy it opened with.
  const taskDetail = useTaskDetail(
    repository,
    view.name === 'task' || view.name === 'edit-section' ? view.taskId : null,
    {
      onExpired: workspace.markExpired,
      onLoaded: ({ task }) => workspace.syncTask(task),
      refreshMs: view.name === 'task' ? refreshMs : null,
      listedTask:
        view.name === 'task'
          ? (workspace.tasks.find((task) => task.id === view.taskId) ?? null)
          : null,
    },
  )
  useListRefresh(workspace, refreshMs)
  // Saves outlive the task screen, so the list and a reopened task show them.
  const copy = useCopyStatus(repository, {
    expired: workspace.loadState === 'expired',
    onSaved: (task) => {
      workspace.syncTask(task)
      taskDetail.replaceTask(task)
    },
    onExpired: workspace.markExpired,
  })
  const [previousViewKey, setPreviousViewKey] = useState(viewKey)
  // Set when a created task opens: a dialog the user opened while it was
  // being created stays open over the task instead of closing.
  const [keepDialogsViewKey, setKeepDialogsViewKey] = useState<string | null>(
    null,
  )
  const [support, setSupport] = useState<{
    topic: SupportTopic
    workspaceId: string
  } | null>(null)
  const supportReturnFocusRef = useRef<HTMLElement | null>(null)
  const [addSong, setAddSong] = useState<AddSongRequest | null>(null)
  const addSongReturnFocusRef = useRef<HTMLElement | null>(null)
  const [replaceFile, setReplaceFile] = useState<ReplaceFileRequest | null>(
    null,
  )
  const mainContentRef = useRef<HTMLElement>(null)
  // Shown on the list after 멈추기 took the user off the stopped task, or on
  // a task that finished before it could be stopped.
  const [stopNotice, setStopNotice] = useState<
    (StopNoticeContent & { workspaceId: string; viewKey: string }) | null
  >(null)
  const { songs, tasks, loadState } = workspace
  const workspaceId = workspace.workspace?.id ?? null
  const previousFocusViewKey = useRef(viewKey)
  const workspaceReady = loadState === 'empty' || loadState === 'success'
  const drafts = useSectionDrafts(
    workspaceId,
    view.name === 'new-section' ? view.songId : null,
  )
  const recovery = useTaskRecovery({
    workspace,
    taskDetail,
    openTaskId: view.name === 'task' ? view.taskId : null,
    onStopped: (task) => {
      if (workspaceId)
        setStopNotice({
          workspaceId,
          viewKey: workspaceViewKey({ name: 'home' }),
          message: `${task.sectionName} 작업을 멈췄어요.`,
          icon: 'checkDone',
        })
      // The stopped task is gone, so Back does not return to it. Focus moves
      // to the list once the dialog has closed and the view has changed.
      leave({ name: 'home' })
    },
    onRetried: focusContent,
  })

  // Transfer focus from the removed access/onboarding screen only on entry.
  // Loading, filtering and consent updates must preserve the user's focus.
  useEffect(() => {
    if (focusOnEntry || previousFocusViewKey.current !== viewKey)
      mainContentRef.current?.focus({ preventScroll: true })
    previousFocusViewKey.current = viewKey
  }, [focusOnEntry, viewKey])

  // Expiry removes the screen the user was on, as 새 구간 after Enter in a
  // disabled field; focus left on the page moves to the content.
  useEffect(() => {
    if (loadState !== 'expired') return
    const active = document.activeElement
    if (active === null || active === document.body)
      mainContentRef.current?.focus({ preventScroll: true })
  }, [loadState])

  // Sessions live in memory, so a file dropped outside a drop area must not
  // make the browser open it and leave the app. A drop area answers its own
  // drags; anywhere else the cursor shows that the file is not taken.
  useEffect(() => {
    const refuseDrag = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return
      if (!event.defaultPrevented && event.dataTransfer)
        event.dataTransfer.dropEffect = 'none'
      event.preventDefault()
    }
    const keepPage = (event: DragEvent) => {
      if (hasDraggedFiles(event)) event.preventDefault()
    }
    window.addEventListener('dragover', refuseDrag)
    window.addEventListener('drop', keepPage)
    return () => {
      window.removeEventListener('dragover', refuseDrag)
      window.removeEventListener('drop', keepPage)
    }
  }, [])

  if (previousViewKey !== viewKey) {
    setPreviousViewKey(viewKey)
    setKeepDialogsViewKey(null)
    if (keepDialogsViewKey !== viewKey) {
      setConsentWorkspaceId(null)
      setSupport(null)
      setAddSong(null)
    }
    setReplaceFile(null)
    if (stopNotice?.viewKey !== viewKey) setStopNotice(null)
  }
  if (stopNotice && stopNotice.workspaceId !== workspaceId) setStopNotice(null)
  if (support && support.workspaceId !== workspaceId) setSupport(null)
  if (addSong && (addSong.workspaceId !== workspaceId || !workspaceReady))
    setAddSong(null)
  if (
    replaceFile &&
    (replaceFile.workspaceId !== workspaceId || !workspaceReady)
  )
    setReplaceFile(null)

  // Reset the dialog's lifetime when its workspace disappears or changes.
  if (consentWorkspaceId !== null && consentWorkspaceId !== workspaceId) {
    setConsentWorkspaceId(null)
  }

  function openConsent() {
    // A request can fail after a view change or native dialog close. Keep that
    // result until the user retries or dismisses the dialog after seeing it.
    setConsentWorkspaceId(workspaceId)
  }

  function closeConsent() {
    setConsentWorkspaceId(null)
    workspace.clearConsentError()
  }
  function openSupport(topic: SupportTopic, returnFocus?: HTMLElement | null) {
    if (!workspaceId) return
    supportReturnFocusRef.current =
      returnFocus === undefined
        ? document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
        : returnFocus
    setSupport({ topic, workspaceId })
  }
  function openAddSong(
    returnFocus: HTMLElement | null,
    files: readonly File[] = [],
  ) {
    if (!workspaceId || !workspaceReady) return
    addSongReturnFocusRef.current = returnFocus
    setAddSong({ workspaceId, files })
  }
  function confirmReplaceFile() {
    if (!replaceFile) return
    // Focus returns to 파일 바꾸기 if the user cancels the file choice.
    setAddSong({
      workspaceId: replaceFile.workspaceId,
      files: [],
      title: '파일 바꾸기',
      replacesSongId: replaceFile.songId,
      inputKind: songs.find((song) => song.id === replaceFile.songId)
        ?.inputKind,
    })
    setReplaceFile(null)
  }
  // A song without guitar leaves its task in the list. The new song starts
  // with the section's name and tuning; its kind is the dialog's default,
  // so a separated guitar file can be chosen there.
  function uploadOtherFile(
    task: WorkspaceTask,
    returnFocus: HTMLElement | null,
  ) {
    if (!workspaceId || !workspaceReady) return
    addSongReturnFocusRef.current = returnFocus
    setAddSong({
      workspaceId,
      files: [],
      title: '다른 파일 올리기',
      draft: otherFileSectionForm(task),
    })
  }
  function focusContent() {
    mainContentRef.current?.focus({ preventScroll: true })
  }
  function go(next: WorkspaceView) {
    navigate(next)
    focusContent()
  }
  // A retry button disappears with its error, so keep focus in the content.
  function retryWith(retry: () => void) {
    return () => {
      retry()
      focusContent()
    }
  }
  // The open task may have failed with the list, so it loads again too.
  function retryWorkspace() {
    workspace.retryLoad()
    taskDetail.retry()
  }
  const goHome = () => go({ name: 'home' })
  const openTask = (taskId: string) => go({ name: 'task', taskId })
  // A dialog the user opened while the task was being saved stays open over
  // the task instead of closing.
  const openSavedTask = (taskId: string) => {
    const taskView = { name: 'task', taskId } as const
    setKeepDialogsViewKey(workspaceViewKey(taskView))
    go(taskView)
  }
  // 구간 수정 closes back to its task, and Back then skips the editor.
  const leaveEdit = (taskId: string) => {
    leave({ name: 'task', taskId })
    focusContent()
  }
  const finishEdit = (taskId: string) => {
    // The task view shares the editor's request; load the queued task again.
    taskDetail.retry()
    setKeepDialogsViewKey(workspaceViewKey({ name: 'task', taskId }))
    leaveEdit(taskId)
  }
  const newSectionSong =
    view.name === 'new-section'
      ? (songs.find((song) => song.id === view.songId) ?? null)
      : null
  const visibleTasks = tasks.filter((task) =>
    filter === 'all'
      ? true
      : filter === 'processing'
        ? isTaskInProgress(task)
        : task.processingStatus === filter,
  )
  const newSection = workspaceReady ? newSectionSong : null
  const detail = workspaceReady ? taskDetail.detail : null
  const editKind =
    view.name === 'edit-section' && detail ? sectionEditKind(detail.task) : null
  const editSection = editKind ? detail : null
  const shownTask = view.name === 'task' ? detail?.task : undefined
  // The dialog stays while its request runs, even if the task finishes.
  const stoppable = Boolean(
    shownTask &&
    (isTaskInProgress(shownTask) || recovery.stoppingTaskId === shownTask.id),
  )
  // The section screens render their own bar with their actions.
  const ownTopBar = Boolean(newSection || editSection)
  const consentFeedback = workspaceId &&
    consentWorkspaceId !== workspaceId &&
    workspace.consent.errorMessage && (
      <div className="consent-feedback">
        <p role="alert">AI 학습 활용: {workspace.consent.errorMessage}</p>
        <Button compact onClick={openConsent}>
          AI 학습 활용 다시 선택
        </Button>
      </div>
    )
  const filters = [
    { value: 'all', label: '전체', count: tasks.length },
    {
      value: 'processing',
      label: '진행 중',
      count: tasks.filter(isTaskInProgress).length,
    },
    {
      value: 'failed',
      label: '실패',
      count: tasks.filter((task) => task.processingStatus === 'failed').length,
    },
  ] as const

  return (
    <div className={styles.appShell}>
      <a
        className={styles.skipLink}
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault()
          mainContentRef.current?.focus({ preventScroll: true })
          mainContentRef.current?.scrollIntoView({ block: 'start' })
        }}
      >
        본문으로 건너뛰기
      </a>
      <WorkspaceSidebar
        info={workspace.workspace}
        songs={songs}
        tasks={tasks}
        loadState={loadState}
        view={view}
        onHome={goHome}
        onOpenTask={openTask}
        onSettings={() => go({ name: 'settings' })}
        onAddSong={openAddSong}
        onOpenNewSection={(songId) => go({ name: 'new-section', songId })}
        draftSongIds={drafts.editedSongIds}
        onOpenSupport={openSupport}
      />
      <main
        className={styles.main}
        ref={mainContentRef}
        id="workspace-content"
        tabIndex={-1}
      >
        {!ownTopBar && (
          <header className={`${styles.topBar} ${styles.taskTopBar}`}>
            {view.name === 'task' && detail ? (
              <TaskBreadcrumb
                songName={detail.song.name}
                current={detail.task.sectionName}
              />
            ) : (
              TOP_BAR_LABELS[view.name]
            )}
            {shownTask && canReviseSection(shownTask) && (
              <Button
                variant="ghost"
                compact
                onClick={() =>
                  go({ name: 'edit-section', taskId: shownTask.id })
                }
              >
                구간 수정
              </Button>
            )}
            {shownTask && detail && (
              <StopTaskControl
                key={shownTask.id}
                task={shownTask}
                stoppable={stoppable}
                inputKind={detail.song.inputKind}
                previousResultCount={detail.previousResults.length}
                stopping={recovery.stoppingTaskId === shownTask.id}
                onStop={() => recovery.stop(shownTask)}
                onEnded={() => {
                  if (workspaceId)
                    setStopNotice({
                      workspaceId,
                      viewKey,
                      message: `${shownTask.sectionName} 작업이 이미 끝나서 멈출 수 없어요.`,
                      icon: 'info',
                    })
                }}
                fallbackFocusRef={mainContentRef}
              />
            )}
          </header>
        )}
        {!ownTopBar && consentFeedback}
        <StopNotice
          notice={
            stopNotice?.workspaceId === workspaceId &&
            stopNotice.viewKey === viewKey
              ? stopNotice
              : null
          }
        />
        {loadState === 'loading' && (
          <LoadingState title="작업을 불러오고 있어요" />
        )}
        {(loadState === 'error' || loadState === 'expired') && (
          <ProblemState
            title={
              loadState === 'expired'
                ? '작업 공간을 열 수 없어요'
                : '작업을 불러오지 못했어요'
            }
            message={workspace.errorMessage}
            actionLabel={
              loadState === 'expired'
                ? onReenter
                  ? '코드 다시 입력'
                  : '다시 확인'
                : '다시 시도'
            }
            onAction={
              loadState === 'expired' && onReenter
                ? onReenter
                : retryWith(retryWorkspace)
            }
          />
        )}
        {workspaceReady && view.name === 'settings' && workspace.workspace && (
          <div className={styles.body}>
            <SettingsPanel
              maskedTesterCode={maskTesterCode(workspace.workspace.testerCode)}
              consentChoice={workspace.consent.choice}
              onLeave={() => onLeave?.()}
              onEditConsent={openConsent}
              onOpenSupport={openSupport}
            />
          </div>
        )}
        {workspaceReady &&
          (view.name === 'task-not-found' ||
            view.name === 'task-inaccessible') && (
            <div className={styles.centeredState}>
              <TaskUnavailablePanel onReturnToWorkspace={goHome} />
            </div>
          )}
        {workspaceReady &&
          (view.name === 'song-not-found' ||
            (view.name === 'new-section' && !newSectionSong)) && (
            <div className={styles.centeredState}>
              <TaskUnavailablePanel
                title="곡을 찾을 수 없어요"
                description="삭제됐거나 이 워크스페이스의 곡이 아니에요."
                onReturnToWorkspace={goHome}
              />
            </div>
          )}
        {newSection && (
          <NewSectionScreen
            key={newSection.id}
            song={newSection}
            songTasks={tasks.filter((task) => task.songId === newSection.id)}
            form={drafts.form(newSection.id)}
            onChange={(action) => drafts.dispatch(newSection.id, action)}
            onCancel={() => {
              drafts.discard(newSection.id)
              goHome()
            }}
            onReplaceFile={(returnFocus) => {
              if (!workspaceId) return
              addSongReturnFocusRef.current = returnFocus
              setReplaceFile({ workspaceId, songId: newSection.id })
            }}
            onSubmit={workspace.createTask}
            onCreated={(task) => {
              drafts.discard(newSection.id)
              openSavedTask(task.id)
            }}
            loadAudio={(songId, signal) =>
              repository.loadSongAudio(songId, signal)
            }
            onExpired={workspace.markExpired}
            notice={consentFeedback}
          />
        )}
        {workspaceReady && view.name === 'edit-section' && !editSection && (
          <TaskPanel
            result={taskDetail}
            onRetry={retryWith(taskDetail.retry)}
            onReturnHome={goHome}
            renderDetail={(detail) => (
              <div className={styles.centeredState}>
                <TaskUnavailablePanel
                  title="구간을 바꿀 수 없어요"
                  description={sectionEditUnavailableText(detail)}
                  actionLabel="작업으로 돌아가기"
                  onReturnToWorkspace={() => leaveEdit(detail.task.id)}
                />
              </div>
            )}
          />
        )}
        {editSection && editKind && (
          <EditSectionScreen
            key={editSection.task.id}
            task={editSection.task}
            kind={editKind}
            song={editSection.song}
            songTasks={tasks.filter(
              (task) => task.songId === editSection.song.id,
            )}
            onCancel={() => leaveEdit(editSection.task.id)}
            onSubmit={workspace.reviseTask}
            onRevised={(task) => finishEdit(task.id)}
            loadAudio={(songId, signal) =>
              repository.loadSongAudio(songId, signal)
            }
            onExpired={workspace.markExpired}
            notice={consentFeedback}
          />
        )}
        {workspaceReady && view.name === 'task' && (
          <TaskPanel
            result={taskDetail}
            onRetry={retryWith(taskDetail.retry)}
            onReturnHome={goHome}
            source={{
              loadSongAudio: (songId, signal) =>
                repository.loadSongAudio(songId, signal),
              loadSeparatedAudio: (taskId, signal) =>
                repository.loadSeparatedAudio(taskId, signal),
              loadTab: (taskId, signal) => repository.loadTab(taskId, signal),
              onExpired: workspace.markExpired,
            }}
            recovery={{
              retry: recovery.retry,
              contact: (returnFocus) => openSupport('contact', returnFocus),
              redefine: (taskId) => go({ name: 'edit-section', taskId }),
              uploadOther: uploadOtherFile,
            }}
            copy={copy}
          />
        )}
        {loadState === 'empty' && view.name === 'home' && (
          <EmptyWorkspace hasSongs={songs.length > 0} onAddSong={openAddSong} />
        )}
        {loadState === 'success' && view.name === 'home' && (
          <div className={styles.body}>
            {workspace.consent.choice === 'undecided' && (
              <div className={styles.consentNotice}>
                <div className={styles.consentNoticeText}>
                  <Icon name="info" />
                  <p>
                    올린 음원을 AI 학습에 써도 되는지 아직 정하지 않았어요.
                    정하지 않으면 쓰지 않아요.
                  </p>
                </div>
                <Button compact onClick={openConsent}>
                  선택하기
                </Button>
              </div>
            )}
            <div className={styles.listHeading}>
              <h1>최근 작업</h1>
              <div
                className={styles.filters}
                role="group"
                aria-label="작업 상태 필터"
              >
                {filters.map((item) => (
                  <button
                    key={item.value}
                    className={styles.filter}
                    type="button"
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label} <span>{item.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="최근 작업 목록. 좁은 화면에서는 가로로 스크롤할 수 있어요."
              tabIndex={0}
            >
              <TaskTable
                caption={`${filters.find((item) => item.value === filter)?.label} 작업 ${visibleTasks.length}개`}
                songs={songs}
                tasks={visibleTasks}
                onOpenTask={openTask}
              />
            </div>
            {visibleTasks.length === 0 && (
              <div className={styles.emptyFilter} role="status">
                <p>
                  {filter === 'processing'
                    ? '진행 중인 작업이 없어요.'
                    : '실패한 작업이 없어요.'}
                </p>
                <Button compact onClick={() => setFilter('all')}>
                  전체 작업 보기
                </Button>
              </div>
            )}
            <p className={styles.srOnly} role="status">
              {visibleTasks.length}개의 작업을 표시하고 있어요.
            </p>
          </div>
        )}
      </main>
      {consentWorkspaceId !== null && consentWorkspaceId === workspaceId && (
        <ConsentDialog
          consent={workspace.consent}
          onSave={workspace.saveConsent}
          onClose={closeConsent}
          fallbackFocusRef={mainContentRef}
        />
      )}
      {replaceFile && replaceFile.workspaceId === workspaceId && (
        <ReplaceFileDialog
          onConfirm={confirmReplaceFile}
          onClose={() => setReplaceFile(null)}
          returnFocusRef={addSongReturnFocusRef}
          fallbackFocusRef={mainContentRef}
        />
      )}
      {addSong && addSong.workspaceId === workspaceId && workspaceReady && (
        <AddSongDialog
          title={addSong.title}
          probeDuration={probeDuration}
          initialFiles={addSong.files}
          initialInputKind={addSong.inputKind}
          onSubmit={workspace.addSong}
          onAdded={(song) => {
            // The draft follows the new file; its range and part start over.
            if (addSong.replacesSongId)
              drafts.replaceFile(addSong.replacesSongId, song.id)
            if (addSong.draft) drafts.seed(song.id, addSong.draft)
            setAddSong(null)
            go({ name: 'new-section', songId: song.id })
          }}
          onClose={() => setAddSong(null)}
          returnFocusRef={addSongReturnFocusRef}
          fallbackFocusRef={mainContentRef}
        />
      )}
      {support && support.workspaceId === workspaceId && (
        <SupportDialog
          topic={support.topic}
          onClose={() => setSupport(null)}
          returnFocusRef={supportReturnFocusRef}
          fallbackFocusRef={mainContentRef}
        />
      )}
    </div>
  )
}
