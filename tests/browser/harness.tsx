import { Profiler, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MediaDurationError,
  type MediaDurationProbe,
} from '../../src/features/add-song/mediaDuration.ts'
import { songNameFromFileName } from '../../src/features/add-song/songFile.ts'
import { isPolicySectionName } from '../../src/features/new-section/sectionForm.ts'
import { createDemoSongAudio } from '../../src/features/workspace/demoSongAudio.ts'
import { SECTION_POLICY } from '../../src/features/new-section/sectionPolicy.ts'
import { WorkspacePage } from '../../src/features/workspace/WorkspacePage.tsx'
import { createMockWorkspaceRepository } from '../../src/features/workspace/mockRepository.ts'
import type {
  NewSongInput,
  NewTaskInput,
  PreviousTaskResult,
  ReviseTaskInput,
  SavedConsentChoice,
  SongInputKind,
  TaskDetail,
  WorkspaceSnapshot,
  WorkspaceSong,
  WorkspaceTask,
} from '../../src/features/workspace/model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../../src/features/workspace/repository.ts'
import { useWorkspace } from '../../src/features/workspace/useWorkspace.ts'
import '../../src/index.css'

interface TestControls {
  releaseLoads(): void
  resolveSave(): void
  rejectSave(): void
  switchWorkspace(): void
  saveTwice(): void
  saveCalls(): number
  // Task detail requests stay pending in the pending-task scenario so tests
  // can settle them out of order.
  resolveTask(taskId: string): void
  failTask(taskId: string, code: 'load-failed' | 'task-unavailable'): void
  taskCalls(): string[]
  // pending-add keeps addSong requests open until settled here.
  resolveAdd(): void
  failAdd(code: 'add-song-failed' | 'expired'): void
  addCalls(): Array<{
    fileName: string
    inputKind: SongInputKind
    durationSeconds: number
  }>
  // pending-create keeps createTask requests open until settled here.
  resolveCreate(): void
  failCreate(code: 'create-task-failed' | 'expired'): void
  createCalls(): NewTaskInput[]
  // pending-revise keeps reviseTask requests open until settled here.
  resolveRevise(): void
  failRevise(code: 'revise-task-failed' | 'expired'): void
  reviseCalls(): Array<{ taskId: string; input: ReviseTaskInput }>
  // Queues a task on the server only, as another tab's change would. The
  // loaded list keeps showing its old state.
  queueTaskOnServer(taskId: string): void
  // slow.mp3 duration reads stay pending until resolved here.
  resolveProbe(seconds: number): void
  probeCalls(): string[]
  // Song audio requests and whether the screen has cancelled each one.
  audioCalls(): Array<{ songId: string; aborted: boolean }>
  // audio-error serves playable audio from here on.
  healAudio(): void
  // The state of every playback output opened so far.
  audioContexts(): AudioContextState[]
  // Every sound source started so far, oldest first.
  audioSources(): Array<{ loop: boolean; loopStart: number; loopEnd: number }>
  // The latest output's volume; null before the first play.
  outputGain(): number | null
  // React commits anywhere in the page since it loaded.
  commits(): number
}

declare global {
  interface Window {
    workspaceTest: TestControls
  }
}

// The harness renders production hooks/components. Only the async boundary is
// controlled; ignoring AbortSignal here exercises stale-response protection.
const scenario = new URLSearchParams(window.location.search).get('scenario')
const fixture = await createMockWorkspaceRepository().loadWorkspace(
  new AbortController().signal,
)
// odd-task-id: a repository id outside the URL allowlist.
// empty: a workspace without songs or tasks.
const snapshot: WorkspaceSnapshot =
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
const pendingLoads: Array<(snapshot: WorkspaceSnapshot) => void> = []
let saveCalls = 0
const taskCalls: string[] = []
const pendingTasks: Array<{
  taskId: string
  resolve: (detail: TaskDetail) => void
  reject: (error: Error) => void
}> = []

