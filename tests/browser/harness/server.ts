import { songNameFromFileName } from '../../../src/features/add-song/songFile.ts'
import { SECTION_POLICY } from '../../../src/features/new-section/sectionPolicy.ts'
import { isTaskInProgress } from '../../../src/features/workspace/format.ts'
import { mockRetriesUsed } from '../../../src/features/workspace/mockFixtures.ts'
import {
  keptResult,
  mockRetryOf,
} from '../../../src/features/workspace/mockServer.ts'
import { createMockWorkspaceRepository } from '../../../src/features/workspace/mockRepository.ts'
import { taskStages } from '../../../src/features/workspace/processing.ts'
import type {
  NewSongInput,
  NewTaskInput,
  PreviousTaskResult,
  ReviseTaskInput,
  TaskDetail,
  WorkspaceSnapshot,
  WorkspaceSong,
  WorkspaceTask,
} from '../../../src/features/workspace/model.ts'
import { WorkspaceRepositoryError } from '../../../src/features/workspace/repository.ts'
import type { TestControls } from './controls.ts'

// What the server holds for the test page: the scenario from the page's
// address, the fixture workspace, and every change the screen or a test has
// made to it since the page loaded.

export const scenario = new URLSearchParams(window.location.search).get(
  'scenario',
)

const fixture = await createMockWorkspaceRepository().loadWorkspace(
  new AbortController().signal,
)
// odd-task-id: a repository id outside the URL allowlist.
// empty: a workspace without songs or tasks.
export const snapshot: WorkspaceSnapshot =
  scenario === 'odd-task-id'
    ? {
        ...fixture,
        tasks: fixture.tasks.map((task) =>
          task.id === 'task-verse' ? { ...task, id: 'Task_Verse' } : task,
        ),
      }
    : scenario === 'empty'
      ? { ...fixture, songs: [], tasks: [] }
      : fixture

// Songs and tasks added during the test, so created tasks can be opened.
const sessionSongs: WorkspaceSong[] = []
const sessionTasks: WorkspaceTask[] = []
// The file behind each added song, which its audio plays.
const sessionFiles = new Map<string, File>()
// Tasks changed by 구간 수정 and the results each change kept, newest first.
const revisedTasks = new Map<string, WorkspaceTask>()
const keptResults = new Map<string, PreviousTaskResult[]>()
// Tasks ahead of a queued task, as the server reports them.
const queueAhead = new Map<string, number | null>()
// Tasks removed by 멈추기, and the retries the server counts per task.
const canceledTasks = new Set<string>()
const retriesUsed = new Map<string, number>(Object.entries(mockRetriesUsed))

export function findTask(taskId: string): WorkspaceTask | undefined {
  if (canceledTasks.has(taskId)) return undefined
  return (
    revisedTasks.get(taskId) ??
    [...snapshot.tasks, ...sessionTasks].find(
      (candidate) => candidate.id === taskId,
    )
  )
}

export function sessionFile(songId: string): File | undefined {
  return sessionFiles.get(songId)
}

// The list as the server has it now, for the first load and every refresh:
// stopped tasks are gone, and what this or another tab changed or added is
// in.
export function listedSnapshot(): WorkspaceSnapshot {
  return {
    ...snapshot,
    songs: [...snapshot.songs, ...sessionSongs],
    tasks: [...snapshot.tasks, ...sessionTasks].flatMap((task) => {
      const current = findTask(task.id)
      return current ? [current] : []
    }),
  }
}

// The mock's own policy, so the screen is tested against the same numbers.
function retryOf(task: WorkspaceTask) {
  return mockRetryOf(task, retriesUsed.get(task.id) ?? 0)
}

export function taskDetail(taskId: string): TaskDetail | null {
  const task = findTask(taskId)
  const song = [...snapshot.songs, ...sessionSongs].find(
    (candidate) => candidate.id === task?.songId,
  )
  return task && song
    ? {
        task,
        song,
        previousResults: keptResults.get(taskId) ?? [],
        stages: taskStages(task, song.inputKind),
        queueAhead:
          task.processingStatus === 'queued'
            ? (queueAhead.get(taskId) ?? null)
            : null,
        retry: retryOf(task),
      }
    : null
}

let addedSongs = 0

export function addedSong(input: NewSongInput): WorkspaceSong {
  addedSongs += 1
  const song: WorkspaceSong = {
    id: `song-added-${addedSongs}`,
    name: songNameFromFileName(input.file.name),
    fileName: input.file.name,
    inputKind: input.inputKind,
    durationSeconds: input.durationSeconds,
  }
  sessionSongs.push(song)
  sessionFiles.set(song.id, input.file)
  return song
}

