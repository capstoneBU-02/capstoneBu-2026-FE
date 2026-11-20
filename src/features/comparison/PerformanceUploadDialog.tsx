import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { canFocus, restoreFocus } from '../../shared/ui/dialogFocus.ts'
import { Icon } from '../../shared/ui/Icon.tsx'
import type { MediaDurationProbe } from '../add-song/mediaDuration.ts'
import type { SongFileCheck } from '../add-song/songFile.ts'
import { useSongFileCheck } from '../add-song/useSongFileCheck.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import {
  PERFORMANCE_PRIVACY_NOTE,
  checkPerformanceDuration,
  performanceFileAccept,
  performanceFileMessage,
  performanceFileMeta,
  performanceUploadGuide,
  performanceUploadHint,
  type PerformanceFileCheck,
} from './performanceFile.ts'
import type { NewTake, SubmitTakeOutcome } from './useComparisonSession.ts'
import styles from './PerformanceUploadDialog.module.css'

export interface PerformanceUploadDialogProps {
  readonly sectionName: string
  readonly sectionSeconds: number
  readonly probeDuration: MediaDurationProbe
  // Closes the dialog once the take is saved; a refused save keeps it open.
  readonly onSubmit: (take: NewTake) => Promise<SubmitTakeOutcome>
  readonly onClose: () => void
  // True while leaving the screen would lose the take being saved.
  readonly onUnsavedChange?: (unsaved: boolean) => void
}

const TITLE = '연주 파일 올리기'
const MULTIPLE_FILES_MESSAGE = '파일은 한 번에 하나만 올릴 수 있어요.'
const SAVE_FAILED_MESSAGE = '연주를 저장하지 못했어요. 다시 시도해 주세요.'

// A take is judged against its section, so the song length cap never applies.
function toPerformanceCheck(
  check: SongFileCheck,
  sectionSeconds: number,
): PerformanceFileCheck {
  return check.status === 'valid' || check.status === 'too-long'
    ? checkPerformanceDuration(check.durationSeconds, sectionSeconds)
    : check
}

// A rejected save must not leave the dialog stuck in its waiting state.
async function saveTake(
  onSubmit: PerformanceUploadDialogProps['onSubmit'],
  take: NewTake,
): Promise<SubmitTakeOutcome> {
  try {
    return await onSubmit(take)
  } catch {
    return { saved: false, message: null }
  }
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

// A native modal still lets Tab leave for the browser's own controls.
function keepTabInside(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget
  const stops = [...dialog.querySelectorAll('button')].filter((stop) =>
    canFocus(stop),
  )
  const [first, last] = [stops[0], stops.at(-1)]
  const active = document.activeElement
  if (active !== dialog && active !== (event.shiftKey ? first : last)) return
  event.preventDefault()
  const next = event.shiftKey ? last : first
  next?.focus()
}

function StatusMark({ check }: { check: PerformanceFileCheck }) {
  if (check.status === 'checking')
    return <span className={styles.spinner} aria-hidden="true" />
  return (
    <Icon name={check.status === 'valid' ? 'checkDone' : 'alertTriangle'} />
  )
}

function PerformanceFilePicker({
  file,
  check,
  disabled,
  describedBy,
  dropzoneRef,
  onChoose,
  onRecheck,
}: {
  file: File | null
  check: PerformanceFileCheck | null
  disabled: boolean
  describedBy?: string
  dropzoneRef: RefObject<HTMLButtonElement | null>
  onChoose: (files: readonly File[]) => void
  onRecheck: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLButtonElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const titleId = useId()
  const hintId = useId()
  const invalid =
    check !== null && check.status !== 'checking' && check.status !== 'valid'
  const showingFile = file !== null && check !== null

  // The drop area that held focus is replaced by the file card.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (showingFile && (active === null || active === document.body))
      replaceRef.current?.focus()
  }, [showingFile])

  const pick = () => inputRef.current?.click()

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (!disabled) setDragActive(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && event.currentTarget.contains(next)))
        setDragActive(false)
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragActive(false)
      if (!disabled) onChoose([...event.dataTransfer.files])
    },
  }

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        type="file"
        accept={performanceFileAccept()}
        hidden
        onChange={(event) => {
          onChoose([...(event.currentTarget.files ?? [])])
          // Allow choosing the same file again after an error.
          event.currentTarget.value = ''
        }}
      />
      {file && check ? (
        <div
          className={styles.fileCard}
          data-invalid={invalid}
          data-drag-active={dragActive}
          {...dropHandlers}
        >
          <span className={styles.fileIcon}>
            <Icon name="music" />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileName} title={file.name}>
              {file.name}
            </span>
            <span className={styles.fileMeta} data-alert={invalid}>
              {performanceFileMeta(file, check)}
            </span>
          </span>
          {check.status === 'timed-out' && (
            <button
              type="button"
              className={styles.replace}
              onClick={() => {
                // This button goes once checking starts.
                replaceRef.current?.focus()
                onRecheck()
              }}
              disabled={disabled}
              aria-describedby={describedBy}
            >
              다시 확인
            </button>
          )}
          <button
            ref={replaceRef}
            type="button"
            className={styles.replace}
            onClick={pick}
            disabled={disabled}
            aria-describedby={describedBy}
          >
            파일 바꾸기
          </button>
          <StatusMark check={check} />
        </div>
      ) : (
        <button
          ref={dropzoneRef}
          type="button"
          className={styles.dropzone}
          data-drag-active={dragActive}
          onClick={pick}
          aria-labelledby={titleId}
          aria-describedby={describedBy ? `${hintId} ${describedBy}` : hintId}
          {...dropHandlers}
        >
          <Icon name="upload" />
          <span className={styles.dropTitle} id={titleId}>
            파일을 끌어다 놓거나 선택하세요
          </span>
          <span className={styles.dropHint} id={hintId}>
            {performanceUploadHint()}
          </span>
        </button>
      )}
    </div>
  )
}

