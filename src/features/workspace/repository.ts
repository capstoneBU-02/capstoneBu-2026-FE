import type {
  SavedConsentChoice,
  TaskDetail,
  WorkspaceSnapshot,
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
}

type RepositoryErrorCode =
  'load-failed' | 'consent-failed' | 'expired' | 'task-unavailable'

export class WorkspaceRepositoryError extends Error {
  readonly code: RepositoryErrorCode

  constructor(code: RepositoryErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
    this.code = code
  }
}