// Songs and tasks added during the test, so created tasks can be opened.
const sessionSongs: WorkspaceSong[] = []
const sessionTasks: WorkspaceTask[] = []
// Tasks changed by 구간 수정 and the results each change kept, newest first.
const revisedTasks = new Map<string, WorkspaceTask>()
const keptResults = new Map<string, PreviousTaskResult[]>()

function findTask(taskId: string): WorkspaceTask | undefined {
  return (
    revisedTasks.get(taskId) ??
    [...snapshot.tasks, ...sessionTasks].find(
      (candidate) => candidate.id === taskId,
    )
  )
}

function taskDetail(taskId: string): TaskDetail | null {
  const task = findTask(taskId)
  const song = [...snapshot.songs, ...sessionSongs].find(
    (candidate) => candidate.id === task?.songId,
  )
  return task && song
    ? { task, song, previousResults: keptResults.get(taskId) ?? [] }
    : null
}

// StrictMode issues an aborted duplicate request in development; settle every
// pending request for the id so the current one is always included.
function settleTask(
  taskId: string,
  settle: (entry: (typeof pendingTasks)[number]) => void,
) {
  for (let index = pendingTasks.length - 1; index >= 0; index -= 1) {
    if (pendingTasks[index].taskId === taskId)
      settle(pendingTasks.splice(index, 1)[0])
  }
}
// Durations by file name; unknown names are unreadable. Decoding is faked
// because Playwright's Chromium may lack MP4 codecs (see real-probe tests).
const PROBE_OUTCOMES: Record<string, number | 'error' | 'pending'> = {
  'neon_harbor_live.mp3': 252.4,
  'fresh_riff.mp3': 140.2,
  'late_train_cover.mp4': 238,
  'long_jam_take3.mp4': 391,
  'broken.mp3': 'error',
  'slow.mp3': 'pending',
}
const probeCalls: string[] = []
const pendingProbes: Array<(seconds: number) => void> = []
// Ignores AbortSignal so late results exercise stale-result protection.
const fakeProbe: MediaDurationProbe = (file) => {
  const name = file instanceof File ? file.name : ''
  probeCalls.push(name)
  const outcome = PROBE_OUTCOMES[name]
  if (outcome === 'pending')
    return new Promise((resolve) => pendingProbes.push(resolve))
  if (typeof outcome === 'number') return Promise.resolve(outcome)
  return Promise.reject(new MediaDurationError('unreadable'))
}

const addCalls: Array<{
  fileName: string
  inputKind: SongInputKind
  durationSeconds: number
}> = []
const pendingAdds: Array<{
  input: NewSongInput
  resolve: (song: WorkspaceSong) => void
  reject: (error: Error) => void
}> = []
let addedSongs = 0

