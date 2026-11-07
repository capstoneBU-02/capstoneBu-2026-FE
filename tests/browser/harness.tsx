import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MediaDurationError,
  type MediaDurationProbe,
} from '../../src/features/add-song/mediaDuration.ts'
import { songNameFromFileName } from '../../src/features/add-song/songFile.ts'
import { WorkspacePage } from '../../src/features/workspace/WorkspacePage.tsx'
import { createMockWorkspaceRepository } from '../../src/features/workspace/mockRepository.ts'
import type {
  NewSongInput,
  SavedConsentChoice,
  SongInputKind,
  TaskDetail,
  WorkspaceSnapshot,
  WorkspaceSong,
} from '../../src/features/workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../../src/features/workspace/repository.ts'
import { useWorkspace } from '../../src/features/workspace/useWorkspace.ts'
import '../../src/index.css'

interface TestControls {
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
  // pending-add keeps addSong requests open until settled here.
  resolveAdd(): void
  failAdd(code: 'add-song-failed' | 'expired'): void
  addCalls(): Array<{
    fileName: string
    inputKind: SongInputKind
    durationSeconds: number
  }>
  // slow.mp3 duration reads stay pending until resolved here.
  resolveProbe(seconds: number): void
  probeCalls(): string[]
}

declare global {
  interface Window {
    workspaceTest: TestControls
  }
}

// The harness renders production hooks/components. Only the async boundary is
// controlled; ignoring AbortSignal here exercises stale-response protection.
const scenario = new URLSearchParams(window.location.search).get('scenario')
const fixture = await createMockWorkspaceRepository().loadWorkspace(
  new AbortController().signal,
)
// odd-task-id: a repository id outside the URL allowlist.
// empty: a workspace without songs or tasks.
const snapshot: WorkspaceSnapshot =
  scenario === 'odd-task-id'
    ? {
        ...fixture,
        tasks: fixture.tasks.map((task) =>
          task.id === 'task-verse' ? { ...task, id: 'Task_Verse' } : task,
        ),
      }
    : scenario === 'empty'
      ? { ...fixture, songs: [], tasks: [] }
      : fixture
const pendingLoads: Array<(snapshot: WorkspaceSnapshot) => void> = []
let saveCalls = 0
const taskCalls: string[] = []
const pendingTasks: Array<{
  taskId: string
  resolve: (detail: TaskDetail) => void
  reject: (error: Error) => void
}> = []

function taskDetail(taskId: string): TaskDetail | null {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId)
  const song = snapshot.songs.find((candidate) => candidate.id === task?.songId)
  return task && song ? { task, song } : null
}

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
// Durations by file name; unknown names are unreadable. Decoding is faked
// because Playwright's Chromium may lack MP4 codecs (see real-probe tests).
const PROBE_OUTCOMES: Record<string, number | 'error' | 'pending'> = {
  'neon_harbor_live.mp3': 252.4,
  'fresh_riff.mp3': 140.2,
  'late_train_cover.mp4': 238,
  'long_jam_take3.mp4': 391,
  'broken.mp3': 'error',
  'slow.mp3': 'pending',
}
const probeCalls: string[] = []
const pendingProbes: Array<(seconds: number) => void> = []
// Ignores AbortSignal so late results exercise stale-result protection.
const fakeProbe: MediaDurationProbe = (file) => {
  const name = file instanceof File ? file.name : ''
  probeCalls.push(name)
  const outcome = PROBE_OUTCOMES[name]
  if (outcome === 'pending')
    return new Promise((resolve) => pendingProbes.push(resolve))
  if (typeof outcome === 'number') return Promise.resolve(outcome)
  return Promise.reject(new MediaDurationError('unreadable'))
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
let addedSongs = 0

function addedSong(input: NewSongInput): WorkspaceSong {
  addedSongs += 1
  return {
    id: `song-added-${addedSongs}`,
    name: songNameFromFileName(input.file.name),
    fileName: input.file.name,
    inputKind: input.inputKind,
    durationSeconds: input.durationSeconds,
  }
}

let pendingSave:
  | {
      choice: SavedConsentChoice
      resolve: (choice: SavedConsentChoice) => void
      reject: (error: Error) => void
    }
  | undefined

const repository: WorkspaceRepository = {
  loadWorkspace() {
    if (scenario === 'pending-load') {
      return new Promise((resolve) => pendingLoads.push(resolve))
    }
    return Promise.resolve(snapshot)
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
}

const secondRepository: WorkspaceRepository = {
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
  loadTask: () =>
    Promise.reject(
      new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
    ),
  addSong: () =>
    Promise.reject(
      new WorkspaceRepositoryError('add-song-failed', 'Unavailable'),
    ),
}

window.workspaceTest = {
  releaseLoads() {
    pendingLoads.splice(0).forEach((resolve) => resolve(snapshot))
  },
  resolveSave() {
    pendingSave?.resolve(pendingSave.choice)
  },
  rejectSave() {
    pendingSave?.reject(
      new WorkspaceRepositoryError('consent-failed', 'Save failed'),
    )
  },
  switchWorkspace() {},
  saveTwice() {},
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
  resolveProbe(seconds) {
    pendingProbes.splice(0).forEach((resolve) => resolve(seconds))
  },
  probeCalls: () => [...probeCalls],
}

export function Harness() {
  const [activeRepository, setActiveRepository] = useState(repository)
  const workspace = useWorkspace(activeRepository)

  useEffect(() => {
    window.workspaceTest.switchWorkspace = () =>
      setActiveRepository(secondRepository)
    window.workspaceTest.saveTwice = () => {
      void workspace.saveConsent('accepted')
      void workspace.saveConsent('declined')
    }
  }, [workspace])

  return (
    <WorkspacePage
      workspace={workspace}
      repository={activeRepository}
      probeDuration={scenario === 'real-probe' ? undefined : fakeProbe}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
