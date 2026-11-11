import { durationLimitLabel } from '../add-song/songFile.ts'
import type { NewTaskInput, SectionPart } from '../workspace/model.ts'
import { SECTION_POLICY, type SectionPolicy } from './sectionPolicy.ts'
import {
  formatSectionTime,
  parseSectionTime,
  secondsToTenths,
  songLengthTenths,
} from './sectionTime.ts'

type TouchableField = 'start' | 'end' | 'number'

// The inputs keep the text the user typed; the waveform (#16) edits the same
// start/end fields through the 'range' action.
export interface SectionForm {
  readonly baseName: string
  // null follows the next free number for the chosen name.
  readonly number: string | null
  readonly start: string
  readonly end: string
  readonly part: SectionPart
  readonly tuningId: string
  readonly touched: Readonly<Record<TouchableField, boolean>>
  readonly attempted: boolean
}

export type SectionFormAction =
  | { readonly type: 'name'; readonly baseName: string }
  | { readonly type: 'number'; readonly value: string }
  | { readonly type: 'start'; readonly value: string }
  | { readonly type: 'end'; readonly value: string }
  | { readonly type: 'blur'; readonly field: TouchableField }
  | {
      readonly type: 'range'
      readonly startSeconds: number
      readonly endSeconds: number
      // Keeps a selection that ends at the file end inside the song.
      readonly songDurationSeconds: number
    }
  | { readonly type: 'part'; readonly part: SectionPart }
  | { readonly type: 'tuning'; readonly tuningId: string }
  | { readonly type: 'attempt' }
  // A new file invalidates the range and part chosen for the old one.
  | { readonly type: 'replace-file' }

export type SectionRequest = Omit<NewTaskInput, 'songId'>

export type SectionErrors = Partial<
  Record<'start' | 'end' | 'range' | 'number', string>
>

export interface SectionCheck {
  readonly errors: SectionErrors
  // Errors the user should see now: touched fields, or all after a submit.
  readonly shown: SectionErrors
  readonly lengthTenths: number | null
  readonly request: SectionRequest | null
}

interface SongContext {
  readonly songDurationSeconds: number
  // Section names already used in this song, for the next free number.
  readonly existingNames: readonly string[]
}

const untouched = { start: false, end: false, number: false } as const

export function createSectionForm(
  policy: SectionPolicy = SECTION_POLICY,
): SectionForm {
  return {
    baseName: policy.names[0],
    number: null,
    start: '',
    end: '',
    part: policy.parts[0].id,
    tuningId: policy.tunings[0].id,
    touched: untouched,
    attempted: false,
  }
}

function normalizedTime(text: string): string {
  const tenths = parseSectionTime(text)
  return tenths === null ? text : formatSectionTime(tenths)
}

function isValidNumber(text: string, policy: SectionPolicy): boolean {
  if (!/^\d{1,3}$/.test(text)) return false
  const value = Number(text)
  return value >= 1 && value <= policy.maxNumber
}

// '07' and '7' name the same section; the request and blur use '7'.
function canonicalNumber(text: string): string {
  return /^\d+$/.test(text) ? String(Number(text)) : text
}

function blurred(form: SectionForm, field: TouchableField): SectionForm {
  const touched = { ...form.touched, [field]: true }
  if (field === 'start')
    return { ...form, touched, start: normalizedTime(form.start) }
  if (field === 'end')
    return { ...form, touched, end: normalizedTime(form.end) }
  const number = form.number === null ? null : canonicalNumber(form.number)
  return { ...form, touched, number }
}

function rangeTenths(seconds: number, songTenths: number): number {
  return Math.min(Math.max(secondsToTenths(seconds), 0), songTenths)
}

export function sectionFormReducer(
  form: SectionForm,
  action: SectionFormAction,
): SectionForm {
  switch (action.type) {
    case 'name':
      return { ...form, baseName: action.baseName }
    case 'number':
      return { ...form, number: action.value.trim() }
    case 'start':
      return { ...form, start: action.value }
    case 'end':
      return { ...form, end: action.value }
    case 'blur':
      return blurred(form, action.field)
    case 'range': {
      const songTenths = songLengthTenths(action.songDurationSeconds)
      return {
        ...form,
        start: formatSectionTime(rangeTenths(action.startSeconds, songTenths)),
        end: formatSectionTime(rangeTenths(action.endSeconds, songTenths)),
        touched: { ...form.touched, start: true, end: true },
      }
    }
    case 'part':
      return { ...form, part: action.part }
    case 'tuning':
      return { ...form, tuningId: action.tuningId }
    case 'attempt':
      return { ...form, attempted: true }
    case 'replace-file':
      return {
        ...createSectionForm(),
        baseName: form.baseName,
        number: form.number,
        tuningId: form.tuningId,
      }
  }
}

// 벌스 1 exists → 벌스 2. A bare "솔로" counts as number 1.
export function nextSectionNumber(
  baseName: string,
  existingNames: readonly string[],
): number {
  const taken = new Set<number>()
  for (const name of existingNames) {
    if (name === baseName) taken.add(1)
    else if (name.startsWith(`${baseName} `)) {
      const rest = name.slice(baseName.length + 1)
      if (/^\d+$/.test(rest)) taken.add(Number(rest))
    }
  }
  let number = 1
  while (taken.has(number)) number += 1
  return number
}