function sectionLabels(input: ReviseTaskInput) {
  return {
    part: input.part,
    tuningId: input.tuningId,
    partLabel:
      SECTION_POLICY.parts.find((part) => part.id === input.part)?.label ?? '',
    tuningLabel:
      SECTION_POLICY.tunings.find((tuning) => tuning.id === input.tuningId)
        ?.label ?? '',
  }
}

export function createdTask(input: NewTaskInput): WorkspaceTask {
  const task: WorkspaceTask = {
    id: `task-created-${sessionTasks.length + 1}`,
    songId: input.songId,
    sectionName: input.sectionName,
    ...sectionLabels(input),
    rangeStartSeconds: input.rangeStartSeconds,
    rangeEndSeconds: input.rangeEndSeconds,
    processingStatus: 'queued',
    failureKind: null,
    progressPercent: null,
    hasSeparatedAudio: false,
    comparisonCount: 0,
    copyStatus: 'unreviewed',
    updatedAtLabel: '방금',
  }
  sessionTasks.push(task)
  return task
}

// A finished tab is kept (D10); a section without guitar had none. The new
// section is a new stem, so its retries start over.
export function revisedTask(
  taskId: string,
  input: ReviseTaskInput,
): WorkspaceTask {
  const task = findTask(taskId)!
  const kept = keptResults.get(taskId) ?? []
  if (task.processingStatus === 'completed')
    keptResults.set(taskId, [
      keptResult(task, `kept-${taskId}-${kept.length + 1}`),
      ...kept,
    ])
  retriesUsed.delete(taskId)
  const revised: WorkspaceTask = {
    ...task,
    sectionName: input.sectionName,
    ...sectionLabels(input),
    rangeStartSeconds: input.rangeStartSeconds,
    rangeEndSeconds: input.rangeEndSeconds,
    processingStatus: 'queued',
    failureKind: null,
    progressPercent: null,
    hasSeparatedAudio: false,
    comparisonCount: 0,
    copyStatus: 'unreviewed',
    updatedAtLabel: '방금',
  }
  revisedTasks.set(taskId, revised)
  return revised
}

export function canceledTask(taskId: string) {
  const task = findTask(taskId)
  if (!task || !isTaskInProgress(task))
    throw new WorkspaceRepositoryError('cancel-task-failed', 'Not running')
  canceledTasks.add(taskId)
}

export function retriedTask(taskId: string): WorkspaceTask {
  const task = findTask(taskId)
  const retry = task && retryOf(task)
  if (!task || !retry || retry.left === 0)
    throw new WorkspaceRepositoryError('retry-task-failed', 'Cannot retry')
  retriesUsed.set(taskId, (retriesUsed.get(taskId) ?? 0) + 1)
  const retried: WorkspaceTask = {
    ...task,
    processingStatus: 'queued',
    failureKind: null,
    progressPercent: null,
    updatedAtLabel: '방금',
  }
  revisedTasks.set(taskId, retried)
  return retried
}

// 카피 완료 is kept for a finished task only (COPY-04).
export function copiedTask(taskId: string, confirmed: boolean): WorkspaceTask {
  const task = findTask(taskId)
  if (!task)
    throw new WorkspaceRepositoryError('task-unavailable', 'Unavailable')
  if (task.processingStatus !== 'completed')
    throw new WorkspaceRepositoryError('copy-status-failed', 'Not finished')
  const saved: WorkspaceTask = {
    ...task,
    copyStatus: confirmed ? 'confirmed' : 'unreviewed',
  }
  revisedTasks.set(taskId, saved)
  return saved
}

export const serverControls = {
  setRetriesUsed(taskId, used) {
    retriesUsed.set(taskId, used)
  },
  createTaskOnServer(input) {
    createdTask(input)
  },
  queueTaskOnServer(taskId) {
    const task = findTask(taskId)
    if (task) revisedTasks.set(taskId, { ...task, processingStatus: 'queued' })
  },
  reviseTaskOnServer(taskId, input) {
    if (findTask(taskId)) revisedTask(taskId, input)
  },
  updateTaskOnServer(taskId, { queueAhead: ahead, ...change }) {
    const task = findTask(taskId)
    if (task) revisedTasks.set(taskId, { ...task, ...change })
    if (ahead !== undefined) queueAhead.set(taskId, ahead)
  },
} satisfies Partial<TestControls>
