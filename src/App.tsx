import { useEffect, useState } from 'react'
import type { AppRepositories } from './app/repositories.ts'
import { AccessPage } from './features/access/AccessPage.tsx'
import { useAccess } from './features/access/useAccess.ts'
import { useDemoComparisonRepository } from './features/comparison/demoComparison.ts'
import type { ComparisonRepository } from './features/comparison/repository.ts'
import { OnboardingPage } from './features/onboarding/OnboardingPage.tsx'
import type { DemoScenario } from './features/workspace/model.ts'
import type { WorkspaceRepository } from './features/workspace/repository.ts'
import { useWorkspace } from './features/workspace/useWorkspace.ts'
import { WorkspacePage } from './features/workspace/WorkspacePage.tsx'
import { clearWorkspaceHistory } from './features/workspace/navigation.ts'

function WorkspaceSession({
  repository,
  comparison,
  scenario = 'default',
  onReenter,
  onLeave,
  focusOnEntry = false,
}: {
  repository: WorkspaceRepository
  comparison: ComparisonRepository | null
  scenario?: DemoScenario
  onReenter(): void
  onLeave(): void
  focusOnEntry?: boolean
}) {
  const workspace = useWorkspace(repository, scenario)
  // Without a comparison API, mock comparisons over this workspace.
  const demoComparison = useDemoComparisonRepository(repository, workspace)
  return (
    <WorkspacePage
      workspace={workspace}
      repository={repository}
      comparisonRepository={comparison ?? demoComparison}
      onReenter={onReenter}
      onLeave={onLeave}
      focusOnEntry={focusOnEntry}
    />
  )
}

// Repositories come from main.tsx (src/app/repositories.ts) or a test
// harness, so App never decides between mock and real data.
function App({ repositories }: { repositories: AppRepositories }) {
  const { entrySearch, preview } = repositories
  const [previewActive, setPreviewActive] = useState(preview !== null)
  const [focusAccessOnEntry, setFocusAccessOnEntry] = useState(false)
  const access = useAccess(repositories.access, repositories.entryNotice)

  function reenter() {
    setFocusAccessOnEntry(true)
    clearWorkspaceHistory(entrySearch)
    setPreviewActive(false)
    access.returnToEntry('expired')
  }

  function leave() {
    setFocusAccessOnEntry(true)
    clearWorkspaceHistory(entrySearch)
    setPreviewActive(false)
    access.returnToEntry()
  }

  useEffect(() => {
    if (previewActive || access.stage === 'workspace') return
    const clearHistory = () => clearWorkspaceHistory(entrySearch)
    clearHistory()
    window.addEventListener('popstate', clearHistory)
    return () => window.removeEventListener('popstate', clearHistory)
  }, [previewActive, access.stage, entrySearch])

  if (previewActive && preview) {
    return (
      <WorkspaceSession
        repository={preview.repository}
        comparison={repositories.comparison}
        scenario={preview.scenario}
        onReenter={reenter}
        onLeave={leave}
      />
    )
  }

  if (access.stage === 'entry') {
    return (
      <AccessPage
        code={access.code}
        onCodeChange={access.changeCode}
        onSubmit={() => {
          void access.submit()
        }}
        status={access.status}
        notice={access.notice}
        errorMessage={access.errorMessage}
        focusOnEntry={focusAccessOnEntry}
      />
    )
  }

  if (access.stage === 'notice' || access.stage === 'consent') {
    return (
      <OnboardingPage
        step={access.stage}
        status={access.onboardingStatus}
        errorMessage={access.errorMessage}
        onAcknowledge={access.acknowledge}
        onChoose={(choice) => {
          void access.choose(choice)
        }}
      />
    )
  }

  return access.session ? (
    <WorkspaceSession
      key={access.session.sessionId}
      repository={access.session.repository}
      comparison={repositories.comparison}
      onReenter={reenter}
      onLeave={leave}
      focusOnEntry
    />
  ) : null
}

export default App
