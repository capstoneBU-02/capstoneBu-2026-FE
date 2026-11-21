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
// repositories and their fixtures. Http mode ignores the address.
export async function loadAppRepositories(
  config: ApiConfig,
  search: string,
): Promise<AppRepositories> {
  if (config.mode === 'http') {
    const { createHttpRepositories } = await import('./httpRepositories.ts')
    return createHttpRepositories(config)
  }
  const { createMockRepositories } = await import('./mockRepositories.ts')
  return createMockRepositories(search)
}