function addedSong(input: NewSongInput): WorkspaceSong {
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

const createCalls: NewTaskInput[] = []
const pendingCreates: Array<{
  input: NewTaskInput
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

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

function createdTask(input: NewTaskInput): WorkspaceTask {
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

const reviseCalls: Array<{ taskId: string; input: ReviseTaskInput }> = []
const pendingRevises: Array<{
  taskId: string
  input: ReviseTaskInput
  resolve: (task: WorkspaceTask) => void
  reject: (error: Error) => void
}> = []

function revisedTask(taskId: string, input: ReviseTaskInput): WorkspaceTask {
  const task = findTask(taskId)!
  keptResults.set(taskId, [
    {
      id: `kept-${taskId}-${(keptResults.get(taskId)?.length ?? 0) + 1}`,
      sectionName: task.sectionName,
      partLabel: task.partLabel,
      tuningLabel: task.tuningLabel,
      rangeStartSeconds: task.rangeStartSeconds,
      rangeEndSeconds: task.rangeEndSeconds,
      comparisonCount: task.comparisonCount,
      copyStatus: task.copyStatus,
    },
    ...(keptResults.get(taskId) ?? []),
  ])
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

// Fixture songs play the mock's synthesized demo; added songs play their file.
// audio-error serves bytes no browser decodes; pending-audio never answers;
// short-audio decodes two seconds shorter than the song's listed length.
const audioCalls: Array<{ songId: string; signal: AbortSignal }> = []
const sessionFiles = new Map<string, File>()
let audioBroken = scenario === 'audio-error'

function songAudio(songId: string, signal: AbortSignal): Promise<Blob> {
  audioCalls.push({ songId, signal })
  if (scenario === 'audio-expired')
    return Promise.reject(
      new WorkspaceRepositoryError('expired', 'Expired while loading audio'),
    )
  if (scenario === 'pending-audio') return new Promise(() => {})
  if (audioBroken)
    return Promise.resolve(new Blob(['not audio'], { type: 'audio/wav' }))
  const file = sessionFiles.get(songId)
  if (file) return Promise.resolve(file)
  const song = snapshot.songs.find((candidate) => candidate.id === songId)
  const decodedSeconds =
    scenario === 'short-audio' ? (song?.durationSeconds ?? 0) - 2 : undefined
  return song
    ? createDemoSongAudio(
        song.id,
        decodedSeconds ?? song.durationSeconds,
        signal,
      )
    : Promise.reject(
        new WorkspaceRepositoryError('audio-unavailable', 'Unavailable'),
      )
}

// Records each playback output, its sources and its volume, so tests can
// check what really plays.
const audioContexts: AudioContext[] = []
const audioSources: AudioBufferSourceNode[] = []
const audioGains: GainNode[] = []
const NativeAudioContext = window.AudioContext
window.AudioContext = class RecordedAudioContext extends NativeAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options)
    audioContexts.push(this)
  }
  createBufferSource() {
    const source = super.createBufferSource()
    audioSources.push(source)
    return source
  }
  createGain() {
    const gain = super.createGain()
    audioGains.push(gain)
    return gain
  }
}
let commits = 0

let pendingSave:
  | {
      choice: SavedConsentChoice
      resolve: (choice: SavedConsentChoice) => void
      reject: (error: Error) => void
    }
  | undefined

const repository: WorkspaceRepository = {
  loadWorkspace() {
    if (scenario === 'pending-load') {
      return new Promise((resolve) => pendingLoads.push(resolve))
    }
    return Promise.resolve(snapshot)
  },
  saveConsent(choice) {
    saveCalls += 1
    if (scenario === 'save-expired') {
      return Promise.reject(
        new WorkspaceRepositoryError('expired', 'Expired while saving'),
      )
    }
    return new Promise((resolve, reject) => {
      pendingSave = { choice, resolve, reject }
    })
  },
  loadTask(taskId) {
    taskCalls.push(taskId)
    if (scenario === 'pending-task') {
      return new Promise((resolve, reject) =>
        pendingTasks.push({ taskId, resolve, reject }),
      )
    }
    const detail = taskDetail(taskId)
    return detail
      ? Promise.resolve(detail)
      : Promise.reject(
          new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
        )
  },
  addSong(input) {
    addCalls.push({
      fileName: input.file.name,
      inputKind: input.inputKind,
      durationSeconds: input.durationSeconds,
    })
    if (scenario === 'pending-add') {
      return new Promise((resolve, reject) =>
        pendingAdds.push({ input, resolve, reject }),
      )
    }
    return Promise.resolve(addedSong(input))
  },
  createTask(input) {
    createCalls.push({ ...input })
    // Like the mock repository, refuse names the screen cannot compose.
    if (!isPolicySectionName(input.sectionName))
      return Promise.reject(
        new WorkspaceRepositoryError('create-task-failed', 'Bad name'),
      )
    if (scenario === 'pending-create') {
      return new Promise((resolve, reject) =>
        pendingCreates.push({ input, resolve, reject }),
      )
    }
    return Promise.resolve(createdTask(input))
  },
  reviseTask(taskId, input) {
    reviseCalls.push({ taskId, input: { ...input } })
    if (!findTask(taskId))
      return Promise.reject(
        new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
      )
    if (!isPolicySectionName(input.sectionName))
      return Promise.reject(
        new WorkspaceRepositoryError('revise-task-failed', 'Bad name'),
      )
    if (scenario === 'pending-revise') {
      return new Promise((resolve, reject) =>
        pendingRevises.push({ taskId, input, resolve, reject }),
      )
    }
    return Promise.resolve(revisedTask(taskId, input))
  },
  loadSongAudio: songAudio,
}

const secondRepository: WorkspaceRepository = {
  loadWorkspace() {
    return Promise.resolve({
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        id: 'second-workspace',
        name: '두 번째 작업 공간',
      },
      songs: [],
      tasks: [],
      consentChoice: 'undecided',
    })
  },
  saveConsent: (choice) => Promise.resolve(choice),
  loadTask: () =>
    Promise.reject(
      new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
    ),
  addSong: () =>
    Promise.reject(
      new WorkspaceRepositoryError('add-song-failed', 'Unavailable'),
    ),
  createTask: () =>
    Promise.reject(
      new WorkspaceRepositoryError('create-task-failed', 'Unavailable'),
    ),
  reviseTask: () =>
    Promise.reject(
      new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
    ),
  loadSongAudio: () =>
    Promise.reject(
      new WorkspaceRepositoryError('audio-unavailable', 'Unavailable'),
    ),
}

