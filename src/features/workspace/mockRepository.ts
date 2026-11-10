import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import {
  checkSongDuration,
  isAllowedSongFile,
  songNameFromFileName,
} from '../add-song/songFile.ts'
import {
  canReviseSection,
  changesSectionResult,
} from '../edit-section/sectionEdit.ts'
import {
  checkSectionRange,
  isPolicySectionName,
} from '../new-section/sectionForm.ts'
import { SECTION_POLICY } from '../new-section/sectionPolicy.ts'
import { createMockAudio } from './mockAudio.ts'
import { mockSongs, mockTasks } from './mockFixtures.ts'
import type {
  ConsentChoice,
  DemoScenario,
  NewTaskInput,
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
import { taskStages } from './processing.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

function waitForMockRequest(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)

    function abort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
    }

    signal.addEventListener('abort', abort, { once: true })
  })
}

// A server would refuse what the screen should never have sent.
function newTaskLabels(
  input: NewTaskInput,
  song: WorkspaceSong | undefined,
): { partLabel: string; tuningLabel: string } | null {
  const part = SECTION_POLICY.parts.find((option) => option.id === input.part)
  const tuning = SECTION_POLICY.tunings.find(
    (option) => option.id === input.tuningId,
  )
  const valid =
    song !== undefined &&
    part !== undefined &&
    tuning !== undefined &&
    isPolicySectionName(input.sectionName) &&
    checkSectionRange(
      input.rangeStartSeconds,
      input.rangeEndSeconds,
      song.durationSeconds,
    )
  return valid ? { partLabel: part.label, tuningLabel: tuning.label } : null
}

function keptResult(task: WorkspaceTask, id: string): PreviousTaskResult {
  return {
    id,
    sectionName: task.sectionName,
    partLabel: task.partLabel,
    tuningLabel: task.tuningLabel,
    rangeStartSeconds: task.rangeStartSeconds,
    rangeEndSeconds: task.rangeEndSeconds,
    comparisonCount: task.comparisonCount,
    copyStatus: task.copyStatus,
  }
}

interface MockWorkspaceOptions {
  readonly workspace?: WorkspaceInfo
  // Without explicit songs, only the fixture songs referenced by tasks remain.
  readonly songs?: readonly WorkspaceSong[]
  readonly tasks?: readonly WorkspaceTask[]
  readonly consentChoice?: ConsentChoice
  readonly onConsentSaved?: (choice: SavedConsentChoice) => void
  // The session clock and the pace of queued tasks; tests pass their own.
  readonly now?: () => number
  readonly processingTiming?: ProcessingTiming
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
  const tasks = (options.tasks ?? (scenario === 'empty' ? [] : mockTasks)).map(
    (task) => ({ ...task }),
  )
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
      skipsSeparation: song?.inputKind === 'separated-guitar',
    })
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
      const index = tasks.findIndex((candidate) => candidate.id === taskId)
      if (index < 0) {
        throw new WorkspaceRepositoryError(
          'task-unavailable',
          '작업을 찾을 수 없어요.',
        )
      }
      const task = currentTasks().tasks[index]
      const song = songs.find((candidate) => candidate.id === task.songId)
      const labels = newTaskLabels({ ...input, songId: task.songId }, song)
      if (
        !labels ||
        !canReviseSection(task) ||
        !changesSectionResult(task, input)
      ) {
        throw new WorkspaceRepositoryError(
          'revise-task-failed',
          '타브를 다시 만들지 못했어요.',
        )
      }

      keptResultCount += 1
      previousResults.set(taskId, [
        keptResult(task, `result-kept-${keptResultCount}`),
        ...(previousResults.get(taskId) ?? []),
      ])
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
  }
}