export function PerformanceUploadDialog({
  sectionName,
  sectionSeconds,
  probeDuration,
  onSubmit,
  onClose,
  onUnsavedChange,
}: PerformanceUploadDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dropzoneRef = useRef<HTMLButtonElement>(null)
  const mountedRef = useRef(false)
  const submittingRef = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Each pick gets a fresh alert so a repeated message is announced again.
  const [attempt, setAttempt] = useState(0)
  const { check: songCheck, recheck } = useSongFileCheck(file, probeDuration)
  const check = songCheck && toPerformanceCheck(songCheck, sectionSeconds)
  const titleId = useId()
  const guideId = useId()
  const errorId = useId()
  const fileError = check && performanceFileMessage(check, sectionSeconds)
  const error = pickError ?? fileError ?? submitError
  const canSubmit = check?.status === 'valid' && !submitting

  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const opener = active instanceof HTMLElement ? active : null
    const host = dialog?.parentElement
    mountedRef.current = true
    dialog?.showModal()
    dropzoneRef.current?.focus({ preventScroll: true })
    return () => {
      mountedRef.current = false
      dialog?.close()
      // Saving a first take can replace the button that opened the dialog.
      restoreFocus(
        opener,
        host?.querySelector<HTMLElement>(
          'select:not(:disabled), button:not(:disabled)',
        ),
      )
    }
  }, [])

  // A save under way ends with the screen; a file only chosen can be chosen
  // again, so it is not worth asking about.
  useEffect(() => {
    if (!submitting) return
    function askBrowser(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    onUnsavedChange?.(true)
    window.addEventListener('beforeunload', askBrowser)
    return () => {
      window.removeEventListener('beforeunload', askBrowser)
      onUnsavedChange?.(false)
    }
  }, [submitting, onUnsavedChange])

  function choose(files: readonly File[]) {
    if (files.length === 0 || submittingRef.current) return
    setAttempt((current) => current + 1)
    setSubmitError(null)
    if (files.length > 1) {
      // The file chosen before, if any, stays selected.
      setPickError(MULTIPLE_FILES_MESSAGE)
      return
    }
    setPickError(null)
    setFile(files[0])
  }

  function dismiss() {
    if (!submittingRef.current) onClose()
  }

  async function submit() {
    if (!file || check?.status !== 'valid' || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setPickError(null)
    setSubmitError(null)
    const outcome = await saveTake(onSubmit, {
      source: 'upload',
      audio: file,
      durationSeconds: check.durationSeconds,
    })
    if (!mountedRef.current) return
    submittingRef.current = false
    setSubmitting(false)
    if (outcome.saved) onClose()
    else setSubmitError(outcome.message ?? SAVE_FAILED_MESSAGE)
  }

  return (
    <dialog
      ref={dialogRef}
      className={pageStyles.dialog}
      aria-labelledby={titleId}
      aria-describedby={guideId}
      onKeyDown={keepTabInside}
      onClose={(event) => {
        const dialog = event.currentTarget
        // Ignore a queued close from StrictMode cleanup after showModal reruns.
        if (dialog.open) return
        // Chrome closes the modal on a repeated Escape even though cancel is
        // prevented, so a save in flight reopens it instead of being dropped.
        if (submittingRef.current) {
          dialog.showModal()
          return
        }
        onClose()
      }}
      onCancel={(event) => {
        // A cancelled file chooser fires a bubbling cancel on its input.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        dismiss()
      }}
      // A file dropped outside the drop area must not navigate the page away.
      onDragOver={(event) => {
        if (event.isDefaultPrevented()) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'none'
      }}
      onDrop={(event) => event.preventDefault()}
    >
      <div className={pageStyles.dialogHeader}>
        <h2 id={titleId}>{TITLE}</h2>
        <button
          type="button"
          className={pageStyles.dialogClose}
          aria-label={`${TITLE} 창 닫기`}
          onClick={dismiss}
          disabled={submitting}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={`${pageStyles.dialogBody} ${styles.body}`}>
        <p className={styles.guide} id={guideId}>
          {performanceUploadGuide(sectionName, sectionSeconds)}
        </p>
        <PerformanceFilePicker
          file={file}
          check={check}
          disabled={submitting}
          describedBy={error ? errorId : undefined}
          dropzoneRef={dropzoneRef}
          onChoose={choose}
          onRecheck={recheck}
        />
        {error && (
          <p
            key={attempt}
            className={pageStyles.errorMessage}
            id={errorId}
            role="alert"
          >
            {error}
          </p>
        )}
        <span className={pageStyles.srOnly} role="status">
          {submitting
            ? '연주를 저장하고 있어요.'
            : check?.status === 'checking'
              ? '파일을 확인하고 있어요.'
              : check?.status === 'valid'
                ? '올릴 수 있는 파일이에요.'
                : ''}
        </span>
      </div>
      <div className={`${pageStyles.dialogFooter} ${styles.footer}`}>
        <p className={styles.footerNote}>{PERFORMANCE_PRIVACY_NOTE}</p>
        <Button variant="ghost" compact onClick={dismiss} disabled={submitting}>
          취소
        </Button>
        <Button
          variant="primary"
          compact
          className={styles.compare}
          aria-disabled={!canSubmit}
          data-busy={submitting}
          onClick={() => void submit()}
        >
          비교하기
        </Button>
      </div>
    </dialog>
  )
}
