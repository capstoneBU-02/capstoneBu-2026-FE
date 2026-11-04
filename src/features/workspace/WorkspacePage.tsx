import { useRef, useState } from 'react'
import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { ConsentDialog } from './components/ConsentDialog.tsx'
import { TaskStatus } from './components/TaskStatus.tsx'
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx'
import type { UseWorkspaceResult } from './useWorkspace.ts'
import styles from './WorkspacePage.module.css'

type Filter = 'all' | 'processing' | 'failed'

function formatTime(seconds: number) {
  const tenths = Math.round(seconds * 10)
  const minutes = Math.floor(tenths / 600)
  const wholeSeconds = Math.floor((tenths % 600) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${tenths % 10}`
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
}: {
  workspace: UseWorkspaceResult
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [consentWorkspaceId, setConsentWorkspaceId] = useState<string | null>(
    null,
  )
  const mainContentRef = useRef<HTMLElement>(null)
  const { tasks, loadState } = workspace
  const workspaceId = workspace.workspace?.id ?? null

  // Reset the dialog's lifetime when its workspace disappears or changes.
  if (consentWorkspaceId !== null && consentWorkspaceId !== workspaceId) {
    setConsentWorkspaceId(null)
  }

  function openConsent() {
    workspace.clearConsentError()
    setConsentWorkspaceId(workspaceId)
  }

  function closeConsent() {
    setConsentWorkspaceId(null)
    workspace.clearConsentError()
  }
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
      <a className={styles.skipLink} href="#workspace-content">
        작업 목록으로 건너뛰기
      </a>
      <WorkspaceSidebar
        info={workspace.workspace}
        tasks={tasks}
        loadState={loadState}
        onHome={() => {
          setFilter('all')
          mainContentRef.current?.focus({ preventScroll: true })
        }}
        onSettings={openConsent}
      />
      <main
        className={styles.main}
        ref={mainContentRef}
        id="workspace-content"
        tabIndex={-1}
      >
        <header className={styles.topBar}>내 작업</header>
        {loadState === 'loading' && (
          <div className={styles.centeredState} role="status">
            <div className={styles.stateMessage}>
              <span className={styles.loadingDot} aria-hidden="true" />
              <h1>작업을 불러오고 있어요</h1>
            </div>
          </div>
        )}
        {(loadState === 'error' || loadState === 'expired') && (
          <div className={styles.centeredState}>
            <div className={styles.stateMessage}>
              <Icon name="info" />
              <h1>
                {loadState === 'expired'
                  ? '작업 공간을 열 수 없어요'
                  : '작업을 불러오지 못했어요'}
              </h1>
              <p role="alert">{workspace.errorMessage}</p>
              <Button onClick={workspace.retryLoad}>
                {loadState === 'expired' ? '다시 확인' : '다시 시도'}
              </Button>
            </div>
          </div>
        )}
        {loadState === 'empty' && <EmptyWorkspace />}
        {loadState === 'success' && (
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
              <table className={styles.taskTable}>
                <caption className={styles.srOnly}>
                  {filters.find((item) => item.value === filter)?.label} 작업{' '}
                  {visibleTasks.length}개
                </caption>
                <colgroup>
                  <col className={styles.sectionColumn} />
                  <col className={styles.partColumn} />
                  <col className={styles.rangeColumn} />
                  <col className={styles.statusColumn} />
                  <col className={styles.updatedColumn} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">구간</th>
                    <th scope="col">파트</th>
                    <th scope="col">범위</th>
                    <th scope="col">상태</th>
                    <th scope="col">수정</th>
                    <th scope="col">
                      <span className={styles.srOnly}>작업 공간</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => (
                    <tr
                      key={task.id}
                      title="작업 공간 화면은 아직 연결되지 않았어요."
                    >
                      <th scope="row">
                        <span className={styles.sectionName}>
                          {task.sectionName}
                        </span>
                        <span className={styles.songName}>{task.songName}</span>
                      </th>
                      <td>{task.partLabel}</td>
                      <td className={styles.range}>
                        {formatTime(task.rangeStartSeconds)}–
                        {formatTime(task.rangeEndSeconds)}
                      </td>
                      <td>
                        <TaskStatus task={task} />
                      </td>
                      <td className={styles.updated}>{task.updatedAtLabel}</td>
                      <td className={styles.rowArrow}>
                        <span>
                          <Icon name="chevronRight" />
                          <span className={styles.srOnly}>
                            작업 공간 화면 준비 중
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </div>
  )
}
