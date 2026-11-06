import { useEffect, useRef, useState } from 'react'
import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { ConsentDialog } from './components/ConsentDialog.tsx'
import { LoadingState, ProblemState } from './components/StateMessage.tsx'
import { TaskTable } from './components/TaskTable.tsx'
import { TaskBreadcrumb, TaskPanel } from './components/TaskWorkspace.tsx'
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx'
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
}

function EmptyWorkspace() {
  return (
    <div className={styles.centeredState}>
      <div className={styles.emptyCard}>
        <span className={styles.uploadCircle}>
          <Icon name="upload" />
        </span>
        <h1>첫 곡을 올려 주세요</h1>
        <p>{DEMO_DISPLAY_CONFIG.uploadHintLabel}</p>
        <Button
          variant="primary"
          className={styles.emptyAction}
          aria-disabled="true"
          title="곡 추가 화면은 아직 연결되지 않았어요."
          aria-label="파일 선택 — 곡 추가 화면 준비 중"
        >
          파일 선택
        </Button>
      </div>
    </div>
  )
}

export function WorkspacePage({
  workspace,
  repository,
  onReenter,
  onLeave,
  focusOnEntry = false,
}: {
  workspace: UseWorkspaceResult
  repository: WorkspaceRepository
  onReenter?: () => void
  onLeave?: () => void
  focusOnEntry?: boolean
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
  const [support, setSupport] = useState<{
    topic: SupportTopic
    workspaceId: string
  } | null>(null)
  const supportReturnFocusRef = useRef<HTMLElement | null>(null)
  const mainContentRef = useRef<HTMLElement>(null)
  const { songs, tasks, loadState } = workspace
  const workspaceId = workspace.workspace?.id ?? null
  const previousFocusViewKey = useRef(viewKey)
  const workspaceReady = loadState === 'empty' || loadState === 'success'

  // Transfer focus from the removed access/onboarding screen only on entry.
  // Loading, filtering and consent updates must preserve the user's focus.
  useEffect(() => {
    if (focusOnEntry || previousFocusViewKey.current !== viewKey)
      mainContentRef.current?.focus({ preventScroll: true })
    previousFocusViewKey.current = viewKey
  }, [focusOnEntry, viewKey])

  if (previousViewKey !== viewKey) {
    setPreviousViewKey(viewKey)
    setConsentWorkspaceId(null)
    setSupport(null)
  }
  if (support && support.workspaceId !== workspaceId) setSupport(null)

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
  const visibleTasks = tasks.filter(
    (task) => filter === 'all' || task.processingStatus === filter,
  )
  const filters = [
    { value: 'all', label: '전체', count: tasks.length },
    {
      value: 'processing',
      label: '진행 중',
      count: tasks.filter((task) => task.processingStatus === 'processing')
        .length,
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
        onOpenSupport={openSupport}
      />
      <main
        className={styles.main}
        ref={mainContentRef}
        id="workspace-content"
        tabIndex={-1}
      >
        <header className={styles.topBar}>
          {view.name === 'task' && workspaceReady && taskDetail.detail ? (
            <TaskBreadcrumb detail={taskDetail.detail} />
          ) : (
            TOP_BAR_LABELS[view.name]
          )}
        </header>
        {workspaceId &&
          consentWorkspaceId !== workspaceId &&
          workspace.consent.errorMessage && (
            <div className="consent-feedback">
              <p role="alert">AI 학습 활용: {workspace.consent.errorMessage}</p>
              <Button compact onClick={openConsent}>
                AI 학습 활용 다시 선택
              </Button>
            </div>
          )}
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
        {workspaceReady && view.name === 'task' && (
          <TaskPanel
            result={taskDetail}
            onRetry={retryWith(taskDetail.retry)}
            onReturnHome={goHome}
          />
        )}
        {loadState === 'empty' && view.name === 'home' && <EmptyWorkspace />}
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
