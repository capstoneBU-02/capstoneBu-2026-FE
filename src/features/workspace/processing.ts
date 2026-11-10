import type {
  SongInputKind,
  TaskStage,
  TaskStageId,
  TaskStageStatus,
  WorkspaceTask,
} from './model.ts'

type StageSource = Pick<
  WorkspaceTask,
  'processingStatus' | 'failureKind' | 'hasSeparatedAudio'
>

function separationStatus(
  task: StageSource,
  inputKind: SongInputKind,
): TaskStageStatus {
  if (inputKind === 'separated-guitar') return 'skipped'
  switch (task.processingStatus) {
    case 'queued':
      return 'waiting'
    case 'processing':
      return task.hasSeparatedAudio ? 'done' : 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return task.hasSeparatedAudio ? 'done' : 'failed'
  }
}

function transcriptionStatus(
  task: StageSource,
  separation: TaskStageStatus,
): TaskStageStatus {
  switch (task.processingStatus) {
    case 'queued':
      return 'waiting'
    case 'processing':
      return separation === 'running' ? 'waiting' : 'running'
    case 'completed':
      return 'done'
    case 'failed':
      // A failed separation leaves the tab never started.
      return separation === 'failed' ? 'waiting' : 'failed'
  }
}

// The stages a task's own status implies. A server that reports stages
// directly replaces this; the mock and the test harness share it.
export function taskStages(
  task: StageSource,
  inputKind: SongInputKind,
): readonly TaskStage[] {
  const separation = separationStatus(task, inputKind)
  return [
    { id: 'separation', status: separation },
    { id: 'transcription', status: transcriptionStatus(task, separation) },
  ]
}

const STAGE_LABELS: Record<TaskStageId, string> = {
  separation: '기타 분리',
  transcription: '타브 생성',
}

export function stageLabel(id: TaskStageId): string {
  return STAGE_LABELS[id]
}

const STAGE_STATUS_LABELS: Record<TaskStageStatus, string> = {
  waiting: '기다리는 중',
  running: '진행 중',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
}

export function stageStatusLabel(status: TaskStageStatus): string {
  return STAGE_STATUS_LABELS[status]
}

function runningStage(stages: readonly TaskStage[]): TaskStageId | null {
  return stages.find((stage) => stage.status === 'running')?.id ?? null
}

// Changes when the status or the running stage changes, not with progress.
export function processingPhase(
  task: Pick<WorkspaceTask, 'processingStatus'>,
  stages: readonly TaskStage[],
): string {
  return `${task.processingStatus}:${runningStage(stages) ?? ''}`
}

// Read aloud when the phase changes while the task is open.
export function statusAnnouncement(
  task: Pick<WorkspaceTask, 'processingStatus' | 'failureKind'>,
  stages: readonly TaskStage[],
): string {
  switch (task.processingStatus) {
    case 'queued':
      return '순서를 기다리고 있어요.'
    case 'processing':
      return runningStage(stages) === 'separation'
        ? '기타 분리를 시작했어요.'
        : '타브 생성을 시작했어요.'
    case 'completed':
      return '타브를 다 만들었어요.'
    case 'failed':
      return task.failureKind === 'no-guitar'
        ? '기타 소리를 거의 찾지 못했어요.'
        : '타브를 만들지 못했어요.'
  }
}
