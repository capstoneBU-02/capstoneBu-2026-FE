import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { isOutside, restoreFocus } from '../../../shared/ui/dialogFocus.ts'
import pageStyles from '../WorkspacePage.module.css'
import styles from './ConfirmDialog.module.css'

type Props = {
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  // While the confirmed request runs, the dialog stays open: Esc, the
  // backdrop and both buttons do nothing, and busyLabel replaces the label.
  // A browser may still close it on a repeated Esc; the dialog then waits
  // for the request, opens again if it ends in an error, and closes if not.
  busy?: boolean
  busyLabel?: string
  error?: string | null
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

// A choice the user confirms before it happens. Initial focus stays on 취소,
// the choice that changes nothing.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
  busyLabel,
  error = null,
  returnFocusRef,
  fallbackFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const pointerStartedOutside = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const close = () => {
    if (!busy) onClose()
  }
  const waited = useRef(false)
  const settleWait = useEffectEvent(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    if (!error) return onClose()
    dialog.showModal()
    cancelRef.current?.focus({ preventScroll: true })
  })

  // In the commit that ends the wait, so a late close from the browser
  // finds the dialog open again.
  useLayoutEffect(() => {
    if (busy) {
      waited.current = true
    } else if (waited.current) {
      waited.current = false
      settleWait()
    }
  }, [busy])

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
      className={`${pageStyles.dialog} ${styles.dialog}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        // Ignore a queued close from StrictMode cleanup after showModal
        // reruns. One the browser makes during a wait can arrive after the
        // request ended; the end of the wait decides instead.
        if (!event.currentTarget.open && !busy) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        close()
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
          close()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {/* Present from the start so the wait is read when it begins. */}
      <p className={pageStyles.srOnly} role="status">
        {busy && busyLabel}
      </p>
      <div className={styles.actions}>
        <Button ref={cancelRef} compact aria-disabled={busy} onClick={close}>
          취소
        </Button>
        <Button
          variant="primary"
          compact
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onConfirm()
          }}
        >
          {busy && busyLabel ? busyLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
