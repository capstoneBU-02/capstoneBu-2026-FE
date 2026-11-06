import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import {
  checkSongDuration,
  isAllowedSongFile,
  songNameFromFileName,
} from '../add-song/songFile.ts'
import {
  checkSectionRange,
  isPolicySectionName,
} from '../new-section/sectionForm.ts'
import { SECTION_POLICY } from '../new-section/sectionPolicy.ts'
import type {
  ConsentChoice,
  DemoScenario,
  NewTaskInput,
  SavedConsentChoice,
  WorkspaceInfo,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

const mockSongs: readonly WorkspaceSong[] = [
  {
    id: 'song-neon-harbor',
    name: 'neon_harbor_live',
    fileName: 'neon_harbor_live.mp3',
    inputKind: 'original',
    durationSeconds: 252,
  },
  {
    id: 'song-paper-moon',
    name: 'paper_moon_gtr_stem',
    fileName: 'paper_moon_gtr_stem.mp3',
    inputKind: 'separated-guitar',
    durationSeconds: 96,
  },
  {
    id: 'song-late-train',
    name: 'late_train_cover',
    fileName: 'late_train_cover.mp4',
    inputKind: 'original',
    durationSeconds: 238,
  },
]

const mockTasks: readonly WorkspaceTask[] = [
  {
    id: 'task-verse',
    sectionName: '벌스 1',
    songId: 'song-neon-harbor',
    partLabel: '리듬 기타',
    tuningLabel: 'E 표준 6현',
    rangeStartSeconds: 42.1,
    rangeEndSeconds: 65.8,
    processingStatus: 'completed',
    failureKind: null,
    progressPercent: null,
    hasSeparatedAudio: true,
    comparisonCount: 2,
    copyStatus: 'confirmed',
    updatedAtLabel: '오늘 21:40',
  },
  {
    id: 'task-solo',
    sectionName: '솔로',
    songId: 'song-neon-harbor',
    partLabel: '리드 기타',
    tuningLabel: 'E 표준 6현',
    rangeStartSeconds: 151,
    rangeEndSeconds: 172.4,
    processingStatus: 'processing',
    failureKind: null,
    progressPercent: 64,
    hasSeparatedAudio: true,
    comparisonCount: 0,
    copyStatus: 'unreviewed',
    updatedAtLabel: '방금',
  },
  {
    id: 'task-intro',
    sectionName: '인트로',
    songId: 'song-paper-moon',
    partLabel: '리드 기타',
    tuningLabel: 'E 표준 6현',
    rangeStartSeconds: 0,
    rangeEndSeconds: 18.2,
    processingStatus: 'failed',
    failureKind: 'transcription',
    progressPercent: null,
    hasSeparatedAudio: true,
    comparisonCount: 0,
    copyStatus: 'needs-review',
    updatedAtLabel: '어제',
  },
  {
    id: 'task-chorus',
    sectionName: '코러스 2',
    songId: 'song-late-train',
    partLabel: '리듬 기타',
    tuningLabel: 'E 표준 6현',
    rangeStartSeconds: 190,
    rangeEndSeconds: 211,
    processingStatus: 'failed',
    failureKind: 'no-guitar',
    progressPercent: null,
    hasSeparatedAudio: false,
    comparisonCount: 0,
    copyStatus: 'needs-review',
    updatedAtLabel: '10월 25일',
  },
]

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

interface MockWorkspaceOptions {
  readonly workspace?: WorkspaceInfo
  // Without explicit songs, only the fixture songs referenced by tasks remain.
  readonly songs?: readonly WorkspaceSong[]
  readonly tasks?: readonly WorkspaceTask[]
  readonly consentChoice?: ConsentChoice
  readonly onConsentSaved?: (choice: SavedConsentChoice) => void
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
  // Added files live only in this session's memory for later playback (#16).
  const songFiles = new Map<string, File>()
  let addedSongCount = 0
  let createdTaskCount = 0

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
        tasks: tasks.map((task) => ({ ...task })),
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

      const task = tasks.find((candidate) => candidate.id === taskId)
      const song = songs.find((candidate) => candidate.id === task?.songId)
      if (!task || !song) {
        throw new WorkspaceRepositoryError(
          'task-unavailable',
          '작업을 찾을 수 없어요.',
        )
      }
      return { task: { ...task }, song: { ...song } }
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
      songFiles.set(song.id, input.file)
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
      return { ...task }
    },
  }
}
