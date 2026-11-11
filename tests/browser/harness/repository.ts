import { isPolicySectionName } from '../../../src/features/new-section/sectionForm.ts'
import type {
  NewSongInput,
  NewTaskInput,
  ReviseTaskInput,
  SavedConsentChoice,
  SongInputKind,
  TaskDetail,
  WorkspaceSnapshot,
  WorkspaceSong,
  WorkspaceTask,
} from '../../../src/features/workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../../../src/features/workspace/repository.ts'
import type { TestControls } from './controls.ts'
import { separatedAudio, songAudio } from './media.ts'
import {
  addedSong,
  canceledTask,
  createdTask,
  findTask,
  listedSnapshot,
  retriedTask,
  revisedTask,
  scenario,
  snapshot,
  taskDetail,
} from './server.ts'

// Only the async boundary is controlled; ignoring AbortSignal here exercises
// stale-response protection. Consent saves always wait for a test to settle
// them. pending-load, pending-task, pending-add, pending-create,
// pending-revise, pending-cancel and pending-retry hold their requests the
// same way.

const pendingLoads: Array<(snapshot: WorkspaceSnapshot) => void> = []
let listCalls = 0
let nextListFailure: 'load-failed' | 'expired' | null = null
let holdNextList = false
const heldLists: Array<() => void> = []
let saveCalls = 0
let pendingSave:
  | {
      choice: SavedConsentChoice
      resolve: (choice: SavedConsentChoice) => void
      reject: (error: Error) => void
    }
  | undefined

const taskCalls: string[] = []
const pendingTasks: Array<{
  taskId: string
  resolve: (detail: TaskDetail) => void
  reject: (error: Error) => void
}> = []
let nextTaskFailure: 'load-failed' | 'task-unavailable' | 'expired' | null =
  null

// StrictMode issues an aborted duplicate request in development; settle every
// pending request for the id so the current one is always included.
function settleTask(
  taskId: string,
  settle: (entry: (typeof pendingTasks)[number]) => void,
) {
  for (let index = pendingTasks.length - 1; index >= 0; index -= 1) {
    if (pendingTasks[index].taskId === taskId)
      settle(pendingTasks.splice(index, 1)[0])
  }
}

const addCalls: Array<{
  fileName: string
  inputKind: SongInputKind
  durationSeconds: number
}> = []
const pendingAdds: Array<{
  input: NewSongInput
  resolve: (song: WorkspaceSong) => void
  reject: (error: Error) => void
}> = []

