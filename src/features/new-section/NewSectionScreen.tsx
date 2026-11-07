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
import { TaskBreadcrumb } from '../workspace/components/TaskWorkspace.tsx'
import taskStyles from '../workspace/components/TaskWorkspace.module.css'
import { songInputShortLabel } from '../workspace/format.ts'
import type {
  NewTaskInput,
  WorkspaceSong,
  WorkspaceTask,
} from '../workspace/model.ts'
import type { CreateTaskResult } from '../workspace/useWorkspace.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import {
  checkSectionForm,
  sectionNumberText,
  type SectionForm,
  type SectionFormAction,
} from './sectionForm.ts'
import { SECTION_POLICY } from './sectionPolicy.ts'
import { SectionFields } from './SectionFields.tsx'
import styles from './NewSection.module.css'

type Props = {
  song: WorkspaceSong
  // Section names already used in this song, for the next free number.
  existingNames: readonly string[]
  form: SectionForm
  onChange: (action: SectionFormAction) => void
  onCancel: () => void
  onReplaceFile: (returnFocus: HTMLElement) => void
  onSubmit: (
    input: NewTaskInput,
    signal: AbortSignal,
  ) => Promise<CreateTaskResult>
  onCreated: (task: WorkspaceTask) => void
  // Page-level notices, such as a failed consent save, below the top bar.
  notice?: ReactNode
}

const SUBMIT_FAILED_MESSAGE =
  '작업을 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.'

export function NewSectionScreen({
  song,
  existingNames,
  form,
  onChange,
  onCancel,
  onReplaceFile,
  onSubmit,
  onCreated,
  notice,
}: Props) {
  const formId = useId()
  const titleId = useId()
  const lifetimeRef = useRef<AbortController | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  // Where the user submitted from: Enter in a field or the button.
  const submittedFromRef = useRef<HTMLElement | null>(null)
  const numberRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // Counts failures so a repeated message is announced again.
  const [failures, setFailures] = useState(0)
  const check = checkSectionForm(form, {
    songDurationSeconds: song.durationSeconds,
    existingNames,
  })
  const canSubmit = check.request !== null && !submitting

  // Leaving the screen cancels an in-flight request; the draft stays.
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
    submittingRef.current = true
    submittedFromRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setSubmitting(true)
    const result = await onSubmit(
      { songId: song.id, ...check.request },
      lifetime.signal,
    )
    if (lifetime.signal.aborted) return
    submittingRef.current = false
    setSubmitting(false)
    if (result.status === 'created') onCreated(result.task)
    else if (result.status === 'failed') setFailures((count) => count + 1)
  }

  return (
    <>
      <header className={`${pageStyles.topBar} ${styles.topBar}`}>
        <TaskBreadcrumb songName={song.name} current="새 구간" />
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
            data-busy={submitting}
          >
            타브 만들기
          </Button>
        </div>
      </header>
      {notice}
      <div className={taskStyles.workspace}>
        <header className={taskStyles.header}>
          <div className={taskStyles.titleRow}>
            <h1 id={titleId}>새 구간</h1>
          </div>
          <div className={styles.fileRow}>
            <p className={taskStyles.meta}>
              <span className={taskStyles.truncate}>{song.fileName}</span>
              <span className={taskStyles.range}>
                {formatClockDuration(song.durationSeconds)}
              </span>
              <span>{songInputShortLabel(song.inputKind)}</span>
            </p>
            <Button
              variant="ghost"
              compact
              className={styles.replace}
              disabled={submitting}
              onClick={(event) => onReplaceFile(event.currentTarget)}
            >
              파일 바꾸기
            </Button>
          </div>
        </header>
        <form
          id={formId}
          className={styles.form}
          aria-labelledby={titleId}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <p className={styles.pendingNote}>
            파형에서 구간을 고르는 기능은 다음 단계에서 연결돼요. 지금은 시간을
            직접 입력해 주세요.
          </p>
          <SectionFields
            form={form}
            numberText={sectionNumberText(form, existingNames)}
            check={check}
            policy={SECTION_POLICY}
            disabled={submitting}
            numberRef={numberRef}
            startRef={startRef}
            endRef={endRef}
            onChange={onChange}
          />
          {failures > 0 && !submitting && (
            <p key={failures} className={styles.submitError} role="alert">
              <Icon name="alertTriangle" />
              <span>{SUBMIT_FAILED_MESSAGE}</span>
            </p>
          )}
          <span className={pageStyles.srOnly} role="status">
            {submitting ? '작업을 만들고 있어요.' : ''}
          </span>
        </form>
      </div>
    </>
  )
}
