import { useId, useState } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type {
  SongInputKind,
  TaskDetail,
  TaskStageId,
  WorkspaceTask,
} from '../model.ts'
import { failedStage } from '../processing.ts'
import pageStyles from '../WorkspacePage.module.css'
import styles from './TaskFailurePanel.module.css'

export interface TaskRecoveryActions {
  // Resolves once the retried task is on screen, or the request failed.
  readonly retry: (
    taskId: string,
  ) => Promise<'retried' | 'failed' | 'cancelled'>
  readonly contact: (returnFocus: HTMLElement | null) => void
  // A song without guitar cannot be sent again (SEPARATION_NO_GUITAR); the
  // section moves, or another file starts a new one.
  readonly redefine: (taskId: string) => void
  readonly uploadOther: (
    task: WorkspaceTask,
    returnFocus: HTMLElement | null,
  ) => void
}

// JOB-04: what the failure leaves to listen to.
function keptAudio(inputKind: SongInputKind, stage: TaskStageId | null) {
  if (inputKind === 'separated-guitar')
    return '올린 기타 음원은 그대로 들을 수 있어요.'
  return stage === 'separation'
    ? '원곡은 그대로 들을 수 있어요.'
    : '분리한 기타 음원은 그대로 들을 수 있어요.'
}

// The body of a failed task that found guitar (Figma 27:398, 84:3778): the
// stage that failed, what is kept and whether it can be sent again (TAB-03).
// The tries left are the repository's numbers; the screen never counts them.
export function TaskFailurePanel({
  detail,
  retry,
  contact,
}: { detail: TaskDetail } & TaskRecoveryActions) {
  const { task, song, stages } = detail
  const headingId = useId()
  const countId = useId()
  const [request, setRequest] = useState<'idle' | 'sending' | 'failed'>('idle')
  const stage = failedStage(stages)
  const kept = keptAudio(song.inputKind, stage)
  const canRetry = detail.retry !== null && detail.retry.left > 0
  const sending = request === 'sending'
  const advice = canRetry
    ? `${kept} 다시 시도하거나 구간을 짧게 나눠 보세요.`
    : detail.retry
      ? `다시 시도는 ${detail.retry.limit}번까지 할 수 있어요. 구간을 짧게 나눠 새로 만들어 보세요. ${kept}`
      : `구간을 짧게 나눠 새로 만들어 보세요. ${kept}`

  async function sendRetry() {
    if (sending) return
    setRequest('sending')
    const outcome = await retry(task.id)
    // A retried task replaces this panel. One the server still reports as
    // failed keeps it, ready to send again.
    setRequest(outcome === 'failed' ? 'failed' : 'idle')
  }

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        <Icon name="alertTriangle" />
        {stage === 'separation'
          ? '기타를 분리하지 못했어요'
          : '타브를 만들지 못했어요'}
      </h2>
      <p className={styles.advice}>{advice}</p>
      {request === 'failed' && (
        <p className={styles.error} role="alert">
          다시 시도하지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      {/* Present from the start so the wait is read when it begins. */}
      <p className={pageStyles.srOnly} role="status">
        {sending && '다시 시도하고 있어요.'}
      </p>
      <div className={styles.actions}>
        {/* One button in one place, so focus stays when the tries run out. */}
        {canRetry ? (
          <Button
            variant="primary"
            compact
            aria-disabled={sending}
            aria-describedby={countId}
            onClick={sendRetry}
          >
            <Icon name="refresh" />
            {sending ? '다시 시도하는 중…' : '다시 시도'}
          </Button>
        ) : (
          <Button compact onClick={(event) => contact(event.currentTarget)}>
            문의하기
          </Button>
        )}
        {canRetry && (
          <span id={countId} className={styles.count}>
            {detail.retry?.left}회 남음
          </span>
        )}
      </div>
    </section>
  )
}

// The body of a task whose song had no guitar to separate (Figma 84:3389).
// Nothing is kept to listen to but the song, and a retry would find the same.
export function NoGuitarPanel({
  detail,
  redefine,
  uploadOther,
}: { detail: TaskDetail } & Pick<
  TaskRecoveryActions,
  'redefine' | 'uploadOther'
>) {
  const headingId = useId()
  const { task } = detail
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        <Icon name="alertTriangle" />
        기타 소리를 거의 찾지 못했어요
      </h2>
      <p className={styles.advice}>
        고른 구간에서 기타가 작게 들리거나 다른 악기와 겹쳐 있으면 그럴 수
        있어요. 기타가 잘 들리는 구간을 다시 골라 보세요.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" compact onClick={() => redefine(task.id)}>
          구간 다시 정하기
        </Button>
        <Button
          compact
          onClick={(event) => uploadOther(task, event.currentTarget)}
        >
          다른 파일 올리기
        </Button>
      </div>
    </section>
  )
}
