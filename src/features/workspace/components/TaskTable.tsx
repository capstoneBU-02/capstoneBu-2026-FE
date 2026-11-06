import { Icon } from '../../../shared/ui/Icon.tsx'
import { formatTaskRange } from '../format.ts'
import type { WorkspaceSong, WorkspaceTask } from '../model.ts'
import styles from '../WorkspacePage.module.css'
import { TaskStatus } from './TaskStatus.tsx'

export function TaskTable({
  caption,
  songs,
  tasks,
  onOpenTask,
}: {
  caption: string
  songs: readonly WorkspaceSong[]
  tasks: readonly WorkspaceTask[]
  onOpenTask: (taskId: string) => void
}) {
  const songNames = new Map(songs.map((song) => [song.id, song.name]))
  return (
    <table className={styles.taskTable}>
      <caption className={styles.srOnly}>{caption}</caption>
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
            <span className={styles.srOnly}>열기</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          // The row is a pointer convenience; the header button is the
          // keyboard and screen reader control for the same action.
          <tr
            key={task.id}
            className={styles.taskRow}
            onClick={(event) => {
              if (!(event.target instanceof Element)) return
              if (event.target.closest('button')) return
              // Selecting text in a row should not navigate away.
              if (window.getSelection()?.isCollapsed === false) return
              onOpenTask(task.id)
            }}
          >
            <th scope="row">
              <button
                type="button"
                className={styles.taskOpen}
                onClick={() => onOpenTask(task.id)}
              >
                <span className={styles.sectionName}>{task.sectionName}</span>
                <span className={styles.songName}>
                  {songNames.get(task.songId) ?? ''}
                </span>
              </button>
            </th>
            <td>{task.partLabel}</td>
            <td className={styles.range}>{formatTaskRange(task)}</td>
            <td>
              <TaskStatus task={task} />
            </td>
            <td className={styles.updated}>{task.updatedAtLabel}</td>
            <td className={styles.rowArrow} aria-hidden="true">
              <span>
                <Icon name="chevronRight" />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
