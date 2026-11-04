import { useState } from 'react'
import { readAppMode } from './app/demoConfig.ts'
import { AccessPage } from './features/access/AccessPage.tsx'
import { createMockAccessRepository } from './features/access/mockRepository.ts'
import type { AccessRepository } from './features/access/repository.ts'
import { useAccess } from './features/access/useAccess.ts'
import { OnboardingPage } from './features/onboarding/OnboardingPage.tsx'
import type { DemoScenario } from './features/workspace/model.ts'
import { createMockWorkspaceRepository } from './features/workspace/mockRepository.ts'
import type { WorkspaceRepository } from './features/workspace/repository.ts'
import { useWorkspace } from './features/workspace/useWorkspace.ts'
import { WorkspacePage } from './features/workspace/WorkspacePage.tsx'

function WorkspaceSession({
  repository,
  scenario = 'default',
  onReenter,
  focusOnEntry = false,
}: {
  repository: WorkspaceRepository
  scenario?: DemoScenario
  onReenter(): void
  focusOnEntry?: boolean
}) {
  const workspace = useWorkspace(repository, scenario)
  return (
    <WorkspacePage
      workspace={workspace}
      onReenter={onReenter}
      focusOnEntry={focusOnEntry}
    />
  )
}

function App({
  accessRepository,
}: { accessRepository?: AccessRepository } = {}) {
  const [configuration] = useState(() => {
    const mode = readAppMode(window.location.search)
    return {
      mode,
      accessRepository: createMockAccessRepository(
        mode.kind === 'access' ? mode.scenario : 'default',
      ),
      previewRepository:
        mode.kind === 'workspace'
          ? createMockWorkspaceRepository(mode.scenario)
          : null,
    }
  })
  const [previewActive, setPreviewActive] = useState(
    configuration.mode.kind === 'workspace',
  )
  const access = useAccess(
    accessRepository ?? configuration.accessRepository,
    configuration.mode.kind === 'access' &&
      configuration.mode.scenario === 'session-expired'
      ? 'expired'
      : null,
  )

  function reenter() {
    setPreviewActive(false)
    access.returnToEntry('expired')
  }

  if (
    previewActive &&
    configuration.previewRepository &&
    configuration.mode.kind === 'workspace'
  ) {
    return (
      <WorkspaceSession
        repository={configuration.previewRepository}
        scenario={configuration.mode.scenario}
        onReenter={reenter}
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
      onReenter={reenter}
      focusOnEntry
    />
  ) : null
}

export default App
