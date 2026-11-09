import { useId, useRef, useState } from 'react'
import { BrandLogo } from '../../../shared/ui/BrandLogo.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { WorkspaceInfo, WorkspaceSong, WorkspaceTask } from '../model.ts'
import type { UseWorkspaceResult } from '../useWorkspace.ts'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from '../WorkspacePage.module.css'
import { HelpMenu, type HelpTopic } from '../../support/HelpMenu.tsx'
import {
  maskTesterCode,
  workspaceViewKey,
  type WorkspaceView,
} from '../navigation.ts'

type Props = {
  info: WorkspaceInfo | null
  songs: readonly WorkspaceSong[]
  tasks: readonly WorkspaceTask[]
  loadState: UseWorkspaceResult['loadState']
  onHome: () => void
  onOpenTask: (taskId: string) => void
  onSettings: () => void
  onAddSong: (returnFocus: HTMLElement | null) => void
  onOpenNewSection: (songId: string) => void
  // Songs with a section draft in progress, listed as a 새 구간 row.
  draftSongIds: ReadonlySet<string>
  view: WorkspaceView
  onOpenSupport: (topic: HelpTopic, returnFocus: HTMLElement | null) => void
}

function taskProgressLabel(task: WorkspaceTask) {
  if (task.processingStatus === 'queued') return '대기'
  if (task.processingStatus === 'processing' && task.progressPercent !== null)
    return `${task.progressPercent}%`
  return null
}