const createCalls: NewTaskInput[] = []
const pendingCreates: Array<{
  input: NewTaskInput
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

const reviseCalls: Array<{ taskId: string; input: ReviseTaskInput }> = []
const pendingRevises: Array<{
  taskId: string
  input: ReviseTaskInput
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

const cancelCalls: string[] = []
const pendingCancels: Array<{
  taskId: string
  resolve: () => void
  reject: (error: Error) => void
}> = []

const retryCalls: string[] = []
const pendingRetries: Array<{
  taskId: string
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

// Runs a settle step as a promise, so a refused request rejects.
function settled<T>(step: () => T): Promise<T> {
  try {
    return Promise.resolve(step())
  } catch (error) {
    return Promise.reject(error)
  }
}

export const repository: WorkspaceRepository = {
  loadWorkspace() {
    listCalls += 1
    if (nextListFailure) {
      const code = nextListFailure
      nextListFailure = null
      return Promise.reject(new WorkspaceRepositoryError(code, 'List failed'))
    }
    if (holdNextList) {
      holdNextList = false
      const answer = listedSnapshot()
      return new Promise((resolve) => heldLists.push(() => resolve(answer)))
    }
    if (scenario === 'pending-load') {
      return new Promise((resolve) => pendingLoads.push(resolve))
    }
    return Promise.resolve(listedSnapshot())
  },
  saveConsent(choice) {
    saveCalls += 1
    if (scenario === 'save-expired') {
      return Promise.reject(
        new WorkspaceRepositoryError('expired', 'Expired while saving'),
      )
    }
    return new Promise((resolve, reject) => {
      pendingSave = { choice, resolve, reject }
    })
  },
  loadTask(taskId) {
    taskCalls.push(taskId)
    if (nextTaskFailure) {
      const code = nextTaskFailure
      nextTaskFailure = null
      return Promise.reject(new WorkspaceRepositoryError(code, 'Task failed'))
    }
    if (scenario === 'pending-task') {
      return new Promise((resolve, reject) =>
        pendingTasks.push({ taskId, resolve, reject }),
      )
    }
    const detail = taskDetail(taskId)
    return detail
      ? Promise.resolve(detail)
      : Promise.reject(
          new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
        )
  },
  addSong(input) {
    addCalls.push({
      fileName: input.file.name,
      inputKind: input.inputKind,
      durationSeconds: input.durationSeconds,
    })
    if (scenario === 'pending-add') {
      return new Promise((resolve, reject) =>
        pendingAdds.push({ input, resolve, reject }),
      )
    }
    return Promise.resolve(addedSong(input))
  },
  createTask(input) {
    createCalls.push({ ...input })
    // Like the mock repository, refuse names the screen cannot compose.
    if (!isPolicySectionName(input.sectionName))
      return Promise.reject(
        new WorkspaceRepositoryError('create-task-failed', 'Bad name'),
      )
    if (scenario === 'pending-create') {
      return new Promise((resolve, reject) =>
        pendingCreates.push({ input, resolve, reject }),
      )
    }
    return Promise.resolve(createdTask(input))
  },
  reviseTask(taskId, input) {
    reviseCalls.push({ taskId, input: { ...input } })
    if (!findTask(taskId))
      return Promise.reject(
        new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
      )
    if (!isPolicySectionName(input.sectionName))
      return Promise.reject(
        new WorkspaceRepositoryError('revise-task-failed', 'Bad name'),
      )
    if (scenario === 'pending-revise') {
      return new Promise((resolve, reject) =>
        pendingRevises.push({ taskId, input, resolve, reject }),
      )
    }
    return Promise.resolve(revisedTask(taskId, input))
  },
  cancelTask(taskId) {
    cancelCalls.push(taskId)
    if (scenario === 'pending-cancel') {
      return new Promise((resolve, reject) =>
        pendingCancels.push({ taskId, resolve, reject }),
      )
    }
    return settled(() => canceledTask(taskId))
  },
  retryTask(taskId) {
    retryCalls.push(taskId)
    if (scenario === 'pending-retry') {
      return new Promise((resolve, reject) =>
        pendingRetries.push({ taskId, resolve, reject }),
      )
    }
    return settled(() => retriedTask(taskId))
  },
  loadSongAudio: songAudio,
  loadSeparatedAudio: separatedAudio,
}

// The second workspace loads and saves consent; every other request fails.
function unavailable(
  code: ConstructorParameters<typeof WorkspaceRepositoryError>[0],
) {
  return () => Promise.reject(new WorkspaceRepositoryError(code, 'Unavailable'))
}

export const secondRepository: WorkspaceRepository = {
  loadWorkspace() {
    return Promise.resolve({
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        id: 'second-workspace',
        name: '두 번째 작업 공간',
      },
      songs: [],
      tasks: [],
      consentChoice: 'undecided',
    })
  },
  saveConsent: (choice) => Promise.resolve(choice),
  loadTask: unavailable('task-unavailable'),
  addSong: unavailable('add-song-failed'),
  createTask: unavailable('create-task-failed'),
  reviseTask: unavailable('task-unavailable'),
  cancelTask: unavailable('cancel-task-failed'),
  retryTask: unavailable('retry-task-failed'),
  loadSongAudio: unavailable('audio-unavailable'),
  loadSeparatedAudio: unavailable('audio-unavailable'),
}

// StrictMode may leave an aborted duplicate of a pending request, so the add,
// create, revise, cancel and retry steps settle every request in their queue.
export const requestControls = {
  releaseLoads() {
    pendingLoads.splice(0).forEach((resolve) => resolve(listedSnapshot()))
  },
  listCalls: () => listCalls,
  failNextListLoad(code) {
    nextListFailure = code
  },
  holdNextListLoad() {
    holdNextList = true
  },
  releaseListLoad() {
    heldLists.splice(0).forEach((release) => release())
  },
  resolveSave() {
    pendingSave?.resolve(pendingSave.choice)
  },
  rejectSave() {
    pendingSave?.reject(
      new WorkspaceRepositoryError('consent-failed', 'Save failed'),
    )
  },
  saveCalls: () => saveCalls,
  resolveTask(taskId) {
    settleTask(taskId, (entry) => {
      const detail = taskDetail(taskId)
      if (detail) entry.resolve(detail)
      else
        entry.reject(
          new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
        )
    })
  },
  failTask(taskId, code) {
    settleTask(taskId, (entry) =>
      entry.reject(new WorkspaceRepositoryError(code, 'Task failed')),
    )
  },
  taskCalls: () => [...taskCalls],
  failNextTaskLoad(code) {
    nextTaskFailure = code
  },
  resolveAdd() {
    pendingAdds
      .splice(0)
      .forEach(({ input, resolve }) => resolve(addedSong(input)))
  },
  failAdd(code) {
    pendingAdds
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Add failed')),
      )
  },
  addCalls: () => addCalls.map((call) => ({ ...call })),
  resolveCreate() {
    pendingCreates
      .splice(0)
      .forEach(({ input, resolve }) => resolve(createdTask(input)))
  },
  failCreate(code) {
    pendingCreates
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Create failed')),
      )
  },
  createCalls: () => createCalls.map((call) => ({ ...call })),
  resolveRevise() {
    pendingRevises
      .splice(0)
      .forEach(({ taskId, input, resolve }) =>
        resolve(revisedTask(taskId, input)),
      )
  },
  failRevise(code) {
    pendingRevises
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Revise failed')),
      )
  },
  reviseCalls: () =>
    reviseCalls.map(({ taskId, input }) => ({ taskId, input: { ...input } })),
  resolveCancel() {
    pendingCancels.splice(0).forEach(({ taskId, resolve, reject }) => {
      settled(() => canceledTask(taskId)).then(resolve, reject)
    })
  },
  failCancel(code) {
    pendingCancels
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Cancel failed')),
      )
  },
  cancelCalls: () => [...cancelCalls],
  resolveRetry() {
    pendingRetries.splice(0).forEach(({ taskId, resolve, reject }) => {
      settled(() => retriedTask(taskId)).then(resolve, reject)
    })
  },
  failRetry(code) {
    pendingRetries
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Retry failed')),
      )
  },
  retryCalls: () => [...retryCalls],
} satisfies Partial<TestControls>
