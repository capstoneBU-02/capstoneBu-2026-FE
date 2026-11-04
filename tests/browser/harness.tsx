import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '../../src/features/workspace/WorkspacePage.tsx'
import { createMockWorkspaceRepository } from '../../src/features/workspace/mockRepository.ts'
import type {
  SavedConsentChoice,
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
}

declare global {
  interface Window {
    workspaceTest: TestControls
  }
}

// The harness renders production hooks/components. Only the async boundary is
// controlled; ignoring AbortSignal here exercises stale-response protection.
const snapshot = await createMockWorkspaceRepository().loadWorkspace(
  new AbortController().signal,
)
const scenario = new URLSearchParams(window.location.search).get('scenario')
const pendingLoads: Array<(snapshot: WorkspaceSnapshot) => void> = []
let saveCalls = 0
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
      tasks: [],
      consentChoice: 'undecided',
    })
  },
  saveConsent: (choice) => Promise.resolve(choice),
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

  return <WorkspacePage workspace={workspace} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
