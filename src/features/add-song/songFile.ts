import type { AddSongFailureCode } from '../workspace/repository.ts'
import {
  UPLOAD_POLICY,
  type UploadFormat,
  type UploadPolicy,
} from './uploadPolicy.ts'

export type SongFileCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'valid'; readonly durationSeconds: number }
  | { readonly status: 'too-long'; readonly durationSeconds: number }
  | { readonly status: 'invalid-format' }
  | { readonly status: 'unreadable' }
  // The length took too long to read; the same file can be checked again.
  | { readonly status: 'timed-out' }

// A song also has to fit the upload size limit, which is checked before the
// length is read. A chosen performance file is checked against it too.
export type AddSongFileCheck = SongFileCheck | { readonly status: 'too-large' }

// Browsers report no MIME, or a generic one, for some local files. Such files
// pass on their extension and are judged by whether they play.
const UNSPECIFIED_MIME_TYPES = new Set(['', 'application/octet-stream'])

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

function formatOf(
  fileName: string,
  policy: UploadPolicy,
): UploadFormat | undefined {
  const extension = extensionOf(fileName)
  return policy.formats.find((candidate) =>
    candidate.extensions.includes(extension),
  )
}

function mimeOf(type: string): string {
  return type.split(';')[0].trim().toLowerCase()
}

export function isAllowedSongFile(
  file: { readonly name: string; readonly type: string },
  policy: UploadPolicy = UPLOAD_POLICY,
): boolean {
  const format = formatOf(file.name, policy)
  if (!format) return false
  const mime = mimeOf(file.type)
  return UNSPECIFIED_MIME_TYPES.has(mime) || format.mimeTypes.includes(mime)
}

// What can be refused without decoding, in the order the server checks:
// format, then size. Null leaves the length to the probe.
export function precheckSongFile(
  file: { readonly name: string; readonly type: string; readonly size: number },
  policy: UploadPolicy = UPLOAD_POLICY,
): Extract<
  AddSongFileCheck,
  { status: 'invalid-format' | 'too-large' }
> | null {
  if (!isAllowedSongFile(file, policy)) return { status: 'invalid-format' }
  if (file.size > policy.maxFileBytes) return { status: 'too-large' }
  return null
}

// The server rounds the length to milliseconds and refuses anything above
// the limit, so 300.001 s is over five minutes here too.
export function checkSongDuration(
  durationSeconds: number,
  policy: UploadPolicy = UPLOAD_POLICY,
): SongFileCheck {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { status: 'unreadable' }
  }
  return Math.round(durationSeconds * 1000) > policy.maxDurationSeconds * 1000
    ? { status: 'too-long', durationSeconds }
    : { status: 'valid', durationSeconds }
}

// The same bytes and name, declaring the type the server accepts for the
// extension. Browsers report several types for MP3 and none for some files.
export function songUploadFile(
  file: File,
  policy: UploadPolicy = UPLOAD_POLICY,
): File {
  const format = formatOf(file.name, policy)
  if (!format || file.type === format.uploadType) return file
  return new File([file], file.name, {
    type: format.uploadType,
    lastModified: file.lastModified,
  })
}

function formatLabels(policy: UploadPolicy): string {
  return policy.formats.map((format) => format.label).join(', ')
}

// 52428800 → 50MB, 1572864 → 1.5MB
function sizeLimitLabel(bytes: number): string {
  return formatFileSize(bytes).replace(/\.0(?=[KMG]B$)/, '')
}

// 300 → 5분, 210 → 3분 30초, 45 → 45초
export function durationLimitLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest}초`
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`
}

export function uploadHintLabel(policy: UploadPolicy = UPLOAD_POLICY): string {
  return `${formatLabels(policy)} · 최대 ${durationLimitLabel(policy.maxDurationSeconds)}`
}

export function songFileAccept(policy: UploadPolicy = UPLOAD_POLICY): string {
  return policy.formats
    .flatMap((format) => [
      ...format.extensions.map((extension) => `.${extension}`),
      ...format.mimeTypes,
    ])
    .join(',')
}

function tooLongMessage(policy: UploadPolicy): string {
  return `${durationLimitLabel(policy.maxDurationSeconds)} 이하 파일만 올릴 수 있어요. 필요한 부분만 잘라서 올려 주세요.`
}

function tooLargeMessage(policy: UploadPolicy): string {
  return `${sizeLimitLabel(policy.maxFileBytes)} 이하 파일만 올릴 수 있어요. 용량을 줄여서 다시 올려 주세요.`
}

export function songFileMessage(
  check: AddSongFileCheck,
  policy: UploadPolicy = UPLOAD_POLICY,
): string | null {
  switch (check.status) {
    case 'invalid-format':
      return `${formatLabels(policy)} 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.`
    case 'too-long':
      return tooLongMessage(policy)
    case 'too-large':
      return tooLargeMessage(policy)
    case 'unreadable':
      return '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.'
    case 'timed-out':
      return '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.'
    default:
      return null
  }
}

// A section whose sound the server could not read (PREPROCESS_INVALID_AUDIO):
// a silent range, one past the decoded end, or a file that would not decode.
// Its task cannot be sent again; another range or another file can.
export function invalidAudioAdvice(
  policy: UploadPolicy = UPLOAD_POLICY,
): string {
  return `고른 구간에서 소리를 읽지 못했어요. 소리가 나는 구간을 다시 고르거나 다른 ${formatLabels(policy)} 파일을 올려 보세요.`
}

// The server's reasons share the wording of the checks above; it may still
// refuse a file that passed them, as it reads the length its own way.
export function addSongFailureMessage(
  reason: AddSongFailureCode,
  policy: UploadPolicy = UPLOAD_POLICY,
): string {
  switch (reason) {
    case 'song-unsupported':
      return `이 파일은 처리할 수 없어요. 다른 ${formatLabels(policy)} 파일로 다시 올려 주세요.`
    case 'song-too-long':
      return tooLongMessage(policy)
    case 'song-too-large':
      return tooLargeMessage(policy)
    case 'storage-full':
      return '작업 공간에 더 올릴 수 없어요. 올릴 수 있는 곡 수나 저장 용량을 모두 사용했어요.'
    case 'add-song-failed':
      return '곡을 추가하지 못했어요. 다시 시도해 주세요.'
  }
}

// Null until the repository reports any progress (the mock may not). At 100
// the file has gone and the server is reading it.
export function uploadProgressLabel(percent: number | null): string {
  if (percent === null) return '파일 올리는 중'
  return percent >= 100 ? '파일 확인 중' : `파일 올리는 중 ${percent}%`
}

// Sending the same file again would be refused the same way.
export function isFileRefusal(reason: AddSongFailureCode): boolean {
  return (
    reason === 'song-unsupported' ||
    reason === 'song-too-long' ||
    reason === 'song-too-large'
  )
}

// A file chosen again from disk is a new File object; one whose name, size,
// format and modified time all match is taken as the same file.
export function isSameFile(a: File, b: File): boolean {
  return (
    a.name === b.name &&
    a.size === b.size &&
    a.type === b.type &&
    a.lastModified === b.lastModified
  )
}

const SIZE_UNITS = ['KB', 'MB', 'GB'] as const

// Binary units, as browsers' download lists show them (8.4MB).
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))}B`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)}${SIZE_UNITS[unit]}`
}

// mm:ss in whole seconds, matching the Figma file card (04:12).
export function formatClockDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export function songNameFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const name = (dot > 0 ? fileName.slice(0, dot) : fileName).trim()
  return name || fileName
}
