import {
  formatClockDuration,
  formatFileSize,
  songFileAccept,
} from '../add-song/songFile.ts'
import { UPLOAD_POLICY } from '../add-song/uploadPolicy.ts'
import { checkPerformanceLength } from './comparisonRules.ts'

export type PerformanceFileCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'valid'; readonly durationSeconds: number }
  | { readonly status: 'too-short'; readonly durationSeconds: number }
  | { readonly status: 'too-long'; readonly durationSeconds: number }
  | { readonly status: 'invalid-format' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'timed-out' }

export const PERFORMANCE_PRIVACY_NOTE =
  '올린 연주는 다른 테스터에게 보이지 않아요.'

function formatLabels(): string {
  return UPLOAD_POLICY.formats.map((format) => format.label).join(', ')
}

function sectionSecondsLabel(sectionSeconds: number): string {
  return sectionSeconds.toFixed(1)
}

export function checkPerformanceDuration(
  durationSeconds: number,
  sectionSeconds: number,
): PerformanceFileCheck {
  const status = checkPerformanceLength(durationSeconds, sectionSeconds)
  return status === 'unreadable' ? { status } : { status, durationSeconds }
}

export function performanceFileAccept(): string {
  return songFileAccept()
}

export function performanceUploadGuide(
  sectionName: string,
  sectionSeconds: number,
): string {
  // "구간을" keeps the particle right whatever the section is called.
  return `${sectionName}(${sectionSecondsLabel(sectionSeconds)}초) 구간을 연주한 파일을 올려 주세요. 반주 없이 기타 소리만 들어 있어야 해요.`
}

export function performanceUploadHint(): string {
  return `${formatLabels()} · 구간을 처음부터 끝까지 연주한 파일`
}

export function performanceFileMessage(
  check: PerformanceFileCheck,
  sectionSeconds: number,
): string | null {
  switch (check.status) {
    case 'too-short':
      return `구간(${sectionSecondsLabel(sectionSeconds)}초)보다 많이 짧아요. 구간 전체를 연주한 파일을 올려 주세요.`
    case 'too-long':
      return `구간(${sectionSecondsLabel(sectionSeconds)}초)보다 많이 길어요. 구간만 연주한 파일을 올려 주세요.`
    case 'invalid-format':
      return `${formatLabels()} 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.`
    case 'unreadable':
      return '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.'
    case 'timed-out':
      return '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.'
    case 'checking':
    case 'valid':
      return null
  }
}

export function performanceFileMeta(
  file: { readonly size: number },
  check: PerformanceFileCheck,
): string {
  const size = formatFileSize(file.size)
  switch (check.status) {
    case 'valid':
    case 'too-short':
    case 'too-long':
      return `${formatClockDuration(check.durationSeconds)} · ${size}`
    case 'checking':
      return `길이 확인 중 · ${size}`
    case 'unreadable':
    case 'timed-out':
      return `길이 알 수 없음 · ${size}`
    case 'invalid-format':
      return size
  }
}
