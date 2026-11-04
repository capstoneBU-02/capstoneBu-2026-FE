import { DEMO_DISPLAY_CONFIG } from '../../app/demoConfig.ts'
import type { ConsentChoice, DemoScenario, WorkspaceTask } from './model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

const mockTasks: readonly WorkspaceTask[] = [
  {
    id: 'task-verse',
    sectionName: '벌스 1',
    songName: 'neon_harbor_live',
    partLabel: '리듬 기타',
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
    songName: 'neon_harbor_live',
    partLabel: '리드 기타',
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
    songName: 'paper_moon_gtr_stem',
    partLabel: '리드 기타',
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
    songName: 'late_train_cover',
    partLabel: '리듬 기타',
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

export function createMockWorkspaceRepository(
  scenario: DemoScenario = 'default',
): WorkspaceRepository {
  // Each mounted app gets its own mock session; no browser storage or requests.
  let consentChoice: ConsentChoice = 'undecided'
  let shouldFailNextLoad = scenario === 'error'

  return {
    async loadWorkspace(signal) {
      await waitForMockRequest(350, signal)

      if (scenario === 'expired') {
        throw new WorkspaceRepositoryError(
          'expired',
          '작업 공간 이용 기간이 끝났어요.',
        )
      }

      if (shouldFailNextLoad) {
        shouldFailNextLoad = false
        throw new WorkspaceRepositoryError(
          'load-failed',
          '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.',
        )
      }

      return {
        workspace: {
          id: 'workspace-demo',
          name: '내 작업',
          testerCode: DEMO_DISPLAY_CONFIG.testerCode,
        },
        tasks:
          scenario === 'empty' ? [] : mockTasks.map((task) => ({ ...task })),
        consentChoice,
      }
    },
    async saveConsent(choice, signal) {
      await waitForMockRequest(300, signal)

      if (scenario === 'expired') {
        throw new WorkspaceRepositoryError(
          'expired',
          '작업 공간 이용 기간이 끝났어요.',
        )
      }

      if (scenario === 'consent-error') {
        throw new WorkspaceRepositoryError(
          'consent-failed',
          '선택을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
        )
      }

      consentChoice = choice
      return choice
    },
  }
}
