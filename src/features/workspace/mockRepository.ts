import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import {
  checkSongDuration,
  isAllowedSongFile,
  songNameFromFileName,
} from '../add-song/songFile.ts'
import {
  canSendSectionEdit,
  sectionEditKind,
} from '../edit-section/sectionEdit.ts'
import { isTaskInProgress } from './format.ts'
import { createMockAudio } from './mockAudio.ts'
import {
  mockRetriesUsed,
  mockSongs,
  mockTasks,
  mockTaskStates,
  mockTaskStatesRetriesUsed,
} from './mockFixtures.ts'
import type {
  ConsentChoice,
  DemoScenario,
  PreviousTaskResult,
  SavedConsentChoice,
  WorkspaceInfo,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'
import {
  DEMO_PROCESSING_TIMING,
  progressedTask,
  runStates,
  type ProcessingRun,
  type ProcessingTiming,
} from './mockProcessing.ts'
import {
  keptResult,
  mockRetryOf,
  newTaskLabels,
  waitForMockRequest,
} from './mockServer.ts'
import { mockTabInput } from './mockTab.ts'
import { taskStages } from './processing.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

interface MockWorkspaceOptions {
  readonly workspace?: WorkspaceInfo
  // Without explicit songs, only the fixture songs referenced by tasks remain.
  readonly songs?: readonly WorkspaceSong[]
  readonly tasks?: readonly WorkspaceTask[]
  readonly consentChoice?: ConsentChoice
  // Retries each failed task has used; the fixture counts by default.
  readonly retriesUsed?: Readonly<Record<string, number>>
  readonly onConsentSaved?: (choice: SavedConsentChoice) => void
  // The session clock and the pace of queued tasks; tests pass their own.
  readonly now?: () => number
  readonly processingTiming?: ProcessingTiming
}

function fixtureTasks(scenario: DemoScenario): readonly WorkspaceTask[] {
  if (scenario === 'empty') return []
  return scenario === 'task-states' ? mockTaskStates : mockTasks
}

function fixtureRetries(scenario: DemoScenario) {
  return scenario === 'task-states'
    ? mockTaskStatesRetriesUsed
    : mockRetriesUsed
}

export function createMockWorkspaceRepository(
  scenario: DemoScenario = 'default',
  options: MockWorkspaceOptions = {},
): WorkspaceRepository {
  // Each mounted app gets its own mock session; no browser storage or requests.
  let consentChoice: ConsentChoice = options.consentChoice ?? 'undecided'
  const workspace = {
    ...(options.workspace ?? {
      id: 'workspace-demo',
      name: '내 작업',
      testerCode: DEMO_DISPLAY_CONFIG.testerCode,
    }),
  }
  const tasks = (options.tasks ?? fixtureTasks(scenario)).map((task) => ({
    ...task,
  }))
  const songs = (
    options.songs ??
    mockSongs.filter((song) => tasks.some((task) => task.songId === song.id))
  ).map((song) => ({ ...song }))
  let shouldFailNextLoad = scenario === 'error'
  let shouldFailNextTaskLoad = scenario === 'error'
  const audio = createMockAudio()
  // Results kept by 구간 수정, newest first, per task id (D10).
  const previousResults = new Map<string, readonly PreviousTaskResult[]>()
  // Created and changed tasks, in the order they were queued.
  const runs: ProcessingRun[] = []
  const retriesUsed = new Map(
    Object.entries(
      options.retriesUsed ?? (options.tasks ? {} : fixtureRetries(scenario)),
    ),
  )
  const now = options.now ?? Date.now
  const timing = options.processingTiming ?? DEMO_PROCESSING_TIMING
  let addedSongCount = 0
  let createdTaskCount = 0
  let keptResultCount = 0

  function enqueue(task: WorkspaceTask) {
    const song = songs.find((candidate) => candidate.id === task.songId)
    runs.push({
      taskId: task.id,
      enqueuedAt: now(),
      // A retry starts from the stage that failed (JOB-04).
      skipsSeparation:
        song?.inputKind === 'separated-guitar' || task.hasSeparatedAudio,
    })
  }

  // AI_WORKER_* failures can be sent again; a song without guitar cannot.
  function retryOf(task: WorkspaceTask) {
    return mockRetryOf(task, retriesUsed.get(task.id) ?? 0)
  }

  // The task as it stands now, with its place in the list.
  function findCurrent(taskId: string) {
    const index = tasks.findIndex((candidate) => candidate.id === taskId)
    if (index < 0) {
      throw new WorkspaceRepositoryError(
        'task-unavailable',
        '작업을 찾을 수 없어요.',
      )
    }
    return { index, task: currentTasks().tasks[index] }
  }

  // Every read sees the tasks as they stand on the session clock.
  function currentTasks() {
    const states = runStates(runs, now(), timing)
    return {
      states,
      tasks: tasks.map((task) => progressedTask(task, states.get(task.id))),
    }
  }

  function throwIfExpired() {
    if (scenario === 'expired') {
      throw new WorkspaceRepositoryError(
        'expired',
        '작업 공간 이용 기간이 끝났어요.',
      )
    }
  }

  return {
    async loadWorkspace(signal) {
      await waitForMockRequest(350, signal)
      throwIfExpired()

      if (shouldFailNextLoad) {
        shouldFailNextLoad = false
        throw new WorkspaceRepositoryError(
          'load-failed',
          '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.',
        )
      }

      return {
        workspace: { ...workspace },
        songs: songs.map((song) => ({ ...song })),
        tasks: currentTasks().tasks,
        consentChoice,
      }
    },
    async saveConsent(choice, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()

      if (scenario === 'consent-error') {
        throw new WorkspaceRepositoryError(
          'consent-failed',
          '선택을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
        )
      }

      consentChoice = choice
      options.onConsentSaved?.(choice)
      return choice
    },
    async loadTask(taskId, signal) {
      await waitForMockRequest(250, signal)
      throwIfExpired()

      if (shouldFailNextTaskLoad) {
        shouldFailNextTaskLoad = false
        throw new WorkspaceRepositoryError(
          'load-failed',
          '작업을 불러오지 못했어요. 다시 시도해 주세요.',
        )
      }

      const current = currentTasks()
      const task = current.tasks.find((candidate) => candidate.id === taskId)
      const song = songs.find((candidate) => candidate.id === task?.songId)
      if (!task || !song) {
        throw new WorkspaceRepositoryError(
          'task-unavailable',
          '작업을 찾을 수 없어요.',
        )
      }
      const state = current.states.get(taskId)
      return {
        task,
        song: { ...song },
        previousResults: (previousResults.get(taskId) ?? []).map((result) => ({
          ...result,
        })),
        stages: taskStages(task, song.inputKind),
        queueAhead: state?.status === 'queued' ? state.ahead : null,
        retry: retryOf(task),
      }
    },
    async addSong(input, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      // A server checks the file again instead of trusting the client.
      if (
        !isAllowedSongFile(input.file) ||
        checkSongDuration(input.durationSeconds).status !== 'valid'
      ) {
        throw new WorkspaceRepositoryError(
          'add-song-failed',
          '올릴 수 없는 파일이에요.',
        )
      }

      addedSongCount += 1
      const song: WorkspaceSong = {
        id: `song-upload-${addedSongCount}`,
        name: songNameFromFileName(input.file.name),
        fileName: input.file.name,
        inputKind: input.inputKind,
        durationSeconds: input.durationSeconds,
      }
      songs.push(song)
      audio.keepFile(song.id, input.file)
      return { ...song }
    },
    async createTask(input, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const song = songs.find((candidate) => candidate.id === input.songId)
      const labels = newTaskLabels(input, song)
      if (!labels) {
        throw new WorkspaceRepositoryError(
          'create-task-failed',
          '작업을 만들지 못했어요.',
        )
      }

      createdTaskCount += 1
      const task: WorkspaceTask = {
        id: `task-new-${createdTaskCount}`,
        songId: input.songId,
        sectionName: input.sectionName,
        part: input.part,
        tuningId: input.tuningId,
        ...labels,
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
      tasks.push(task)
      enqueue(task)
      return { ...task }
    },
    async reviseTask(taskId, input, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const { index, task } = findCurrent(taskId)
      const song = songs.find((candidate) => candidate.id === task.songId)
      const labels = newTaskLabels({ ...input, songId: task.songId }, song)
      const kind = sectionEditKind(task)
      if (!labels || !kind || !canSendSectionEdit(task, input)) {
        throw new WorkspaceRepositoryError(
          'revise-task-failed',
          '타브를 다시 만들지 못했어요.',
        )
      }

      // A section without guitar had no tab to keep.
      if (kind === 'revise') {
        keptResultCount += 1
        previousResults.set(taskId, [
          keptResult(task, `result-kept-${keptResultCount}`),
          ...(previousResults.get(taskId) ?? []),
        ])
      }
      // A new section is a new stem, so its retries start over.
      retriesUsed.delete(taskId)
      // The new section starts like a created task; its tab, comparisons and
      // copy status went with the previous result.
      const revised: WorkspaceTask = {
        ...task,
        sectionName: input.sectionName,
        part: input.part,
        tuningId: input.tuningId,
        ...labels,
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
      tasks.splice(index, 1, revised)
      enqueue(revised)
      return { ...revised }
    },
    async cancelTask(taskId, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const { index, task } = findCurrent(taskId)
      // STEM_NOT_CANCELABLE: it finished or failed before the request.
      if (!isTaskInProgress(task)) {
        throw new WorkspaceRepositoryError(
          'cancel-task-failed',
          '작업을 멈추지 못했어요.',
        )
      }
      // The task, its separated guitar and its kept results go; the song
      // stays. Its run frees the worker for the ones behind it.
      tasks.splice(index, 1)
      previousResults.delete(taskId)
      retriesUsed.delete(taskId)
      const runIndex = runs.findLastIndex((run) => run.taskId === taskId)
      if (runIndex >= 0)
        runs.splice(runIndex, 1, { ...runs[runIndex], canceledAt: now() })
    },
    async retryTask(taskId, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const { index, task } = findCurrent(taskId)
      const retry = retryOf(task)
      // STEM_NOT_RETRYABLE, RETRY_LIMIT_EXCEEDED or STEM_IN_PROGRESS.
      if (!retry || retry.left === 0) {
        throw new WorkspaceRepositoryError(
          'retry-task-failed',
          '다시 시도하지 못했어요.',
        )
      }

      retriesUsed.set(taskId, retry.limit - retry.left + 1)
      const retried: WorkspaceTask = {
        ...task,
        processingStatus: 'queued',
        failureKind: null,
        progressPercent: null,
        updatedAtLabel: '방금',
      }
      tasks.splice(index, 1, retried)
      enqueue(retried)
      return { ...retried }
    },
    async loadSongAudio(songId, signal) {
      await waitForMockRequest(200, signal)
      throwIfExpired()
      const song = songs.find((candidate) => candidate.id === songId)
      return audio.song(song, signal)
    },
    async loadSeparatedAudio(taskId, signal) {
      await waitForMockRequest(200, signal)
      throwIfExpired()
      const task = currentTasks().tasks.find(
        (candidate) => candidate.id === taskId,
      )
      return audio.separated(task, signal)
    },
    async loadTab(taskId, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const { task } = findCurrent(taskId)
      if (task.processingStatus !== 'completed') {
        throw new WorkspaceRepositoryError(
          'tab-unavailable',
          '타브를 불러오지 못했어요.',
        )
      }
      return mockTabInput(
        task.tuningId,
        task.rangeEndSeconds - task.rangeStartSeconds,
      )
    },
    async saveCopyStatus(taskId, confirmed, signal) {
      await waitForMockRequest(300, signal)
      throwIfExpired()
      const { index, task } = findCurrent(taskId)
      // A task back in the queue has no tab to copy yet.
      if (task.processingStatus !== 'completed') {
        throw new WorkspaceRepositoryError(
          'copy-status-failed',
          '카피 완료를 저장하지 못했어요.',
        )
      }
      const saved: WorkspaceTask = {
        ...task,
        copyStatus: confirmed ? 'confirmed' : 'unreviewed',
      }
      tasks.splice(index, 1, saved)
      return { ...saved }
    },
  }
}
