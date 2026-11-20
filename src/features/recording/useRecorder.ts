import {
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { recordingLimitSeconds } from '../comparison/comparisonRules.ts'
import type {
  NewTake,
  SubmitTakeOutcome,
} from '../comparison/useComparisonSession.ts'
import { buildRecordedTake } from './recordedTake.ts'
import {
  RecorderEngineContext,
  type MicrophoneCapture,
  type MicrophoneRequest,
} from './recorderEngine.ts'
import {
  classifyMicrophoneError,
  recordingReducer,
  recordingStopReason,
  type RecordingState,
} from './recordingState.ts'

const SAVE_FAILED = '연주를 저장하지 못했어요. 다시 시도해 주세요.'

// What plays along with a take needs only the seconds recorded so far.
export type TakeClock = Pick<MicrophoneCapture, 'elapsedSeconds'>

export interface RecorderOptions {
  readonly sectionSeconds: number
  readonly onSubmit: (take: NewTake) => Promise<SubmitTakeOutcome>
  readonly onSaved: () => void
  readonly onCaptureChange?: (take: TakeClock | null) => void
  readonly onInterrupted?: () => void
}

export interface Recorder {
  readonly state: RecordingState
  // The microphone being heard, while a take is under way.
  readonly capture: MicrophoneCapture | null
  start(): void
  stop(): void
  restart(): void
  rerecord(): void
  cancel(): void
  submit(): void
}

export function useRecorder(options: RecorderOptions): Recorder {
  const engine = useContext(RecorderEngineContext)
  const [state, dispatch] = useReducer(recordingReducer, { phase: 'idle' })
  const [capture, setCapture] = useState<MicrophoneCapture | null>(null)
  const request = useRef<MicrophoneRequest | null>(null)
  const active = useRef<MicrophoneCapture | null>(null)
  const capturing = useRef(false)
  const submitting = useRef(false)
  const mounted = useRef(false)
  // The engine calls back long after the render that started the take.
  const latest = useRef(options)

  useLayoutEffect(() => {
    latest.current = options
  })

  function reportCapturing(next: boolean) {
    if (capturing.current === next) return
    capturing.current = next
    latest.current.onCaptureChange?.(next ? active.current : null)
  }

  function releaseMicrophone() {
    request.current?.release()
    request.current = null
    active.current = null
    setCapture(null)
    reportCapturing(false)
  }

  function finishTake() {
    const current = active.current
    if (!current) return
    const captured = current.finish()
    releaseMicrophone()
    const limit = recordingLimitSeconds(latest.current.sectionSeconds)
    try {
      // A context that never ran hands back nothing to listen to.
      if (captured.samples.length === 0) throw new RangeError('Empty take')
      dispatch({ type: 'finished', take: buildRecordedTake(captured, limit) })
    } catch {
      latest.current.onInterrupted?.()
      dispatch({ type: 'interrupted' })
    }
  }

  function start() {
    if (request.current) return
    dispatch({ type: 'start' })
    const opened: MicrophoneRequest = engine.open({
      onProgress(elapsedSeconds) {
        if (request.current !== opened || !active.current) return
        const { sectionSeconds } = latest.current
        if (recordingStopReason(elapsedSeconds, sectionSeconds)) finishTake()
      },
      onInterrupted() {
        if (request.current !== opened || !active.current) return
        releaseMicrophone()
        latest.current.onInterrupted?.()
        dispatch({ type: 'interrupted' })
      },
    })
    request.current = opened
    opened.capture.then(
      (granted) => {
        if (request.current !== opened) return
        active.current = granted
        setCapture(granted)
        dispatch({ type: 'granted' })
        reportCapturing(true)
      },
      (error: unknown) => {
        if (request.current !== opened) return
        releaseMicrophone()
        dispatch({ type: 'refused', problem: classifyMicrophoneError(error) })
      },
    )
  }

  async function saveTake() {
    if (state.phase !== 'review' && state.phase !== 'save-failed') return
    if (submitting.current) return
    submitting.current = true
    const { audio, durationSeconds } = state.take
    dispatch({ type: 'save' })
    try {
      const outcome = await latest.current.onSubmit({
        source: 'recording',
        audio,
        durationSeconds,
      })
      if (!mounted.current) return
      if (outcome.saved) {
        dispatch({ type: 'saved' })
        latest.current.onSaved()
      } else {
        dispatch({
          type: 'save-failed',
          message: outcome.message ?? SAVE_FAILED,
        })
      }
    } catch {
      if (mounted.current) {
        dispatch({ type: 'save-failed', message: SAVE_FAILED })
      }
    } finally {
      submitting.current = false
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      releaseMicrophone()
    }
    // Only the refs and setters it touches outlive the first render.
  }, [])

  return {
    state,
    capture,
    start,
    stop: finishTake,
    restart() {
      if (!active.current) return
      active.current.restart()
      // A new take begins, so whatever plays along starts over with it.
      reportCapturing(false)
      reportCapturing(true)
    },
    rerecord() {
      dispatch({ type: 'discard' })
      start()
    },
    cancel() {
      releaseMicrophone()
      dispatch({ type: 'cancel' })
      dispatch({ type: 'discard' })
    },
    submit() {
      void saveTake()
    },
  }
}
