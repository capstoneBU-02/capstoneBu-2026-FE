import { UPLOAD_POLICY, type UploadPolicy } from './uploadPolicy.ts'

export type SongFileCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'valid'; readonly durationSeconds: number }
  | { readonly status: 'too-long'; readonly durationSeconds: number }
  | { readonly status: 'invalid-format' }
  | { readonly status: 'unreadable' }
  // The length took too long to read; the same file can be checked again.
  | { readonly status: 'timed-out' }

// Browsers report no MIME, or a generic one, for some local files. Such files
// pass on their extension and are judged by whether they play.
const UNSPECIFIED_MIME_TYPES = new Set(['', 'application/octet-stream'])

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedSongFile(
  file: { readonly name: string; readonly type: string },
  policy: UploadPolicy = UPLOAD_POLICY,
): boolean {
  const extension = extensionOf(file.name)
  const format = policy.formats.find((candidate) =>
    candidate.extensions.includes(extension),
  )
  if (!format) return false
  const mime = file.type.split(';')[0].trim().toLowerCase()
  return UNSPECIFIED_MIME_TYPES.has(mime) || format.mimeTypes.includes(mime)
}

// Compare the whole seconds the card shows, so 05:00 is never "over 5 min".
export function checkSongDuration(
  durationSeconds: number,
  policy: UploadPolicy = UPLOAD_POLICY,
): SongFileCheck {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { status: 'unreadable' }
  }
  return Math.floor(durationSeconds) > policy.maxDurationSeconds
    ? { status: 'too-long', durationSeconds }
    : { status: 'valid', durationSeconds }
}

function formatLabels(policy: UploadPolicy): string {
  return policy.formats.map((format) => format.label).join(', ')
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

export function songFileMessage(
  check: SongFileCheck,
  policy: UploadPolicy = UPLOAD_POLICY,
): string | null {
  switch (check.status) {
    case 'invalid-format':
      return `${formatLabels(policy)} 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.`
    case 'too-long':
      return `${durationLimitLabel(policy.maxDurationSeconds)} 이하 파일만 올릴 수 있어요. 필요한 부분만 잘라서 올려 주세요.`
    case 'unreadable':
      return '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.'
    case 'timed-out':
      return '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.'
    default:
      return null
  }
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
