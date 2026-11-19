import type { KeyboardEvent } from 'react'
import { taskViewPanelId, taskViewTabId, type TaskView } from './taskView.ts'
import styles from './TaskViewTabs.module.css'

const VIEWS: readonly TaskView[] = ['tab', 'comparison']

// 타브 and 비교 share the task screen (Figma 32:66). The count is left out
// until there is a comparison to count.
export function TaskViewTabs({
  baseId,
  value,
  comparedCount,
  onChange,
}: {
  baseId: string
  value: TaskView
  comparedCount: number
  onChange: (view: TaskView) => void
}) {
  function moveWithArrows(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = value === 'tab' ? 'comparison' : 'tab'
    onChange(next)
    document.getElementById(taskViewTabId(baseId, next))?.focus()
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label="작업 화면">
      {VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          role="tab"
          id={taskViewTabId(baseId, view)}
          className={styles.tab}
          aria-selected={value === view}
          aria-controls={taskViewPanelId(baseId, view)}
          tabIndex={value === view ? 0 : -1}
          onClick={() => onChange(view)}
          onKeyDown={moveWithArrows}
        >
          {view === 'tab' ? '타브' : '비교'}
          {view === 'comparison' && comparedCount > 0 && (
            <span className={styles.count}>{comparedCount}</span>
          )}
        </button>
      ))}
    </div>
  )
}
