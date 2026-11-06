import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import { songInputShortLabel } from '../workspace/format.ts'
import type {
  NewSongInput,
  SongInputKind,
  WorkspaceSong,
} from '../workspace/model.ts'
import type { AddSongResult } from '../workspace/useWorkspace.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import type { MediaDurationProbe } from './mediaDuration.ts'
import { songFileMessage } from './songFile.ts'
import { SongFilePicker } from './SongFilePicker.tsx'
import { useSongFileCheck } from './useSongFileCheck.ts'
import styles from './AddSongDialog.module.css'

type Props = {
  probeDuration: MediaDurationProbe
  // Files dropped on an entry point before the dialog opened.
  initialFiles?: readonly File[]
  onSubmit: (input: NewSongInput, signal: AbortSignal) => Promise<AddSongResult>
  onAdded: (song: WorkspaceSong) => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

const INPUT_KINDS: ReadonlyArray<{
  value: SongInputKind
  guide: string
}> = [
  { value: 'original', guide: '원곡은 기타를 먼저 분리한 뒤 타브를 만들어요.' },
  {
    value: 'separated-guitar',
    guide: '분리된 기타 음원은 분리 단계 없이 바로 타브를 만들어요.',
  },
]

const MULTIPLE_FILES_MESSAGE = '파일은 한 번에 하나만 올릴 수 있어요.'
const SUBMIT_FAILED_MESSAGE = '곡을 추가하지 못했어요. 다시 시도해 주세요.'

function canFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
    !element.matches(':disabled, [hidden]') &&
    element.getClientRects().length,
  )
}

function isOutside(event: { clientX: number; clientY: number }, box: DOMRect) {
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
}

export function AddSongDialog({
  probeDuration,
  initialFiles = [],
  onSubmit,
  onAdded,
  onClose,
  returnFocusRef,
  fallbackFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const kindGroupRef = useRef<HTMLFieldSetElement>(null)
  const lifetimeRef = useRef<AbortController | null>(null)
  const pointerStartedOutside = useRef(false)
  const [inputKind, setInputKind] = useState<SongInputKind>('original')
  const [file, setFile] = useState<File | null>(
    initialFiles.length === 1 ? initialFiles[0] : null,
  )
  const [pickError, setPickError] = useState<string | null>(
    initialFiles.length > 1 ? MULTIPLE_FILES_MESSAGE : null,
  )
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Each pick gets a fresh alert so a repeated message is announced again.
  const [attempt, setAttempt] = useState(0)
  const check = useSongFileCheck(file, probeDuration)
  const titleId = useId()
  const guideId = useId()
  const errorId = useId()
  const fileError = check ? songFileMessage(check) : null
  const error = pickError ?? fileError ?? submitError
  const canSubmit = check?.status === 'valid' && !submitting

  useEffect(() => {
    const dialog = dialogRef.current
    const target = returnFocusRef.current
    const fallback = fallbackFocusRef.current
    // Closing the dialog cancels an in-flight add and drops the selection.
    const lifetime = new AbortController()
    lifetimeRef.current = lifetime
    dialog?.showModal()
    kindGroupRef.current
      ?.querySelector<HTMLInputElement>('input:checked')
      ?.focus({ preventScroll: true })
    return () => {
      lifetime.abort()
      dialog?.close()
      if (canFocus(target)) target.focus({ preventScroll: true })
      if (!canFocus(target) || document.activeElement !== target) {
        if (canFocus(fallback)) fallback.focus({ preventScroll: true })
      }
    }
  }, [returnFocusRef, fallbackFocusRef])

  function choose(files: readonly File[]) {
    if (files.length === 0) return
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
    if (!submitting) onClose()
  }

  async function submit() {
    const lifetime = lifetimeRef.current
    if (
      !file ||
      check?.status !== 'valid' ||
      submittingRef.current ||
      !lifetime
    )
      return
    submittingRef.current = true
    setSubmitting(true)
    setPickError(null)
    setSubmitError(null)
    const result = await onSubmit(
      { file, inputKind, durationSeconds: check.durationSeconds },
      lifetime.signal,
    )
    if (lifetime.signal.aborted) return
    submittingRef.current = false
    setSubmitting(false)
    if (result.status === 'added') onAdded(result.song)
    else if (result.status === 'failed') setSubmitError(SUBMIT_FAILED_MESSAGE)
  }

  const guide = INPUT_KINDS.find((kind) => kind.value === inputKind)?.guide

  return (
    <dialog
      ref={dialogRef}
      className={pageStyles.dialog}
      aria-labelledby={titleId}
      onClose={(event) => {
        // Ignore a queued close from StrictMode cleanup after showModal reruns.
        if (!event.currentTarget.open) onClose()
      }}
      onCancel={(event) => {
        // A cancelled file chooser fires a bubbling cancel on its input.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        dismiss()
      }}
      // A file dropped outside the drop area must not navigate the page away.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
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
          dismiss()
      }}
    >
      <div className={pageStyles.dialogHeader}>
        <h2 id={titleId}>곡 추가</h2>
        <button
          type="button"
          className={pageStyles.dialogClose}
          aria-label="곡 추가 창 닫기"
          onClick={dismiss}
          disabled={submitting}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={`${pageStyles.dialogBody} ${styles.body}`}>
        <fieldset
          ref={kindGroupRef}
          className={styles.kindGroup}
          aria-describedby={guideId}
          disabled={submitting}
        >
          <legend className={pageStyles.srOnly}>올릴 음원 종류</legend>
          <div className={styles.segments}>
            {INPUT_KINDS.map((kind) => (
              <label key={kind.value} className={styles.segment}>
                <input
                  type="radio"
                  name="song-input-kind"
                  value={kind.value}
                  checked={inputKind === kind.value}
                  onChange={() => setInputKind(kind.value)}
                />
                <span>{songInputShortLabel(kind.value)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className={styles.guide} id={guideId}>
          {guide}
        </p>
        <SongFilePicker
          file={file}
          check={check}
          disabled={submitting}
          describedBy={error ? errorId : undefined}
          onChoose={choose}
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
            ? '곡을 추가하고 있어요.'
            : check?.status === 'checking'
              ? '파일을 확인하고 있어요.'
              : check?.status === 'valid'
                ? '올릴 수 있는 파일이에요.'
                : ''}
        </span>
      </div>
      <div className={`${pageStyles.dialogFooter} ${styles.footer}`}>
        <p className={styles.footerNote}>
          올린 파일은 이 워크스페이스에서만 열려요.
        </p>
        <Button variant="ghost" compact onClick={dismiss} disabled={submitting}>
          취소
        </Button>
        <Button
          variant="primary"
          compact
          className={styles.next}
          aria-disabled={!canSubmit}
          data-busy={submitting}
          onClick={() => void submit()}
        >
          다음
        </Button>
      </div>
    </dialog>
  )
}
