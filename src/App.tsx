import { useState } from 'react'
import { readDemoScenario } from './app/demoConfig.ts'
import { createMockWorkspaceRepository } from './features/workspace/mockRepository.ts'
import { useWorkspace } from './features/workspace/useWorkspace.ts'
import { WorkspacePage } from './features/workspace/WorkspacePage.tsx'

function App() {
  const [{ repository, scenario }] = useState(() => {
    const scenario = readDemoScenario(window.location.search)
    return { scenario, repository: createMockWorkspaceRepository(scenario) }
  })
  const workspace = useWorkspace(repository, scenario)

  return <WorkspacePage workspace={workspace} />
}

export default App
