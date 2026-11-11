import { Profiler, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '../../src/features/workspace/WorkspacePage.tsx'
import { useWorkspace } from '../../src/features/workspace/useWorkspace.ts'
import { fakeProbe, mediaControls } from './harness/media.ts'
import {
  repository,
  requestControls,
  secondRepository,
} from './harness/repository.ts'
import { scenario, serverControls } from './harness/server.ts'
import '../../src/index.css'

// The harness renders production hooks and components against a test server
// in ./harness: server.ts holds its state, repository.ts answers the screen's
// requests, and media.ts fakes duration reads and serves audio. Loading
// media.ts also replaces window.AudioContext before anything renders.

// refresh=<ms> turns on refreshing an open task; other tests count requests.
const refresh = new URLSearchParams(window.location.search).get('refresh')
const taskRefreshMs = refresh === null ? null : Number(refresh)

let commits = 0

window.workspaceTest = {
  ...requestControls,
  ...serverControls,
  ...mediaControls,
  // Harness replaces these once it renders.
  switchWorkspace() {},
  saveTwice() {},
  commits: () => commits,
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
      taskRefreshMs={taskRefreshMs}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Profiler
      id="page"
      onRender={() => {
        commits += 1
      }}
    >
      <Harness />
    </Profiler>
  </StrictMode>,
)
