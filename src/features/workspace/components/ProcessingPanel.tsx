import { useId } from 'react'
import { Icon, type IconName } from '../../../shared/ui/Icon.tsx'
import type { TaskDetail, TaskStageStatus } from '../model.ts'
import { stageLabel, stageStatusLabel } from '../processing.ts'
import pageStyles from '../WorkspacePage.module.css'
import styles from './ProcessingPanel.module.css'

const STAGE_MARKS: Record<TaskStageStatus, IconName> = {
  waiting: 'clock',
  running: 'statusProcessing',
  done: 'stageDone',
  failed: 'statusFailed',
  skipped: 'statusQueued',
}

function queueHint(queueAhead: number | null): string {
  const keepsPlace = '창을 닫아도 순서는 그대로예요.'
  if (queueAhead === null) return keepsPlace
  if (queueAhead === 0) return `바로 다음 순서예요. ${keepsPlace}`
  return `앞에 작업 ${queueAhead}개가 있어요. ${keepsPlace}`
}

// The body of a queued or processing task (Figma 84:3197, 27:49). Progress
// is the repository's value for the whole task; the screen never adds to it.
export function ProcessingPanel({
  detail,
  refreshFailed,
}: {
  detail: TaskDetail
  refreshFailed: boolean
}) {
  const { task, stages, queueAhead } = detail
  const headingId = useId()
  const queued = task.processingStatus === 'queued'
  const percent = queued ? 0 : task.progressPercent
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.titleRow}>
        <h2 id={headingId}>
          {queued ? '순서를 기다리고 있어요' : '타브 만드는 중'}
        </h2>
        {!queued && percent !== null && (
          <span className={styles.percent} aria-hidden="true">
            {percent}%
          </span>
        )}
      </div>
      {/* Without a value the bar is indeterminate. */}
      <div
        className={styles.bar}
        role="progressbar"
        aria-labelledby={headingId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={queued ? '시작 전' : undefined}
      >
        {percent !== null && (
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        )}
      </div>
      {/* Safari drops the list role when list-style is none. */}
      <ol className={styles.stages} role="list" aria-label="처리 단계">
        {stages.map((stage) => (
          <li
            key={stage.id}
            className={styles.stage}
            data-status={stage.status}
          >
            <span className={styles.mark}>
              <Icon name={STAGE_MARKS[stage.status]} />
            </span>
            {stageLabel(stage.id)}
            {stage.status === 'skipped' ? (
              <span className={styles.note}>
                {stageStatusLabel(stage.status)}
              </span>
            ) : (
              <span className={pageStyles.srOnly}>
                , {stageStatusLabel(stage.status)}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className={styles.hint}>
        {queued ? queueHint(queueAhead) : '창을 닫아도 계속 진행돼요.'}
      </p>
      {/* Present from the start so a failed refresh is read when it shows. */}
      <p className={styles.notice} role="status">
        {refreshFailed &&
          '지금 상태를 불러오지 못했어요. 잠시 후 다시 확인할게요.'}
      </p>
    </section>
  )
}
