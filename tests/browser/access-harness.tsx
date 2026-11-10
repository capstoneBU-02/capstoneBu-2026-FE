import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App.tsx'
import { createMockAccessRepository } from '../../src/features/access/mockRepository.ts'
import type { AccessResult } from '../../src/features/access/model.ts'
import type { AccessRepository } from '../../src/features/access/repository.ts'
import type { ConsentChoice } from '../../src/features/workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../../src/features/workspace/repository.ts'
import '../../src/index.css'

interface AccessTestControls {
  replaceRepository(): void
  expireSession(): void
  releaseEntries(): Promise<void>
  releaseOnboarding(): Promise<void>
  releaseWorkspaceSaves(): Promise<void>
  calls(): {
    entries: number
    completions: number
    workspaceLoads: number
    consentSaves: number
    acknowledgements: number
    aborted: number
  }
}

declare global {
  interface Window {
    accessTest: AccessTestControls
  }
}

const scenario = new URLSearchParams(window.location.search).get('scenario')
const base = createMockAccessRepository()
const wrappers = new Map<WorkspaceRepository, WorkspaceRepository>()
const pendingEntries: Array<{
  code: string
  resolve: (result: AccessResult) => void
}> = []
const pendingCompletions: Array<{
  sessionId: string
  choice: ConsentChoice
  resolve: (result: AccessResult) => void
}> = []
let expired = false
let entries = 0
let completions = 0
let workspaceLoads = 0
let consentSaves = 0
let acknowledgements = 0
const pendingWorkspaceSaves: Array<{
  workspace: WorkspaceRepository
  choice: 'accepted' | 'declined'
  resolve: (choice: 'accepted' | 'declined') => void
}> = []
let aborted = 0

function trackCancellation(signal: AbortSignal) {
  signal.addEventListener(
    'abort',
    () => {
      aborted += 1
    },
    { once: true },
  )
}

// Render the production App. Only this async boundary ignores cancellation so
// stale resolution and repository replacement can be exercised deterministically.
const repository: AccessRepository = {
  acknowledgeNotice: (sessionId) => {
    acknowledgements += 1
    return base.acknowledgeNotice(sessionId)
  },
  enter(code, signal) {
    entries += 1
    expired = false
    if (scenario === 'pending-enter') {
      trackCancellation(signal)
      return new Promise((resolve) => pendingEntries.push({ code, resolve }))
    }
    return base.enter(code, signal)
  },
  workspaceFor(sessionId) {
    const workspace = base.workspaceFor(sessionId)
    let wrapper = wrappers.get(workspace)
    if (!wrapper) {
      wrapper = {
        loadWorkspace(signal) {
          workspaceLoads += 1
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.loadWorkspace(signal)
        },
        saveConsent(choice, signal) {
          consentSaves += 1
          if (scenario === 'pending-workspace-save') {
            trackCancellation(signal)
            return new Promise((resolve) =>
              pendingWorkspaceSaves.push({ workspace, choice, resolve }),
            )
          }
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.saveConsent(choice, signal)
        },
        loadTask(taskId, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.loadTask(taskId, signal)
        },
        addSong(input, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.addSong(input, signal)
        },
        createTask(input, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.createTask(input, signal)
        },
        reviseTask(taskId, input, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.reviseTask(taskId, input, signal)
        },
        loadSongAudio(songId, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.loadSongAudio(songId, signal)
        },
        loadSeparatedAudio(taskId, signal) {
          return expired
            ? Promise.reject(
                new WorkspaceRepositoryError('expired', 'Expired test session'),
              )
            : workspace.loadSeparatedAudio(taskId, signal)
        },
      }
      wrappers.set(workspace, wrapper)
    }
    return wrapper
  },
  completeOnboarding(sessionId, choice, signal) {
    completions += 1
    if (scenario === 'expire-onboarding-once' && completions === 1) {
      return Promise.reject(
        new WorkspaceRepositoryError('expired', 'Expired test session'),
      )
    }
    if (scenario === 'pending-onboarding') {
      trackCancellation(signal)
      return new Promise((resolve) =>
        pendingCompletions.push({ sessionId, choice, resolve }),
      )
    }
    return base.completeOnboarding(sessionId, choice, signal)
  },
}

window.accessTest = {
  replaceRepository() {},
  expireSession() {
    expired = true
  },
  async releaseEntries() {
    for (const request of pendingEntries.splice(0)) {
      request.resolve(
        await base.enter(request.code, new AbortController().signal),
      )
    }
  },
  async releaseOnboarding() {
    for (const request of pendingCompletions.splice(0)) {
      request.resolve(
        await base.completeOnboarding(
          request.sessionId,
          request.choice,
          new AbortController().signal,
        ),
      )
    }
  },
  async releaseWorkspaceSaves() {
    for (const request of pendingWorkspaceSaves.splice(0)) {
      request.resolve(
        await request.workspace.saveConsent(
          request.choice,
          new AbortController().signal,
        ),
      )
    }
  },
  calls: () => ({
    entries,
    completions,
    workspaceLoads,
    consentSaves,
    acknowledgements,
    aborted,
  }),
}

export function Harness() {
  const [activeRepository, setActiveRepository] = useState(repository)
  useEffect(() => {
    window.accessTest.replaceRepository = () =>
      setActiveRepository(createMockAccessRepository())
  }, [])
  return <App accessRepository={activeRepository} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
