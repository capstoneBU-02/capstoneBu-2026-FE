// What the mock repository does in a server's place: the wait of a request,
// the checks a server repeats and the result it keeps on 구간 수정.

import {
  checkSectionRange,
  isPolicySectionName,
} from '../new-section/sectionForm.ts'
import { SECTION_POLICY } from '../new-section/sectionPolicy.ts'
import type {
  NewTaskInput,
  PreviousTaskResult,
  TaskRetry,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'

// JOB-05, D12: three retries after the first run.
const RETRY_LIMIT = 3

// A failed task that found guitar can be sent again until its tries run out.
export function mockRetryOf(
  task: WorkspaceTask,
  used: number,
): TaskRetry | null {
  if (task.processingStatus !== 'failed' || task.failureKind === 'no-guitar')
    return null
  return { left: Math.max(RETRY_LIMIT - used, 0), limit: RETRY_LIMIT }
}

export function waitForMockRequest(milliseconds: number, signal: AbortSignal) {
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
export function newTaskLabels(
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

export function keptResult(
  task: WorkspaceTask,
  id: string,
): PreviousTaskResult {
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
