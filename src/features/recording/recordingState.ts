import { recordingLimitSeconds } from '../comparison/comparisonRules.ts'

export type MicrophoneProblem =
  'denied' | 'no-device' | 'busy' | 'interrupted' | 'unsupported'

export interface RecordedTake {
  readonly audio: Blob
  readonly durationSeconds: number
  readonly silent: boolean
}

export type RecordingState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting' }
  | { readonly phase: 'recording' }
  | { readonly phase: 'blocked'; readonly problem: MicrophoneProblem }
  | { readonly phase: 'review'; readonly take: RecordedTake }
  | { readonly phase: 'saving'; readonly take: RecordedTake }
  | {
      readonly phase: 'save-failed'
      readonly take: RecordedTake
      readonly message: string
    }

export type RecordingEvent =
  | { readonly type: 'start' }
  | { readonly type: 'granted' }
  | { readonly type: 'refused'; readonly problem: MicrophoneProblem }
  | { readonly type: 'finished'; readonly take: RecordedTake }
  | { readonly type: 'interrupted' }
  | { readonly type: 'cancel' }
  | { readonly type: 'save' }
  | { readonly type: 'save-failed'; readonly message: string }
  | { readonly type: 'saved' }
  | { readonly type: 'discard' }

export const SILENCE_PEAK = 0.01

const MICROPHONE_PROBLEM_COPY: Readonly<
  Record<
    MicrophoneProblem,
    { readonly title: string; readonly description: string }
  >
> = {
  denied: {
    title: '마이크를 쓸 수 없어요',
    description:
      '브라우저 주소창의 권한 설정에서 마이크를 허용하거나, 녹음해 둔 파일을 올려 주세요.',
  },
  'no-device': {
    title: '마이크를 찾지 못했어요',
    description:
      '마이크를 연결한 뒤 다시 시도하거나, 녹음해 둔 파일을 올려 주세요.',
  },
  busy: {
    title: '마이크를 시작하지 못했어요',
    description:
      '다른 앱이 마이크를 사용 중인지 확인하거나, 녹음해 둔 파일을 올려 주세요.',
  },
  interrupted: {
    title: '녹음이 중단됐어요',
    description: '마이크 연결을 확인한 뒤 다시 녹음해 주세요.',
  },
  unsupported: {
    title: '이 브라우저에서는 녹음할 수 없어요',
    description: '녹음해 둔 파일을 올려 주세요.',
  },
}

function errorName(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  return 'name' in error ? error.name : undefined
}

export function classifyMicrophoneError(error: unknown): MicrophoneProblem {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'AbortError':
      return 'busy'
    default:
      return 'unsupported'
  }
}

export function microphoneProblemCopy(problem: MicrophoneProblem): {
  readonly title: string
  readonly description: string
} {
  return MICROPHONE_PROBLEM_COPY[problem]
}

export function recordingReducer(
  state: RecordingState,
  event: RecordingEvent,
): RecordingState {
  switch (state.phase) {
    case 'idle':
      return event.type === 'start' ? { phase: 'requesting' } : state
    case 'requesting':
      if (event.type === 'granted') return { phase: 'recording' }
      if (event.type === 'refused') {
        return { phase: 'blocked', problem: event.problem }
      }
      return event.type === 'cancel' ? { phase: 'idle' } : state
    case 'recording':
      if (event.type === 'finished') {
        return { phase: 'review', take: event.take }
      }
      if (event.type === 'interrupted') {
        return { phase: 'blocked', problem: 'interrupted' }
      }
      return event.type === 'cancel' ? { phase: 'idle' } : state
    case 'blocked':
      if (event.type === 'start') return { phase: 'requesting' }
      return event.type === 'cancel' ? { phase: 'idle' } : state
    case 'review':
    case 'save-failed':
      if (event.type === 'save') return { phase: 'saving', take: state.take }
      return event.type === 'discard' ? { phase: 'idle' } : state
    case 'saving':
      if (event.type === 'save-failed') {
        return {
          phase: 'save-failed',
          take: state.take,
          message: event.message,
        }
      }
      return event.type === 'saved' ? { phase: 'idle' } : state
  }
}

export function isMicrophoneHeld(state: RecordingState): boolean {
  return state.phase === 'requesting' || state.phase === 'recording'
}

export function isSilentTake(peak: number): boolean {
  return !Number.isFinite(peak) || peak < SILENCE_PEAK
}

export function recordingStopReason(
  elapsedSeconds: number,
  sectionSeconds: number,
): 'limit' | null {
  return elapsedSeconds >= recordingLimitSeconds(sectionSeconds)
    ? 'limit'
    : null
}
