import { useId, type RefObject } from 'react'
import { Icon } from '../../shared/ui/Icon.tsx'
import { durationLimitLabel } from '../add-song/songFile.ts'
import pageStyles from '../workspace/WorkspacePage.module.css'
import type {
  SectionCheck,
  SectionErrors,
  SectionForm,
  SectionFormAction,
} from './sectionForm.ts'
import type { SectionPolicy } from './sectionPolicy.ts'
import { formatSectionLength } from './sectionTime.ts'
import styles from './NewSection.module.css'

type Props = {
  form: SectionForm
  numberText: string
  check: SectionCheck
  policy: SectionPolicy
  disabled: boolean
  numberRef: RefObject<HTMLInputElement | null>
  startRef: RefObject<HTMLInputElement | null>
  endRef: RefObject<HTMLInputElement | null>
  onChange: (action: SectionFormAction) => void
}

// Errors render in field order so the list reads like the form.
const ERROR_ORDER = ['number', 'start', 'end', 'range'] as const

function describedBy(...ids: Array<string | false | undefined>) {
  return ids.filter(Boolean).join(' ') || undefined
}

function TimeField({
  field,
  label,
  value,
  shown,
  ids,
  ref,
  onChange,
}: {
  field: 'start' | 'end'
  label: string
  value: string
  shown: SectionErrors
  ids: Record<(typeof ERROR_ORDER)[number] | 'hint', string>
  ref: RefObject<HTMLInputElement | null>
  onChange: (action: SectionFormAction) => void
}) {
  const inputId = useId()
  const fieldError = shown[field]
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={styles.timeInput}
        // No inputMode: numeric and decimal phone keypads have no colon,
        // and 00:00.0 needs one.
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="00:00.0"
        value={value}
        aria-invalid={Boolean(fieldError || shown.range)}
        aria-describedby={describedBy(
          fieldError && ids[field],
          shown.range && ids.range,
          ids.hint,
        )}
        data-field-error={Boolean(fieldError)}
        onChange={(event) =>
          onChange({ type: field, value: event.target.value })
        }
        onBlur={() => onChange({ type: 'blur', field })}
      />
    </div>
  )
}

export function SectionFields({
  form,
  numberText,
  check,
  policy,
  disabled,
  numberRef,
  startRef,
  endRef,
  onChange,
}: Props) {
  const nameId = useId()
  const tuningId = useId()
  const partName = useId()
  const errorPrefix = useId()
  const ids = {
    number: `${errorPrefix}-number`,
    start: `${errorPrefix}-start`,
    end: `${errorPrefix}-end`,
    range: `${errorPrefix}-range`,
    hint: `${errorPrefix}-hint`,
  }
  const { shown, lengthTenths } = check

  return (
    <>
      <p className={styles.hint} id={ids.hint}>
        시작과 끝은 00:00.0 형식으로 입력해요. 구간은{' '}
        {durationLimitLabel(policy.maxDurationSeconds)}까지 정할 수 있어요.
      </p>
      <fieldset className={styles.fields} disabled={disabled}>
        <legend className={pageStyles.srOnly}>구간 정보</legend>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={nameId}>
            이름
          </label>
          <div className={styles.nameControls}>
            <select
              id={nameId}
              className={styles.select}
              value={form.baseName}
              onChange={(event) =>
                onChange({ type: 'name', baseName: event.target.value })
              }
            >
              {policy.names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              ref={numberRef}
              className={styles.numberInput}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label="번호"
              value={numberText}
              aria-invalid={Boolean(shown.number)}
              aria-describedby={describedBy(shown.number && ids.number)}
              data-field-error={Boolean(shown.number)}
              onChange={(event) =>
                onChange({ type: 'number', value: event.target.value })
              }
              onBlur={() => onChange({ type: 'blur', field: 'number' })}
            />
          </div>
        </div>
        <TimeField
          field="start"
          label="시작"
          value={form.start}
          shown={shown}
          ids={ids}
          ref={startRef}
          onChange={onChange}
        />
        <TimeField
          field="end"
          label="끝"
          value={form.end}
          shown={shown}
          ids={ids}
          ref={endRef}
          onChange={onChange}
        />
        <div className={styles.field}>
          <span className={styles.label}>길이</span>
          <span className={styles.length} data-over={Boolean(shown.range)}>
            {lengthTenths === null ? (
              <>
                <span aria-hidden="true">–</span>
                <span className={pageStyles.srOnly}>아직 없음</span>
              </>
            ) : (
              formatSectionLength(lengthTenths)
            )}
          </span>
        </div>
        <fieldset className={`${styles.field} ${styles.partGroup}`}>
          <legend className={styles.label}>파트</legend>
          <div className={styles.segments}>
            {policy.parts.map((part) => (
              <label key={part.id} className={styles.segment}>
                <input
                  type="radio"
                  name={partName}
                  value={part.id}
                  checked={form.part === part.id}
                  onChange={() => onChange({ type: 'part', part: part.id })}
                />
                <span>{part.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={tuningId}>
            튜닝
          </label>
          <select
            id={tuningId}
            className={styles.select}
            value={form.tuningId}
            onChange={(event) =>
              onChange({ type: 'tuning', tuningId: event.target.value })
            }
          >
            {policy.tunings.map((tuning) => (
              <option key={tuning.id} value={tuning.id}>
                {tuning.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <div className={styles.errors} aria-live="polite">
        {ERROR_ORDER.map(
          (key) =>
            shown[key] && (
              <p key={key} id={ids[key]} className={styles.error}>
                <Icon name="alertTriangle" />
                <span>{shown[key]}</span>
              </p>
            ),
        )}
      </div>
    </>
  )
}
