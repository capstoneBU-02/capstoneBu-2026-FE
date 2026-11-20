import { createMockAccessRepository } from '../features/access/mockRepository.ts'
import { createMockWorkspaceRepository } from '../features/workspace/mockRepository.ts'
import { readAppMode } from './demoConfig.ts'
import type { AppRepositories } from './repositories.ts'

// Mock mode: ?access= picks an entry scenario, ?demo= opens a workspace
// preview without entering a code.
export function createMockRepositories(search: string): AppRepositories {
  const mode = readAppMode(search, 'mock')
  if (mode.kind === 'workspace') {
    return {
      access: createMockAccessRepository(),
      entryNotice: null,
      entrySearch: '',
      preview: {
        repository: createMockWorkspaceRepository(mode.scenario),
        scenario: mode.scenario,
      },
    }
  }
  return {
    access: createMockAccessRepository(mode.scenario),
    entryNotice: mode.scenario === 'session-expired' ? 'expired' : null,
    entrySearch: mode.scenario === 'default' ? '' : `?access=${mode.scenario}`,
    preview: null,
  }
}
