import type { ApiConfig } from '../api/config.ts'
import type { AccessRepository } from '../features/access/repository.ts'
import type { DemoScenario } from '../features/workspace/model.ts'
import type { WorkspaceRepository } from '../features/workspace/repository.ts'

// Everything App needs from the outside world, chosen once at startup.
export interface AppRepositories {
  readonly access: AccessRepository
  // Shown on the code entry screen before anything happens.
  readonly entryNotice: 'expired' | null
  // Kept in the address when leaving the workspace.
  readonly entrySearch: string
  // A workspace opened directly from the address (mock only).
  readonly preview: {
    readonly repository: WorkspaceRepository
    readonly scenario: DemoScenario
  } | null
}

// Each mode lives in its own chunk, so an http build never downloads the mock
// repositories and their fixtures.
export async function loadAppRepositories(
  { mode }: Pick<ApiConfig, 'mode'>,
  search: string,
): Promise<AppRepositories> {
  if (mode === 'http') {
    throw new Error(
      'VITE_API_MODE=http has no repositories yet. Run with VITE_API_MODE=mock.',
    )
  }
  const { createMockRepositories } = await import('./mockRepositories.ts')
  return createMockRepositories(search)
}
