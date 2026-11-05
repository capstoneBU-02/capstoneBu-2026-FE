import { useId, useRef, useState } from 'react'
import { BrandLogo } from '../../../shared/ui/BrandLogo.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { WorkspaceInfo, WorkspaceTask } from '../model.ts'
import type { UseWorkspaceResult } from '../useWorkspace.ts'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from '../WorkspacePage.module.css'
import { HelpMenu, type HelpTopic } from '../../support/HelpMenu.tsx'
import { maskTesterCode, type WorkspaceView } from '../navigation.ts'

type Props = {
  info: WorkspaceInfo | null
  tasks: readonly WorkspaceTask[]
  loadState: UseWorkspaceResult['loadState']
  onHome: () => void
  onSettings: () => void
  view: WorkspaceView
  onOpenSupport: (topic: HelpTopic, returnFocus: HTMLElement | null) => void
}

function SongGroup({
  songName,
  tasks,
  showAdd,
}: {
  songName: string
  tasks: readonly WorkspaceTask[]
  showAdd: boolean
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
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={styles.sectionRow}
            aria-disabled="true"
            title="작업 공간 화면은 아직 연결되지 않았어요."
            aria-label={`${task.sectionName} — 작업 공간 화면 준비 중`}
          >
            <Icon name={taskStatusIcon(task)} />
            <span className={styles.truncate}>{task.sectionName}</span>
            {task.processingStatus === 'processing' &&
              task.progressPercent !== null && (
                <span className={styles.progress}>{task.progressPercent}%</span>
              )}
          </button>
        ))}
        {showAdd && (
          <button
            type="button"
            className={`${styles.sectionRow} ${styles.unavailableAction}`}
            aria-disabled="true"
            title="구간 추가 화면은 아직 연결되지 않았어요."
            aria-label={`${songName} 구간 추가 — 준비 중`}
          >
            <Icon name="plusSmall" />
            구간 추가
          </button>
        )}
      </div>
    </div>
  )
}

export function WorkspaceSidebar({
  info,
  tasks,
  loadState,
  onHome,
  onSettings,
  view,
  onOpenSupport,
}: Props) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [previousView, setPreviousView] = useState(view)
  const helpTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLButtonElement>(null)
  if (previousView !== view) {
    setPreviousView(view)
    setNavigationOpen(false)
    setHelpOpen(false)
  }
  if (helpOpen && !info) setHelpOpen(false)
  const navigationId = useId()
  const songs = [...new Set(tasks.map((task) => task.songName))]

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
            aria-current={view === 'home' ? 'page' : undefined}
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
            aria-disabled="true"
            title="곡 추가 화면은 아직 연결되지 않았어요."
            aria-label="곡 추가 — 준비 중"
          >
            <Icon name="plus" />
          </button>
        </div>
        <div className={styles.songTree}>
          {songs.map((songName, index) => (
            <SongGroup
              key={songName}
              songName={songName}
              tasks={tasks.filter((task) => task.songName === songName)}
              showAdd={index === 0}
            />
          ))}
          {loadState === 'empty' && (
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
            aria-current={view === 'settings' ? 'page' : undefined}
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
