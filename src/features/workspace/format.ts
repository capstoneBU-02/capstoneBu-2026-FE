import type { SongInputKind, WorkspaceTask } from './model.ts'

// mm:ss.d, matching the Figma Mono/Data samples such as 00:42.1.
export function formatTime(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600)
  const wholeSeconds = Math.floor((tenths % 600) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${tenths % 10}`
}

export function formatTaskRange(
  task: Pick<WorkspaceTask, 'rangeStartSeconds' | 'rangeEndSeconds'>,
): string {
  return `${formatTime(task.rangeStartSeconds)}–${formatTime(task.rangeEndSeconds)}`
}

const INPUT_KIND_LABELS: Record<SongInputKind, string> = {
  original: '원곡에서 기타 분리',
  'separated-guitar': '올린 기타 음원',
}

export function songInputLabel(kind: SongInputKind): string {
  return INPUT_KIND_LABELS[kind]
}

// The add-song choice and the new-section header use the short form.
const INPUT_KIND_SHORT_LABELS: Record<SongInputKind, string> = {
  original: '원곡',
  'separated-guitar': '분리된 기타 음원',
}

export function songInputShortLabel(kind: SongInputKind): string {
  return INPUT_KIND_SHORT_LABELS[kind]
}

// Short status for a task headline; the list keeps its detailed wording.
export function taskHeadlineStatus(task: WorkspaceTask): string {
  if (task.processingStatus === 'completed') return '완료'
  if (task.processingStatus === 'processing') return '진행 중'
  if (task.processingStatus === 'queued') return '대기'
  return task.failureKind === 'no-guitar' ? '기타를 찾지 못함' : '타브 실패'
}

// The 진행 중 filter covers tasks still waiting for their turn.
export function isTaskInProgress(
  task: Pick<WorkspaceTask, 'processingStatus'>,
): boolean {
  return (
    task.processingStatus === 'queued' || task.processingStatus === 'processing'
  )
}

// The banner over a finished task whose playing track failed to load. A
// label that already ends in 음원, like 올린 음원, keeps it once.
export function playbackFailureText(trackLabel: string): string {
  const audio = trackLabel.endsWith('음원') ? trackLabel : `${trackLabel} 음원`
  return `${audio}을 재생하지 못했어요. 타브는 그대로 볼 수 있어요.`
}
