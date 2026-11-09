import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { canFocus, restoreFocus } from '../../shared/ui/dialogFocus.ts'
import { Icon } from '../../shared/ui/Icon.tsx'
import { formatClockDuration } from '../add-song/songFile.ts'
import { PlayerBar } from '../player/PlayerBar.tsx'
import { SectionWaveform } from '../waveform/SectionWaveform.tsx'
import { rangeFromForm } from '../waveform/timeline.ts'
import { useSongAudio } from '../waveform/useSongAudio.ts'
import { TaskBreadcrumb } from '../workspace/components/TaskWorkspace.tsx'
import taskStyles from '../workspace/components/TaskWorkspace.module.css'
import { songInputShortLabel } from '../workspace/format.ts'
import type { WorkspaceSong, WorkspaceTask } from '../workspace/model.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import {
  checkSectionForm,
  sectionName,
  sectionNumberText,
  type SectionForm,
  type SectionFormAction,
  type SectionRequest,
} from './sectionForm.ts'
import { SECTION_POLICY } from './sectionPolicy.ts'
import { songLengthTenths } from './sectionTime.ts'
import { SectionFields } from './SectionFields.tsx'
import styles from './NewSection.module.css'

export type SectionSaveResult =
  | { readonly status: 'saved'; readonly task: WorkspaceTask }
  | { readonly status: 'failed' | 'expired' | 'cancelled' }

export interface SectionEditorText {
  // The page title, also the form's name.
  readonly title: string
  // Shown after the song name in the breadcrumb.
  readonly current: string
  readonly submit: string
  readonly submitting: string
  readonly failed: string
}

type Props = {
  song: WorkspaceSong
  text: SectionEditorText
  // The song's other sections: drawn on the waveform and used for the next
  // number.
  otherSections: readonly WorkspaceTask[]
  form: SectionForm
  onChange: (action: SectionFormAction) => void
  onCancel: () => void
  // Offered only where the section may move to another file.
  onReplaceFile?: (returnFocus: HTMLElement) => void
  // An info line above the waveform.
  intro?: string
  // Why a request the form accepts must not be sent, or null to send it.
  blockedReason?: (request: SectionRequest) => string | null
  onSubmit: (
    request: SectionRequest,
    signal: AbortSignal,
  ) => Promise<SectionSaveResult>
  onSaved: (task: WorkspaceTask) => void
  loadAudio: (songId: string, signal: AbortSignal) => Promise<Blob>
  onExpired: () => void
  // Page-level notices, such as a failed consent save, below the top bar.
  notice?: ReactNode
}

