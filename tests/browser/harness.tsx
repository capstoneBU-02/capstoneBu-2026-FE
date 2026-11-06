import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '../../src/features/workspace/WorkspacePage.tsx'
import { createMockWorkspaceRepository } from '../../src/features/workspace/mockRepository.ts'
import type {
  SavedConsentChoice,
  TaskDetail,
  WorkspaceSnapshot,
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
const snapshot: WorkspaceSnapshot =
  scenario === 'odd-task-id'
    ? {
        ...fixture,
        tasks: fixture.tasks.map((task) =>
          task.id === 'task-verse' ? { ...task, id: 'Task_Verse' } : task,
        ),
      }
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

  return <WorkspacePage workspace={workspace} repository={activeRepository} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
