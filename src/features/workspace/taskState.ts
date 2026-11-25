// The screen's task as the processing status reports it. The server keeps
// the stem and the tab apart; the screen shows them as one task with two
// stages (JOB-01).

import type {
  FailureView,
  ProcessingStatusResponse,
  StemStatusView,
  TabStatusView,
} from './apiTypes.ts'
import type {
  SongInputKind,
  TaskRetry,
  TaskStage,
  TaskStageStatus,
  WorkspaceTask,
} from './model.ts'

export interface TaskState {
  readonly task: WorkspaceTask
  readonly stages: readonly TaskStage[]
  readonly retry: TaskRetry | null
}

type Status = Pick<ProcessingStatusResponse, 'stem' | 'tab'>

// A result the server wants checked is still a result.
export const isWorkReady = (
  status: StemStatusView['status'] | TabStatusView['status'],
) => status === 'success' || status === 'needs_review'

// Not started: not requested yet, or queued before its first stage. Between
// two stages the status is queued again with the finished stage kept.
const notStarted = (work: StemStatusView | TabStatusView | null) =>
  work === null || (work.status === 'queued' && work.current_stage === null)

function processingStatusOf({
  stem,
  tab,
}: Status): WorkspaceTask['processingStatus'] {
  if (notStarted(stem)) return 'queued'
  if (stem?.status === 'failed') return 'failed'
  if (stem && isWorkReady(stem.status) && tab) {
    if (isWorkReady(tab.status)) return 'completed'
    if (tab.status === 'failed') return 'failed'
  }
  return 'processing'
}

const ERROR_KINDS: Readonly<
  Record<string, Exclude<WorkspaceTask['failureKind'], null>>
> = {
  SEPARATION_NO_GUITAR: 'no-guitar',
  PREPROCESS_INVALID_AUDIO: 'invalid-audio',
}

function failureKindOf(
  { stem, tab }: Status,
  failure: FailureView | null,
): WorkspaceTask['failureKind'] {
  if (stem?.status === 'failed') {
    const code = failure?.error_code ?? ''
    return Object.hasOwn(ERROR_KINDS, code) ? ERROR_KINDS[code] : null
  }
  return tab?.status === 'failed' ? 'transcription' : null
}

// The stem's own progress: cutting the section, then separating the guitar.
function stemStage(stem: StemStatusView | null): TaskStageStatus {
  if (notStarted(stem)) return 'waiting'
  if (stem?.status === 'failed') return 'failed'
  return stem && isWorkReady(stem.status) ? 'done' : 'running'
}

// Once the guitar is ready the tab is requested at once, so its wait in the
// queue already counts as making the tab.
function tabStage({ stem, tab }: Status): TaskStageStatus {
  if (!stem || !isWorkReady(stem.status)) return 'waiting'
  if (tab && isWorkReady(tab.status)) return 'done'
  return tab?.status === 'failed' ? 'failed' : 'running'
}

function stagesOf(status: Status, inputKind: SongInputKind): TaskStage[] {
  const stem = stemStage(status.stem)
  // Separated-guitar input skips separation (JOB-02), but its stem still
  // cuts the section first; that shows as the tab's own work.
  if (inputKind === 'separated-guitar') {
    const transcription =
      stem === 'done' ? tabStage(status) : stem === 'waiting' ? 'waiting' : stem
    return [
      { id: 'separation', status: 'skipped' },
      { id: 'transcription', status: transcription },
    ]
  }
  return [
    { id: 'separation', status: stem },
    { id: 'transcription', status: tabStage(status) },
  ]
}

// A failure that cannot be sent again offers no retry, except one whose
// tries ran out, which still shows the limit (TaskDetail.retry).
export function retryOf(failure: FailureView | null): TaskRetry | null {
  if (!failure) return null
  if (failure.retryable)
    return { left: failure.retries_left, limit: failure.max_retries }
  return failure.retries_left === 0
    ? { left: 0, limit: failure.max_retries }
    : null
}

export function taskStateOf({
  task,
  status,
  failure,
  inputKind,
  updatedAtLabel,
}: {
  // The task as the page keeps it: the section, its labels and copy status.
  task: WorkspaceTask
  status: Status
  // The failed side's failure (GET /stems/{id} or /tabs/{id}), or null.
  failure: FailureView | null
  inputKind: SongInputKind
  updatedAtLabel: string
}): TaskState {
  const processingStatus = processingStatusOf(status)
  return {
    task: {
      ...task,
      processingStatus,
      failureKind:
        processingStatus === 'failed' ? failureKindOf(status, failure) : null,
      progressPercent: null,
      hasSeparatedAudio: status.stem?.playable ?? false,
      updatedAtLabel,
    },
    stages: stagesOf(status, inputKind),
    retry: processingStatus === 'failed' ? retryOf(failure) : null,
  }
}
