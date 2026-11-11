import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { IconName } from '../../../shared/ui/Icon.tsx'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { SongInputKind, WorkspaceTask } from '../model.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import styles from './StopTask.module.css'

function stopDescription(
  task: WorkspaceTask,
  inputKind: SongInputKind,
  previousResultCount: number,
): string {
  return [
    '멈춘 작업은 목록에서 사라지고 되돌릴 수 없어요.',
    task.hasSeparatedAudio && inputKind === 'original'
      ? '분리한 기타 음원도 함께 지워져요.'
      : null,
    previousResultCount > 0 ? '이전 결과도 함께 지워져요.' : null,
    '곡은 그대로 남아 새 구간을 만들 수 있어요.',
  ]
    .filter(Boolean)
    .join(' ')
}

// 멈추기 in the top bar of a queued or processing task (Figma 27:49,
// 84:3197). The page sends the request and says when it is done; the dialog
// waits for it and shows a failure without closing. The control stays for
// the open task, so a dialog the finished task can no longer use closes
// here and the page says why, outside the dialog.
export function StopTaskControl({
  task,
  stoppable,
  inputKind,
  previousResultCount,
  stopping,
  onStop,
  onEnded,
  fallbackFocusRef,
}: {
  task: WorkspaceTask
  // Queued or processing, or its stop request is still running.
  stoppable: boolean
  inputKind: SongInputKind
  previousResultCount: number
  stopping: boolean
  onStop: () => Promise<'stopped' | 'failed' | 'cancelled'>
  onEnded: () => void
  fallbackFocusRef: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ended, setEnded] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const reportEnded = useEffectEvent(onEnded)
  if (open && !stoppable) {
    setOpen(false)
    setEnded(true)
  }

  // Said once the dialog has closed, when the page can be read again.
  useEffect(() => {
    if (ended) reportEnded()
  }, [ended])

  return (
    <>
      {stoppable && (
        <Button
          ref={buttonRef}
          variant="ghost"
          compact
          onClick={() => {
            setFailed(false)
            setOpen(true)
          }}
        >
          <Icon name="stop" />
          멈추기
        </Button>
      )}
      {open && (
        <ConfirmDialog
          title={`${task.sectionName} 작업을 멈출까요?`}
          description={stopDescription(task, inputKind, previousResultCount)}
          confirmLabel="멈추기"
          busy={stopping}
          busyLabel="멈추는 중…"
          error={
            failed
              ? '작업을 멈추지 못했어요. 잠시 후 다시 시도해 주세요.'
              : null
          }
          onConfirm={async () => {
            setFailed(false)
            if ((await onStop()) !== 'failed') return
            setFailed(true)
            // In case the wait ended in a render of its own and the dialog
            // closed before the failure came back.
            setOpen(true)
          }}
          onClose={() => setOpen(false)}
          returnFocusRef={buttonRef}
          fallbackFocusRef={fallbackFocusRef}
        />
      )}
    </>
  )
}

export interface StopNoticeContent {
  readonly message: string
  readonly icon: Extract<IconName, 'checkDone' | 'info'>
}

// Read where the stopped task used to be, or on the task that could not be
// stopped, until the user moves on. The region stays in place so the
// message is read when it appears.
export function StopNotice({ notice }: { notice: StopNoticeContent | null }) {
  return (
    <div className={styles.notice} role="status">
      {notice && (
        <p>
          <Icon name={notice.icon} />
          {notice.message}
        </p>
      )}
    </div>
  )
}
