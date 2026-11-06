import { useEffect, useId, useRef, type RefObject } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { isOutside, restoreFocus } from '../../shared/ui/dialogFocus.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import styles from './NewSection.module.css'

type Props = {
  onConfirm: () => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

// Replacing the file clears the range and part (IN-05), so the user confirms
// first. Initial focus stays on 취소, the choice that keeps the input.
export function ReplaceFileDialog({
  onConfirm,
  onClose,
  returnFocusRef,
  fallbackFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const pointerStartedOutside = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const target = returnFocusRef.current
    const fallback = fallbackFocusRef.current
    dialog?.showModal()
    cancelRef.current?.focus({ preventScroll: true })
    return () => {
      dialog?.close()
      restoreFocus(target, fallback)
    }
  }, [returnFocusRef, fallbackFocusRef])

  return (
    <dialog
      ref={dialogRef}
      className={`${pageStyles.dialog} ${styles.confirmDialog}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        // Ignore a queued close from StrictMode cleanup after showModal reruns.
        if (!event.currentTarget.open) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        pointerStartedOutside.current =
          event.target === event.currentTarget &&
          isOutside(event, event.currentTarget.getBoundingClientRect())
      }}
      onPointerCancel={() => {
        pointerStartedOutside.current = false
      }}
      onClick={(event) => {
        const startedOutside = pointerStartedOutside.current
        pointerStartedOutside.current = false
        if (
          startedOutside &&
          event.target === event.currentTarget &&
          isOutside(event, event.currentTarget.getBoundingClientRect())
        )
          onClose()
      }}
    >
      <h2 id={titleId}>다른 파일로 바꿀까요?</h2>
      <p id={descriptionId}>
        정해 둔 구간과 파트는 새 파일에 맞춰 다시 골라야 해요. 지금 곡과 이미
        만든 작업은 그대로 남아요.
      </p>
      <div className={styles.confirmActions}>
        <Button ref={cancelRef} compact onClick={onClose}>
          취소
        </Button>
        <Button variant="primary" compact onClick={onConfirm}>
          파일 바꾸기
        </Button>
      </div>
    </dialog>
  )
}