export function sectionNumberText(
  form: SectionForm,
  existingNames: readonly string[],
): string {
  return form.number ?? String(nextSectionNumber(form.baseName, existingNames))
}

export function sectionName(baseName: string, numberText: string): string {
  return numberText ? `${baseName} ${numberText}` : baseName
}

// Splits a name the screen can compose: a policy name, optionally with
// 1–max. A bare name has the number ''.
export function parseSectionName(
  name: string,
  policy: SectionPolicy = SECTION_POLICY,
): { baseName: string; number: string } | null {
  for (const baseName of policy.names) {
    if (name === baseName) return { baseName, number: '' }
    if (!name.startsWith(`${baseName} `)) continue
    const number = name.slice(baseName.length + 1)
    if (/^[1-9]\d*$/.test(number) && isValidNumber(number, policy))
      return { baseName, number }
  }
  return null
}

export function isPolicySectionName(
  name: string,
  policy: SectionPolicy = SECTION_POLICY,
): boolean {
  return parseSectionName(name, policy) !== null
}

function startError(start: number | null, songTenths: number) {
  if (start === null) return '시작 시간을 00:00.0 형식으로 입력해 주세요.'
  if (start >= songTenths)
    return `시작은 곡 길이(${formatSectionTime(songTenths)})보다 앞이어야 해요. 시작 시간을 다시 입력해 주세요.`
  return undefined
}

function endError(
  end: number | null,
  start: number | null,
  songTenths: number,
) {
  if (end === null) return '끝 시간을 00:00.0 형식으로 입력해 주세요.'
  if (end > songTenths)
    return `끝이 곡 길이(${formatSectionTime(songTenths)})를 넘어요. 끝 시간을 다시 입력해 주세요.`
  if (start !== null && end < start)
    return '끝이 시작보다 앞에 있어요. 끝 시간을 다시 입력해 주세요.'
  if (start !== null && end === start)
    return '끝이 시작과 같아요. 끝 시간을 다시 입력해 주세요.'
  return undefined
}

function withoutEmpty(errors: SectionErrors): SectionErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => message !== undefined),
  )
}

export function checkSectionForm(
  form: SectionForm,
  { songDurationSeconds, existingNames }: SongContext,
  policy: SectionPolicy = SECTION_POLICY,
): SectionCheck {
  const songTenths = songLengthTenths(songDurationSeconds)
  const start = parseSectionTime(form.start)
  const end = parseSectionTime(form.end)
  const numberText = sectionNumberText(form, existingNames)
  const ordered = start !== null && end !== null && end > start
  const lengthTenths = ordered ? end - start : null
  const fieldErrors = {
    start: startError(start, songTenths),
    end: endError(end, start, songTenths),
  }
  const range =
    !fieldErrors.start &&
    !fieldErrors.end &&
    lengthTenths !== null &&
    lengthTenths > policy.maxDurationSeconds * 10
      ? `구간은 ${durationLimitLabel(policy.maxDurationSeconds)}까지 정할 수 있어요. 범위를 줄여 주세요.`
      : undefined
  const number =
    numberText === '' || isValidNumber(numberText, policy)
      ? undefined
      : `번호는 1부터 ${policy.maxNumber}까지 숫자로 입력해 주세요.`
  const errors = withoutEmpty({ ...fieldErrors, range, number })
  const { touched, attempted } = form
  const shown = withoutEmpty({
    start: touched.start || attempted ? errors.start : undefined,
    end: touched.end || attempted ? errors.end : undefined,
    range:
      (touched.start && touched.end) || attempted ? errors.range : undefined,
    number: touched.number || attempted ? errors.number : undefined,
  })
  const request =
    Object.keys(errors).length === 0 && start !== null && end !== null
      ? {
          sectionName: sectionName(form.baseName, canonicalNumber(numberText)),
          part: form.part,
          tuningId: form.tuningId,
          rangeStartSeconds: start / 10,
          rangeEndSeconds: end / 10,
        }
      : null
  return { errors, shown, lengthTenths, request }
}

// Seconds the screen sends, as a whole number of tenths divided by 10.
function isWholeTenth(seconds: number): boolean {
  return Math.abs(seconds * 10 - secondsToTenths(seconds)) < 1e-6
}

// The mock repository checks a request again, as a server would. A time
// between tenths is refused instead of rounded.
export function checkSectionRange(
  startSeconds: number,
  endSeconds: number,
  songDurationSeconds: number,
  policy: SectionPolicy = SECTION_POLICY,
): boolean {
  if (![startSeconds, endSeconds, songDurationSeconds].every(Number.isFinite))
    return false
  if (!isWholeTenth(startSeconds) || !isWholeTenth(endSeconds)) return false
  const start = secondsToTenths(startSeconds)
  const end = secondsToTenths(endSeconds)
  return (
    start >= 0 &&
    start < end &&
    end <= songLengthTenths(songDurationSeconds) &&
    end - start <= policy.maxDurationSeconds * 10
  )
}
