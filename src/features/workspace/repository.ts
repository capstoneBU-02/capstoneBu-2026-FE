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
  // The song's audio file, decoded in the browser for the waveform and
  // playback. The shape of the real delivery (bytes or a URL) is still open.
  loadSongAudio(songId: string, signal: AbortSignal): Promise<Blob>
}

type RepositoryErrorCode =
  | 'load-failed'
  | 'consent-failed'
  | 'expired'
  | 'task-unavailable'
  | 'add-song-failed'
  | 'create-task-failed'
  | 'revise-task-failed'
  | 'audio-unavailable'

export class WorkspaceRepositoryError extends Error {
  readonly code: RepositoryErrorCode

  constructor(code: RepositoryErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
    this.code = code
  }
}
