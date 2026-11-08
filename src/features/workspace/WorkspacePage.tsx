import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { AddSongDialog } from '../add-song/AddSongDialog.tsx'
import {
  createMediaDurationProbe,
  type MediaDurationProbe,
} from '../add-song/mediaDuration.ts'
import { UPLOAD_POLICY } from '../add-song/uploadPolicy.ts'
import { NewSectionScreen } from '../new-section/NewSectionScreen.tsx'
import { ReplaceFileDialog } from '../new-section/ReplaceFileDialog.tsx'
import { useSectionDrafts } from '../new-section/useSectionDrafts.ts'
import { ConsentDialog } from './components/ConsentDialog.tsx'
import { EmptyWorkspace } from './components/EmptyWorkspace.tsx'
import { LoadingState, ProblemState } from './components/StateMessage.tsx'
import { TaskTable } from './components/TaskTable.tsx'
import { TaskBreadcrumb, TaskPanel } from './components/TaskWorkspace.tsx'
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx'
import { isTaskInProgress } from './format.ts'
import type { SongInputKind } from './model.ts'
import type { WorkspaceRepository } from './repository.ts'
import { useTaskDetail } from './useTaskDetail.ts'
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
}

const defaultDurationProbe = createMediaDurationProbe(
  UPLOAD_POLICY.metadataTimeoutMs,
)

interface AddSongRequest {
  readonly workspaceId: string
  readonly files: readonly File[]
  // Set when 파일 바꾸기 adds a replacement for this song's draft.
  readonly replacesSongId?: string
  readonly inputKind?: SongInputKind
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
}: {
  workspace: UseWorkspaceResult
  repository: WorkspaceRepository
  onReenter?: () => void
  onLeave?: () => void
  focusOnEntry?: boolean
  probeDuration?: MediaDurationProbe
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const { view, navigate } = useWorkspaceNavigation()
  const [consentWorkspaceId, setConsentWorkspaceId] = useState<string | null>(
    null,
  )
  const viewKey = workspaceViewKey(view)
  const taskDetail = useTaskDetail(
    repository,
    view.name === 'task' ? view.taskId : null,
    workspace.markExpired,
  )
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
  const { songs, tasks, loadState } = workspace
  const workspaceId = workspace.workspace?.id ?? null
  const previousFocusViewKey = useRef(viewKey)
  const workspaceReady = loadState === 'empty' || loadState === 'success'
  const drafts = useSectionDrafts(
    workspaceId,
    view.name === 'new-section' ? view.songId : null,
  )

  // Transfer focus from the removed access/onboarding screen only on entry.
  // Loading, filtering and consent updates must preserve the user's focus.
  useEffect(() => {
    if (focusOnEntry || previousFocusViewKey.current !== viewKey)
      mainContentRef.current?.focus({ preventScroll: true })
    previousFocusViewKey.current = viewKey
  }, [focusOnEntry, viewKey])

  // Sessions live in memory, so a file dropped outside a drop area must not
  // make the browser open it and leave the app.
  useEffect(() => {
    const keepPage = (event: DragEvent) => {
      if (hasDraggedFiles(event)) event.preventDefault()
    }
    window.addEventListener('dragover', keepPage)
    window.addEventListener('drop', keepPage)
    return () => {
      window.removeEventListener('dragover', keepPage)
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
  }
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
      replacesSongId: replaceFile.songId,
      inputKind: songs.find((song) => song.id === replaceFile.songId)
        ?.inputKind,
    })
    setReplaceFile(null)
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
  const goHome = () => go({ name: 'home' })
  const openTask = (taskId: string) => go({ name: 'task', taskId })
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
        {/* The new-section screen renders its own bar with its actions. */}
        {!newSection && (
          <header className={styles.topBar}>
            {view.name === 'task' && workspaceReady && taskDetail.detail ? (
              <TaskBreadcrumb
                songName={taskDetail.detail.song.name}
                current={taskDetail.detail.task.sectionName}
              />
            ) : (
              TOP_BAR_LABELS[view.name]
            )}
          </header>
        )}
        {!newSection && consentFeedback}
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
                : retryWith(workspace.retryLoad)
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
              const taskView = { name: 'task', taskId: task.id } as const
              drafts.discard(newSection.id)
              setKeepDialogsViewKey(workspaceViewKey(taskView))
              go(taskView)
            }}
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
          title={addSong.replacesSongId ? '파일 바꾸기' : undefined}
          probeDuration={probeDuration}
          initialFiles={addSong.files}
          initialInputKind={addSong.inputKind}
          onSubmit={workspace.addSong}
          onAdded={(song) => {
            // The draft follows the new file; its range and part start over.
            if (addSong.replacesSongId)
              drafts.replaceFile(addSong.replacesSongId, song.id)
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
