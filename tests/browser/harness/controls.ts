import type {
  NewTaskInput,
  ReviseTaskInput,
  SongInputKind,
  WorkspaceTask,
} from '../../../src/features/workspace/model.ts'

// What browser tests call on window.workspaceTest. Each harness module
// provides its part; harness.tsx puts them together.
export interface TestControls {
  releaseLoads(): void
  resolveSave(): void
  rejectSave(): void
  switchWorkspace(): void
  saveTwice(): void
  saveCalls(): number
  // Task detail requests stay pending in the pending-task scenario so tests
  // can settle them out of order.
  resolveTask(taskId: string): void
  failTask(taskId: string, code: 'load-failed' | 'task-unavailable'): void
  taskCalls(): string[]
  // The next task request fails once with this code.
  failNextTaskLoad(code: 'load-failed' | 'task-unavailable' | 'expired'): void
  // pending-add keeps addSong requests open until settled here.
  resolveAdd(): void
  failAdd(code: 'add-song-failed' | 'expired'): void
  addCalls(): Array<{
    fileName: string
    inputKind: SongInputKind
    durationSeconds: number
  }>
  // pending-create keeps createTask requests open until settled here.
  resolveCreate(): void
  failCreate(code: 'create-task-failed' | 'expired'): void
  createCalls(): NewTaskInput[]
  // pending-revise keeps reviseTask requests open until settled here.
  resolveRevise(): void
  failRevise(code: 'revise-task-failed' | 'expired'): void
  reviseCalls(): Array<{ taskId: string; input: ReviseTaskInput }>
  // pending-cancel keeps cancelTask requests open until settled here.
  resolveCancel(): void
  failCancel(code: 'cancel-task-failed' | 'task-unavailable' | 'expired'): void
  cancelCalls(): string[]
  // pending-retry keeps retryTask requests open until settled here.
  resolveRetry(): void
  failRetry(code: 'retry-task-failed' | 'expired'): void
  retryCalls(): string[]
  // Sets how many retries the server counts as used for a task.
  setRetriesUsed(taskId: string, used: number): void
  // Queues a task on the server only, as another tab's change would. The
  // loaded list keeps showing its old state.
  queueTaskOnServer(taskId: string): void
  // Moves a task on the server only, as its processing would; the screen
  // sees it on its next request.
  updateTaskOnServer(taskId: string, change: ServerTaskChange): void
  // slow.mp3 duration reads stay pending until resolved here.
  resolveProbe(seconds: number): void
  probeCalls(): string[]
  // Song audio requests and whether the screen has cancelled each one.
  audioCalls(): Array<{ songId: string; aborted: boolean }>
  // Separated guitar requests and whether the screen has cancelled each one.
  separatedCalls(): Array<{ taskId: string; aborted: boolean }>
  // audio-error and separated-error serve playable audio from here on.
  healAudio(): void
  // The state of every playback output opened so far.
  audioContexts(): AudioContextState[]
  // Every sound source started so far, oldest first.
  audioSources(): Array<{ loop: boolean; loopStart: number; loopEnd: number }>
  // Seconds of audio each of those sources plays from, so tests can tell the
  // separated guitar from the whole song.
  sourceDurations(): number[]
  // The latest output's volume; null before the first play.
  outputGain(): number | null
  // React commits anywhere in the page since it loaded.
  commits(): number
}

export type ServerTaskChange = Partial<
  Pick<
    WorkspaceTask,
    'processingStatus' | 'failureKind' | 'progressPercent' | 'hasSeparatedAudio'
  >
> & { readonly queueAhead?: number | null }

declare global {
  interface Window {
    workspaceTest: TestControls
  }
}