function SongGroup({
  songName,
  tasks,
  showDraft,
  draftCurrent,
  currentTask,
  onOpenTask,
  onOpenNewSection,
}: {
  songName: string
  tasks: readonly WorkspaceTask[]
  showDraft: boolean
  draftCurrent: boolean
  currentTask: { id: string; current: 'page' | 'true' } | null
  onOpenTask: (taskId: string) => void
  onOpenNewSection: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const childrenId = useId()
  return (
    <div className={styles.songGroup}>
      <button
        className={styles.songHeading}
        type="button"
        aria-expanded={expanded}
        aria-controls={childrenId}
        onClick={() => setExpanded((current) => !current)}
      >
        <Icon
          name="chevronDown"
          className={expanded ? '' : styles.collapsedChevron}
        />
        <span className={styles.truncate}>{songName}</span>
      </button>
      <div className={styles.songChildren} id={childrenId} hidden={!expanded}>
        {tasks.map((task) => {
          const progress = taskProgressLabel(task)
          return (
            <button
              key={task.id}
              type="button"
              className={styles.sectionRow}
              aria-current={
                task.id === currentTask?.id ? currentTask.current : undefined
              }
              onClick={() => onOpenTask(task.id)}
            >
              <Icon name={taskStatusIcon(task)} />
              <span className={styles.truncate}>{task.sectionName}</span>
              {progress && <span className={styles.progress}>{progress}</span>}
            </button>
          )
        })}
        {showDraft && (
          <button
            type="button"
            className={styles.sectionRow}
            aria-current={draftCurrent ? 'page' : undefined}
            onClick={onOpenNewSection}
          >
            <Icon name="statusDraft" />
            <span className={styles.truncate}>새 구간</span>
            <span className={styles.srOnly}>작성 중</span>
          </button>
        )}
        <button
          type="button"
          className={`${styles.sectionRow} ${styles.addSection}`}
          aria-label={`${songName}에 구간 추가`}
          onClick={onOpenNewSection}
        >
          <Icon name="plusSmall" />
          구간 추가
        </button>
      </div>
    </div>
  )
}

export function WorkspaceSidebar({
  info,
  tasks,
  loadState,
  onHome,
  onOpenTask,
  onSettings,
  onAddSong,
  onOpenNewSection,
  draftSongIds,
  view,
  onOpenSupport,
  songs,
}: Props) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const viewKey = workspaceViewKey(view)
  const [previousViewKey, setPreviousViewKey] = useState(viewKey)
  const helpTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLButtonElement>(null)
  if (previousViewKey !== viewKey) {
    setPreviousViewKey(viewKey)
    setNavigationOpen(false)
    setHelpOpen(false)
  }
  if (helpOpen && !info) setHelpOpen(false)
  const navigationId = useId()
  // 구간 수정 keeps the edited task highlighted, but its row opens the task,
  // another page, so there it is the current item instead of the page.
  const currentTask =
    view.name === 'task' || view.name === 'edit-section'
      ? {
          id: view.taskId,
          current: view.name === 'task' ? ('page' as const) : ('true' as const),
        }
      : null
  const newSectionSongId = view.name === 'new-section' ? view.songId : null

  return (
    <aside
      className={styles.sidebar}
      aria-label="워크스페이스 탐색"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && navigationOpen && !helpOpen) {
          setNavigationOpen(false)
          mobileMenuRef.current?.focus()
        }
      }}
    >
      <div className={styles.sidebarHeader}>
        <BrandLogo />
        <button
          className={styles.mobileMenu}
          ref={mobileMenuRef}
          type="button"
          aria-expanded={navigationOpen}
          aria-controls={navigationId}
          aria-label={navigationOpen ? '탐색 메뉴 닫기' : '탐색 메뉴 열기'}
          onClick={() => {
            setNavigationOpen((open) => !open)
            setHelpOpen(false)
          }}
        >
          <Icon name={navigationOpen ? 'close' : 'list'} />
        </button>
      </div>
      <div
        className={`${styles.navigationPanel} ${navigationOpen ? styles.navigationOpen : ''}`}
        id={navigationId}
      >
        <nav className={styles.mainNav} aria-label="주 메뉴">
          <button
            type="button"
            className={styles.homeRow}
            aria-current={view.name === 'home' ? 'page' : undefined}
            onClick={() => {
              onHome()
              setNavigationOpen(false)
              setHelpOpen(false)
            }}
          >
            <Icon name="list" />내 작업
          </button>
        </nav>
        <div className={styles.songHeader}>
          <span>곡</span>
          <button
            type="button"
            className={styles.addSong}
            aria-label="곡 추가"
            disabled={!info}
            onClick={(event) => {
              // In the mobile drawer the button disappears with the drawer,
              // so focus returns to the menu trigger instead.
              const mobileTrigger = mobileMenuRef.current
              const returnFocus =
                mobileTrigger && mobileTrigger.getClientRects().length > 0
                  ? mobileTrigger
                  : event.currentTarget
              setNavigationOpen(false)
              setHelpOpen(false)
              onAddSong(returnFocus)
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
        <div className={styles.songTree}>
          {songs.map((song) => (
            <SongGroup
              key={song.id}
              songName={song.name}
              tasks={tasks.filter((task) => task.songId === song.id)}
              showDraft={
                draftSongIds.has(song.id) || newSectionSongId === song.id
              }
              draftCurrent={newSectionSongId === song.id}
              currentTask={currentTask}
              onOpenTask={(taskId) => {
                onOpenTask(taskId)
                setNavigationOpen(false)
                setHelpOpen(false)
              }}
              onOpenNewSection={() => {
                onOpenNewSection(song.id)
                setNavigationOpen(false)
                setHelpOpen(false)
              }}
            />
          ))}
          {loadState === 'empty' && songs.length === 0 && (
            <p className={styles.emptySongs}>아직 곡이 없어요</p>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          <div className={styles.helpAnchor}>
            <button
              type="button"
              ref={helpTriggerRef}
              className={styles.footerRow}
              disabled={!info}
              aria-haspopup="menu"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((open) => !open)}
            >
              <Icon name="help" />
              도움말
            </button>
            <HelpMenu
              open={helpOpen}
              triggerRef={helpTriggerRef}
              onClose={() => setHelpOpen(false)}
              onSelect={(topic) => {
                const mobileTrigger = mobileMenuRef.current
                const returnFocus =
                  mobileTrigger && mobileTrigger.getClientRects().length > 0
                    ? mobileTrigger
                    : helpTriggerRef.current
                setHelpOpen(false)
                setNavigationOpen(false)
                onOpenSupport(topic, returnFocus)
              }}
            />
          </div>
          <button
            type="button"
            className={styles.footerRow}
            onClick={() => {
              onSettings()
              setNavigationOpen(false)
              setHelpOpen(false)
            }}
            disabled={!info}
            aria-label="설정"
            aria-current={view.name === 'settings' ? 'page' : undefined}
          >
            <Icon name="settings" />
            설정
          </button>
          <div className={styles.workspaceIdentity}>
            <span className={styles.avatar} aria-hidden="true">
              T
            </span>
            <div className={styles.workspaceLabels}>
              <span className={styles.truncate}>
                {info?.name ?? '테스터 워크스페이스'}
              </span>
              {info && (
                <span className={styles.testerCode}>
                  {maskTesterCode(info.testerCode)}
                </span>
              )}
            </div>
            <button
              type="button"
              className={styles.moreButton}
              aria-disabled="true"
              aria-label="워크스페이스 더 보기 — 준비 중"
              title="워크스페이스 메뉴는 아직 연결되지 않았어요."
            >
              <Icon name="more" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
