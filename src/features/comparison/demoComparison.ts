import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceSong, WorkspaceTask } from '../workspace/model.ts'
import type { WorkspaceRepository } from '../workspace/repository.ts'
import {
  createMockComparisonRepository,
  type MockComparisonSection,
} from './mockComparisonRepository.ts'
import type { PlaybackTrackKind, SavedPerformance } from './model.ts'
import type {
  ComparisonOutcome,
  ComparisonTiming,
} from './mockComparisonRun.ts'
import type { ComparisonRepository } from './repository.ts'

// Stands in for the comparison API until it is connected: the mock answers
// from the tasks and audio the workspace already has.

type DemoAudio = Pick<
  WorkspaceRepository,
  'loadSongAudio' | 'loadSeparatedAudio'
>

export interface DemoComparisonTask {
  readonly task: Pick<
    WorkspaceTask,
    | 'id'
    | 'songId'
    | 'rangeStartSeconds'
    | 'rangeEndSeconds'
    | 'hasSeparatedAudio'
  >
  readonly song: Pick<WorkspaceSong, 'id' | 'inputKind'>
}

export function demoComparisonSection({
  task,
  song,
}: DemoComparisonTask): MockComparisonSection {
  return {
    rangeStartSeconds: task.rangeStartSeconds,
    rangeEndSeconds: task.rangeEndSeconds,
    // An uploaded guitar needs no separation (JOB-02).
    hasSeparatedAudio:
      song.inputKind === 'separated-guitar' || task.hasSeparatedAudio,
    inputKind: song.inputKind,
  }
}

export function createDemoComparisonRepository({
  audio,
  findTask,
  timing,
  requestDelayMs,
  outcomesFor,
  unavailableTracks,
}: {
  audio: DemoAudio
  findTask: (taskId: string) => DemoComparisonTask | undefined
  timing?: ComparisonTiming
  requestDelayMs?: number
  outcomesFor?: (performance: SavedPerformance) => readonly ComparisonOutcome[]
  unavailableTracks?: readonly PlaybackTrackKind[]
}): ComparisonRepository {
  return createMockComparisonRepository({
    timing,
    requestDelayMs,
    outcomesFor,
    unavailableTracks,
    sectionOf(taskId) {
      const found = findTask(taskId)
      return found && demoComparisonSection(found)
    },
    loadBaselineAudio(taskId, kind, signal) {
      const song = findTask(taskId)?.song
      return kind === 'stem' && song?.inputKind !== 'separated-guitar'
        ? audio.loadSeparatedAudio(taskId, signal)
        : audio.loadSongAudio(song?.id ?? '', signal)
    },
  })
}

interface DemoWorkspace {
  readonly songs: readonly WorkspaceSong[]
  readonly tasks: readonly WorkspaceTask[]
}

function createTaskLookup(first: DemoWorkspace) {
  let current = first
  return {
    update(next: DemoWorkspace) {
      current = next
    },
    find(taskId: string): DemoComparisonTask | undefined {
      const task = current.tasks.find(({ id }) => id === taskId)
      const song = current.songs.find(({ id }) => id === task?.songId)
      return task && song ? { task, song } : undefined
    },
  }
}

// One mock per workspace, so a take outlives leaving its task. It reads the
// workspace as it is at the time of each request.
export function useDemoComparisonRepository(
  repository: WorkspaceRepository,
  workspace: DemoWorkspace,
): ComparisonRepository {
  const [lookup] = useState(() => createTaskLookup(workspace))
  useEffect(() => {
    lookup.update(workspace)
  }, [lookup, workspace])
  return useMemo(
    () =>
      createDemoComparisonRepository({
        audio: repository,
        findTask: lookup.find,
      }),
    [lookup, repository],
  )
}
