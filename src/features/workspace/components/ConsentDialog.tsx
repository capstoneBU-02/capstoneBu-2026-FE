import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { UseWorkspaceResult } from '../useWorkspace.ts'
import styles from '../WorkspacePage.module.css'
import { ConsentDescription, ConsentDetails } from './ConsentExplanation.tsx'

type Props = {
  consent: UseWorkspaceResult['consent']
  onSave: UseWorkspaceResult['saveConsent']
  onClose: () => void
  fallbackFocusRef: RefObject<HTMLElement | null>
}

export function ConsentDialog({
  consent,
  onSave,
  onClose,
  fallbackFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const saveInFlight = useRef(false)
  const pointerStartedOutside = useRef(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const busy = consent.status === 'saving'

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const fallbackFocus = fallbackFocusRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      const canRestoreFocus =
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.matches(':disabled') &&
        previousFocus.getClientRects().length > 0
      if (canRestoreFocus) {
        previousFocus.focus({ preventScroll: true })
      }
      if (!canRestoreFocus || document.activeElement !== previousFocus) {
        fallbackFocus?.focus({ preventScroll: true })
      }
    }
  }, [fallbackFocusRef])

  async function choose(choice: 'accepted' | 'declined') {
    if (saveInFlight.current || busy) return
    saveInFlight.current = true
    setLocalError(null)
    try {
      if ((await onSave(choice)) && dialogRef.current?.open) onClose()
    } catch {
      setLocalError('선택을 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      saveInFlight.current = false
    }
  }

  function dismiss() {
    if (!saveInFlight.current && !busy) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        // Ignore a queued close from StrictMode cleanup after showModal reruns.
        if (!event.currentTarget.open) onClose()
      }}
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        pointerStartedOutside.current =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom)
      }}
      onPointerCancel={() => {
        pointerStartedOutside.current = false
      }}
      onClick={(event) => {
        const startedOutside = pointerStartedOutside.current
        pointerStartedOutside.current = false
        if (!startedOutside || event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          dismiss()
        }
      }}
    >
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>AI 학습 활용</h2>
        <button
          type="button"
          className={styles.dialogClose}
          aria-label="AI 학습 활용 창 닫기"
          onClick={dismiss}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.dialogBody}>
        <ConsentDescription
          id={descriptionId}
          className={styles.consentDescription}
          includeQuestion
        />
        <ConsentDetails className={styles.consentDetails} />
        {consent.choice !== 'undecided' && (
          <p className={styles.currentChoice}>
            현재 선택:{' '}
            {consent.choice === 'accepted' ? '동의' : '동의하지 않음'}
          </p>
        )}
        {(consent.errorMessage || localError) && (
          <p className={styles.errorMessage} role="alert">
            {consent.errorMessage || localError}
          </p>
        )}
        <span className={styles.srOnly} role="status">
          {busy ? '선택을 저장하고 있어요.' : ''}
        </span>
      </div>
      <div className={styles.dialogFooter}>
        <Button
          className={styles.consentChoice}
          disabled={busy}
          onClick={() => void choose('declined')}
        >
          동의하지 않아요
        </Button>
        <Button
          className={styles.consentChoice}
          disabled={busy}
          onClick={() => void choose('accepted')}
        >
          동의해요
        </Button>
      </div>
    </dialog>
  )
}
