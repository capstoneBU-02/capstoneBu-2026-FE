import type {
  NewSongInput,
  NewTaskInput,
  ReviseTaskInput,
  SavedConsentChoice,
  TaskDetail,
  WorkspaceSnapshot,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'

export interface WorkspaceRepository {
  loadWorkspace(signal: AbortSignal): Promise<WorkspaceSnapshot>
  saveConsent(
    choice: SavedConsentChoice,
    signal: AbortSignal,
  ): Promise<SavedConsentChoice>
  // A missing task and another workspace's task fail identically so the
  // screen cannot reveal whether an id exists elsewhere.
  loadTask(taskId: string, signal: AbortSignal): Promise<TaskDetail>
  addSong(input: NewSongInput, signal: AbortSignal): Promise<WorkspaceSong>
  // A new task starts queued; separation and transcription come later.
  createTask(input: NewTaskInput, signal: AbortSignal): Promise<WorkspaceTask>
  // 구간 수정: the same task starts over in the queue with the new section,
  // and its current result is kept as a previous result (D10).
  reviseTask(
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ): Promise<WorkspaceTask>
  // 멈추기: a queued or processing task stops, leaves the list and loses
  // its separated guitar; the song stays. Fails once the task has finished.
  cancelTask(taskId: string, signal: AbortSignal): Promise<void>
  // 다시 시도: a failed task goes back to the queue and starts from the stage
  // that failed, keeping the separated guitar it already has (JOB-04).
  retryTask(taskId: string, signal: AbortSignal): Promise<WorkspaceTask>
  // The song's audio file, decoded in the browser for the waveform and
  // playback. The shape of the real delivery (bytes or a URL) is still open.
  loadSongAudio(songId: string, signal: AbortSignal): Promise<Blob>
  // The guitar separated from the task's section: as long as the section,
  // with 0 s at the section start. Fails while the task has none.
  loadSeparatedAudio(taskId: string, signal: AbortSignal): Promise<Blob>
  // The finished task's tab as the server sends it, with 0 s at the section
  // start; the screen checks it with parseTabScore. The format is still open
  // with the TAB owner. Fails while the task has no finished tab.
  loadTab(taskId: string, signal: AbortSignal): Promise<unknown>
  // 카피 완료 표시·해제 (COPY-04): kept apart from processing and accepted
  // only for a finished task. Returns the task as the server keeps it; what
  // an unmarked task becomes is the server's call, as the contract is open.
  saveCopyStatus(
    taskId: string,
    confirmed: boolean,
    signal: AbortSignal,
  ): Promise<WorkspaceTask>
}

type RepositoryErrorCode =
  | 'load-failed'
  | 'consent-failed'
  | 'expired'
  | 'task-unavailable'
  | 'add-song-failed'
  | 'create-task-failed'
  | 'revise-task-failed'
  | 'cancel-task-failed'
  | 'retry-task-failed'
  | 'audio-unavailable'
  | 'tab-unavailable'
  | 'copy-status-failed'

export class WorkspaceRepositoryError extends Error {
  readonly code: RepositoryErrorCode

  constructor(code: RepositoryErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
    this.code = code
  }
}
