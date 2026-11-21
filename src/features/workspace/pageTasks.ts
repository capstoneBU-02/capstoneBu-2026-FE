// Tasks made from this page. Without a list API (B1) they are the only tasks
// the page knows; the access repository keeps one store per workspace, as it
// does for songs (PageSongs).

import type { PreviousTaskResult, WorkspaceTask } from './model.ts'

export interface PageTask {
  // The task as the screen last saw it: its section, labels and marks.
  readonly task: WorkspaceTask
  readonly previousResults: readonly PreviousTaskResult[]
  // The server's ids behind the task (task id = segment_id), null until the
  // processing status names them.
  readonly stemId: number | null
  readonly tabId: number | null
  // The server's last change time, kept for the list's time label.
  readonly updatedAt: string
}

export interface PageTasks {
  list(): readonly PageTask[]
  get(taskId: string): PageTask | undefined
  // Replaces a task in its place, or adds a new one at the end.
  put(record: PageTask): void
  remove(taskId: string): void
}

export function createPageTasks(): PageTasks {
  let records: readonly PageTask[] = []
  return {
    list: () => records,
    get: (taskId) => records.find((record) => record.task.id === taskId),
    put(record) {
      const known = records.some(({ task }) => task.id === record.task.id)
      records = known
        ? records.map((item) =>
            item.task.id === record.task.id ? record : item,
          )
        : [...records, record]
    },
    remove(taskId) {
      records = records.filter((record) => record.task.id !== taskId)
    },
  }
}
