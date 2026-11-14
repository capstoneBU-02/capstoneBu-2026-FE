import type { WorkspaceTask } from '../model.ts'
import type { CopyStatus } from '../useCopyStatus.ts'
import styles from './CopyToggle.module.css'

// 카피 완료 on a finished task (Figma 25:2, 84:1867). While it saves, the
// box shows the value asked for and takes no more input, yet keeps focus. A
// failed save goes back to the saved value and says so here, also when it
// failed while the user was away.
export function CopyToggle({
  task,
  copy,
}: {
  task: WorkspaceTask
  copy: CopyStatus
}) {
  const saving = copy.saving.get(task.id)
  const busy = saving !== undefined
  const checked = saving ?? task.copyStatus === 'confirmed'

  function toggle() {
    if (!busy) void copy.save(task.id, !checked)
  }

  return (
    <div className={styles.copy}>
      <label className={styles.toggle} data-checked={checked}>
        <input
          type="checkbox"
          className={styles.box}
          checked={checked}
          aria-disabled={busy ? 'true' : undefined}
          onChange={toggle}
        />
        {checked ? '카피 완료' : '카피 완료로 표시'}
      </label>
      {copy.failed.has(task.id) && (
        <p className={styles.failure} role="alert">
          카피 완료를 저장하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </div>
  )
}
