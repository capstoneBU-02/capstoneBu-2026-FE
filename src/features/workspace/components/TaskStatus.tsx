import { Icon } from '../../../shared/ui/Icon.tsx'
import type { SongInputKind, WorkspaceTask } from '../model.ts'
import { taskHeadlineStatus } from '../format.ts'
import { failedStage, taskStages } from '../processing.ts'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from '../WorkspacePage.module.css'

function statusLabel(
  task: WorkspaceTask,
  inputKind: SongInputKind | undefined,
) {
  if (task.processingStatus === 'completed') {
    return task.comparisonCount > 0
      ? `완료 · 비교 ${task.comparisonCount}회`
      : '완료'
  }
  if (task.processingStatus === 'processing') {
    return task.progressPercent === null
      ? '타브 만드는 중'
      : `타브 만드는 중 ${task.progressPercent}%`
  }
  // Lists have no explicit stages. An unavailable song keeps the existing
  // unknown-stage fallback; detail labels use their own stages instead.
  const stage = inputKind ? failedStage(taskStages(task, inputKind)) : null
  return taskHeadlineStatus(task, stage)
}

export function TaskStatus({
  task,
  inputKind,
}: {
  task: WorkspaceTask
  inputKind: SongInputKind | undefined
}) {
  return (
    <div className={styles.taskStatus}>
      <span className={styles.statusLine}>
        <Icon name={taskStatusIcon(task)} />
        {statusLabel(task, inputKind)}
      </span>
      {task.copyStatus === 'confirmed' && (
        <span className={styles.copyStatus}>
          <Icon name="check" />
          카피 완료
        </span>
      )}
      {task.copyStatus === 'needs-review' && (
        <span className={styles.copyStatus}>확인 필요</span>
      )}
      {task.processingStatus === 'failed' && task.hasSeparatedAudio && (
        <span className={styles.srOnly}>
          분리한 기타 음원은 유지되어 있어요.
        </span>
      )}
    </div>
  )
}
