// What this page knows of its tasks beyond the server's segments: the screen's
// names, part and previous results, which the server does not keep. The
// access repository keeps one store per workspace, as it does for songs
// (PageSongs).

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
  // The segment version and change time the task last took its range and
  // name from. The server keeps the version for a new name alone, so a
  // list item is newer by a higher version or, at the same one, a later
  // time; an older one was sent before a change and is not applied.
  readonly segmentVersion: number
  readonly segmentUpdatedAt: string
}

export interface PageTasks {
  list(): readonly PageTask[]
  get(taskId: string): PageTask | undefined
  // Replaces a task in its place, or adds a new one at the end.
  put(record: PageTask): void
  // Drops a task the server did not find, as under another code's session.
  // A later list may bring it back.
  remove(taskId: string): void
  // Drops a stopped task for good: the server still lists a cancelled
  // segment, and the list leaves it out without reading it.
  markGone(taskId: string): void
  isGone(taskId: string): boolean
}

export function createPageTasks(): PageTasks {
  let records: readonly PageTask[] = []
  let gone: ReadonlySet<string> = new Set()
  const remove = (taskId: string) => {
    records = records.filter((record) => record.task.id !== taskId)
  }
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
    remove,
    markGone(taskId) {
      remove(taskId)
      gone = new Set([...gone, taskId])
    },
    isGone: (taskId) => gone.has(taskId),
  }
}