export function SectionEditor({
  song,
  text,
  otherSections,
  form,
  onChange,
  onCancel,
  onReplaceFile,
  intro,
  blockedReason,
  onSubmit,
  onSaved,
  loadAudio,
  onExpired,
  notice,
}: Props) {
  const existingNames = otherSections.map((task) => task.sectionName)
  const numberText = sectionNumberText(form, existingNames)
  const audio = useSongAudio(song.id, loadAudio, onExpired)
  // The waveform and the player follow the range the time inputs hold.
  const range = rangeFromForm(
    form.start,
    form.end,
    songLengthTenths(song.durationSeconds),
  )
  const formId = useId()
  const titleId = useId()
  const introId = useId()
  const blockedId = useId()
  const lifetimeRef = useRef<AbortController | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  // Where the user submitted from: Enter in a field or the button.
  const submittedFromRef = useRef<HTMLElement | null>(null)
  const numberRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // Count failures and blocked submits so a repeated message is announced
  // again.
  const [failures, setFailures] = useState(0)
  const [blockedAttempts, setBlockedAttempts] = useState(0)
  const check = checkSectionForm(form, {
    songDurationSeconds: song.durationSeconds,
    existingNames,
  })
  const blocked =
    check.request && blockedReason ? blockedReason(check.request) : null
  const canSubmit = check.request !== null && !blocked && !submitting
  // The blocked message shows after a submit, until the reason goes away.
  if (!blocked && blockedAttempts > 0) setBlockedAttempts(0)
  const alert =
    blocked && blockedAttempts > 0
      ? { key: `blocked-${blockedAttempts}`, message: blocked }
      : failures > 0 && !submitting
        ? { key: `failed-${failures}`, message: text.failed }
        : null

  // Leaving the screen cancels an in-flight request.
  useEffect(() => {
    const lifetime = new AbortController()
    lifetimeRef.current = lifetime
    return () => lifetime.abort()
  }, [])

  // Disabling the fields during the request drops focus to the page; give it
  // back to where the user submitted from so a retry is one key away.
  useEffect(() => {
    if (failures === 0) return
    const active = document.activeElement
    const lost =
      !(active instanceof HTMLElement) ||
      active === document.body ||
      !canFocus(active)
    if (lost) restoreFocus(submittedFromRef.current, submitRef.current)
  }, [failures])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const lifetime = lifetimeRef.current
    if (submittingRef.current || !lifetime) return
    if (!check.request) {
      onChange({ type: 'attempt' })
      // Field order: the number, then start (also for a too-long range), end.
      const { errors } = check
      const first = errors.number
        ? numberRef
        : errors.start || errors.range
          ? startRef
          : endRef
      first.current?.focus()
      return
    }
    if (blocked) {
      // This attempt replaces an earlier failure, so it does not come back
      // once the reason goes away.
      setFailures(0)
      setBlockedAttempts((count) => count + 1)
      return
    }
    submittingRef.current = true
    submittedFromRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setSubmitting(true)
    const result = await onSubmit(check.request, lifetime.signal)
    // Leaving first cancels the request, so a saved result is always the
    // user's: open it even if its new state already replaced this screen.
    if (result.status === 'saved') {
      onSaved(result.task)
      return
    }
    if (lifetime.signal.aborted) return
    submittingRef.current = false
    setSubmitting(false)
    if (result.status === 'failed') setFailures((count) => count + 1)
  }

  return (
    <>
      <header className={`${pageStyles.topBar} ${styles.topBar}`}>
        <TaskBreadcrumb songName={song.name} current={text.current} />
        <div className={styles.topActions}>
          <Button
            variant="ghost"
            compact
            onClick={onCancel}
            disabled={submitting}
          >
            취소
          </Button>
          <Button
            ref={submitRef}
            type="submit"
            form={formId}
            variant="primary"
            compact
            className={styles.submit}
            aria-disabled={!canSubmit}
            aria-describedby={blocked ? blockedId : undefined}
            data-busy={submitting}
          >
            {text.submit}
          </Button>
          {/* Read with the dimmed button, before any submit shows the alert. */}
          <span id={blockedId} hidden>
            {blocked}
          </span>
        </div>
      </header>
      {notice}
      <div className={taskStyles.workspace}>
        <header className={taskStyles.header}>
          <div className={taskStyles.titleRow}>
            <h1 id={titleId}>{text.title}</h1>
          </div>
          <div className={styles.fileRow}>
            <p className={taskStyles.meta}>
              <span className={taskStyles.truncate}>{song.fileName}</span>
              <span className={taskStyles.range}>
                {formatClockDuration(song.durationSeconds)}
              </span>
              <span>{songInputShortLabel(song.inputKind)}</span>
            </p>
            {onReplaceFile && (
              <Button
                variant="ghost"
                compact
                className={styles.replace}
                disabled={submitting}
                onClick={(event) => onReplaceFile(event.currentTarget)}
              >
                파일 바꾸기
              </Button>
            )}
          </div>
        </header>
        <form
          id={formId}
          className={styles.form}
          aria-labelledby={titleId}
          aria-describedby={intro ? introId : undefined}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          {intro && (
            <p id={introId} className={styles.intro}>
              <Icon name="info" />
              <span>{intro}</span>
            </p>
          )}
          <SectionWaveform
            songDurationSeconds={song.durationSeconds}
            audio={audio}
            range={range}
            label={sectionName(form.baseName, numberText)}
            sections={otherSections.map((task) => ({
              id: task.id,
              name: task.sectionName,
              startSeconds: task.rangeStartSeconds,
              endSeconds: task.rangeEndSeconds,
            }))}
            over={Boolean(check.shown.range)}
            disabled={submitting}
            onRange={(startSeconds, endSeconds) =>
              onChange({
                type: 'range',
                startSeconds,
                endSeconds,
                songDurationSeconds: song.durationSeconds,
              })
            }
          />
          <SectionFields
            form={form}
            numberText={numberText}
            check={check}
            policy={SECTION_POLICY}
            disabled={submitting}
            numberRef={numberRef}
            startRef={startRef}
            endRef={endRef}
            onChange={onChange}
          />
          {alert && (
            <p key={alert.key} className={styles.submitError} role="alert">
              <Icon name="alertTriangle" />
              <span>{alert.message}</span>
            </p>
          )}
          <span className={pageStyles.srOnly} role="status">
            {submitting ? text.submitting : ''}
          </span>
        </form>
      </div>
      <PlayerBar
        buffer={audio.state.status === 'ready' ? audio.state.buffer : null}
        range={range}
      />
    </>
  )
}
