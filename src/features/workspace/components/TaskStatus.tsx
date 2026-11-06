import { Icon } from '../../../shared/ui/Icon.tsx'
import type { WorkspaceTask } from '../model.ts'
import { taskStatusIcon } from './taskStatusIcon.ts'
import styles from '../WorkspacePage.module.css'

function statusLabel(task: WorkspaceTask) {
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
  if (task.processingStatus === 'queued') return '대기'
  return task.failureKind === 'no-guitar' ? '기타를 찾지 못함' : '타브 실패'
}

export function TaskStatus({ task }: { task: WorkspaceTask }) {
  return (
    <div className={styles.taskStatus}>
      <span className={styles.statusLine}>
        <Icon name={taskStatusIcon(task)} />
        {statusLabel(task)}
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