window.workspaceTest = {
  releaseLoads() {
    pendingLoads.splice(0).forEach((resolve) => resolve(snapshot))
  },
  resolveSave() {
    pendingSave?.resolve(pendingSave.choice)
  },
  rejectSave() {
    pendingSave?.reject(
      new WorkspaceRepositoryError('consent-failed', 'Save failed'),
    )
  },
  switchWorkspace() {},
  saveTwice() {},
  saveCalls: () => saveCalls,
  resolveTask(taskId) {
    settleTask(taskId, (entry) => {
      const detail = taskDetail(taskId)
      if (detail) entry.resolve(detail)
      else
        entry.reject(
          new WorkspaceRepositoryError('task-unavailable', 'Unavailable'),
        )
    })
  },
  failTask(taskId, code) {
    settleTask(taskId, (entry) =>
      entry.reject(new WorkspaceRepositoryError(code, 'Task failed')),
    )
  },
  taskCalls: () => [...taskCalls],
  resolveAdd() {
    pendingAdds
      .splice(0)
      .forEach(({ input, resolve }) => resolve(addedSong(input)))
  },
  failAdd(code) {
    pendingAdds
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Add failed')),
      )
  },
  addCalls: () => addCalls.map((call) => ({ ...call })),
  // StrictMode may leave an aborted duplicate; settle every pending request.
  resolveCreate() {
    pendingCreates
      .splice(0)
      .forEach(({ input, resolve }) => resolve(createdTask(input)))
  },
  failCreate(code) {
    pendingCreates
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Create failed')),
      )
  },
  createCalls: () => createCalls.map((call) => ({ ...call })),
  // StrictMode may leave an aborted duplicate; settle every pending request.
  resolveRevise() {
    pendingRevises
      .splice(0)
      .forEach(({ taskId, input, resolve }) =>
        resolve(revisedTask(taskId, input)),
      )
  },
  failRevise(code) {
    pendingRevises
      .splice(0)
      .forEach(({ reject }) =>
        reject(new WorkspaceRepositoryError(code, 'Revise failed')),
      )
  },
  reviseCalls: () =>
    reviseCalls.map(({ taskId, input }) => ({ taskId, input: { ...input } })),
  queueTaskOnServer(taskId) {
    const task = findTask(taskId)
    if (task) revisedTasks.set(taskId, { ...task, processingStatus: 'queued' })
  },
  resolveProbe(seconds) {
    pendingProbes.splice(0).forEach((resolve) => resolve(seconds))
  },
  probeCalls: () => [...probeCalls],
  audioCalls: () =>
    audioCalls.map(({ songId, signal }) => ({
      songId,
      aborted: signal.aborted,
    })),
  healAudio() {
    audioBroken = false
  },
  audioContexts: () => audioContexts.map((context) => context.state),
  audioSources: () =>
    audioSources.map(({ loop, loopStart, loopEnd }) => ({
      loop,
      loopStart,
      loopEnd,
    })),
  outputGain: () => audioGains.at(-1)?.gain.value ?? null,
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
