// Requests and clocks the mock repository tests share.
import { createMockWorkspaceRepository } from '../../src/features/workspace/mockRepository.ts'
import { SECTION_POLICY } from '../../src/features/new-section/sectionPolicy.ts'

export const signal = () => new AbortController().signal

export const section = (overrides = {}) => ({
  songId: 'song-neon-harbor',
  sectionName: '벌스 2',
  part: 'lead',
  tuningId: SECTION_POLICY.tunings[0].id,
  rangeStartSeconds: 42.1,
  rangeEndSeconds: 65.8,
  ...overrides,
})

export const revision = (overrides = {}) => ({
  sectionName: '벌스 1',
  part: 'rhythm',
  tuningId: 'e-standard',
  rangeStartSeconds: 42.1,
  rangeEndSeconds: 60,
  ...overrides,
})

// A session clock the tests move by hand, with a short processing pace.
export function clockedRepository() {
  const clock = { now: 0 }
  const repository = createMockWorkspaceRepository('default', {
    now: () => clock.now,
    processingTiming: { queueMs: 100, separationMs: 400, transcriptionMs: 600 },
  })
  return { clock, repository }
}

export const stageStatuses = (detail) =>
  detail.stages.map((stage) => `${stage.id}:${stage.status}`)
