import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RecordingPanel } from '../../../src/features/recording/RecordingPanel.tsx'
import {
  browserRecorderEngine,
  RecorderEngineContext,
  type CaptureListeners,
  type MicrophoneCapture,
  type MicrophoneRequest,
  type RecorderEngine,
} from '../../../src/features/recording/recorderEngine.ts'

// The harness replaces window.AudioContext, so the real microphone code cannot
// run here. comparison=1 swaps in this engine, whose clock moves only when a
// test calls advance().
//   recording=denied|no-device|busy|unsupported  how the browser answers
//   recording=held                               waits for grant() or refuse()
//   recording=silent                             hears nothing
type Answer = 'granted' | 'held' | 'silent' | keyof typeof REFUSALS

const REFUSALS = {
  denied: 'NotAllowedError',
  'no-device': 'NotFoundError',
  busy: 'NotReadableError',
  unsupported: 'TypeError',
} as const

// A rate no device records at, so a take that changed it would show.
const INPUT_RATE = 8_000
const BLOCK_SECONDS = 0.05
const BLOCK_FRAMES = INPUT_RATE * BLOCK_SECONDS
const TONE_HZ = 220
const TONE_LEVEL = 0.5

const query = new URLSearchParams(window.location.search)

let answer = (query.get('recording') ?? 'granted') as Answer
let opens = 0
let releases = 0
let answerHeld: ((refusal: string | null) => void) | null = null
let listening: {
  readonly listeners: CaptureListeners
  readonly hear: () => void
} | null = null

export interface RecordingTestControls {
  // How often the microphone was asked for.
  opens(): number
  // Requests still holding the microphone.
  held(): number
  // How the next request is answered.
  answerNext(next: Answer): void
  grant(): void
  refuse(next: keyof typeof REFUSALS): void
  // Sound arrives for this long, or until the take ends.
  advance(seconds: number): void
  disconnect(): void
  // A panel of its own, named 캡처 녹음, that logs what it reports to the
  // screen around it. The task screen does not listen yet.
  mountPanel(): void
  unmountPanel(): void
  captureChanges(): readonly boolean[]
}

declare global {
  interface Window {
    recordingTest: RecordingTestControls
  }
}

function refusal(name: string) {
  return new DOMException('Refused by the test', name)
}

function createCapture(
  listeners: CaptureListeners,
  silent: boolean,
): MicrophoneCapture & { hear(): void } {
  let blocks: Float32Array[] = []
  let frames = 0

  function hear() {
    const block = new Float32Array(BLOCK_FRAMES).map((_, index) =>
      silent
        ? 0
        : Math.sin((2 * Math.PI * TONE_HZ * (frames + index)) / INPUT_RATE) *
          TONE_LEVEL,
    )
    blocks = [...blocks, block]
    frames += BLOCK_FRAMES
    listeners.onProgress(frames / INPUT_RATE)
  }

  return {
    deviceLabel: 'USB 오디오 인터페이스',
    hear,
    elapsedSeconds: () => frames / INPUT_RATE,
    peaks: () => blocks.map(() => (silent ? 0 : TONE_LEVEL)),
    restart() {
      blocks = []
      frames = 0
    },
    finish() {
      const samples = new Float32Array(frames)
      blocks.forEach((block, index) => {
        samples.set(block, index * BLOCK_FRAMES)
      })
      return { samples, sampleRate: INPUT_RATE }
    },
  }
}

function openFake(listeners: CaptureListeners): MicrophoneRequest {
  opens += 1
  const asked = answer
  let released = false

  const capture = new Promise<MicrophoneCapture>((resolve, reject) => {
    function settle(refused: string | null) {
      if (refused !== null) return reject(refusal(refused))
      const opened = createCapture(listeners, asked === 'silent')
      listening = { listeners, hear: opened.hear }
      resolve(opened)
    }
    if (asked === 'held') answerHeld = settle
    else if (asked === 'granted' || asked === 'silent')
      queueMicrotask(() => settle(null))
    else settle(REFUSALS[asked])
  })

  return {
    capture,
    release() {
      if (released) return
      released = true
      releases += 1
      listening = null
      answerHeld?.('AbortError')
      answerHeld = null
    },
  }
}

let mountedPanel: Root | null = null
let captureChanges: readonly boolean[] = []

function mountPanel() {
  mountedPanel = createRoot(
    document.body.appendChild(document.createElement('div')),
  )
  mountedPanel.render(
    createElement(
      RecorderEngineContext,
      { value: { open: openFake } },
      createElement(RecordingPanel, {
        sectionName: '캡처',
        sectionSeconds: 10,
        onSubmit: () => Promise.resolve({ saved: true, message: null }),
        onUploadInstead() {},
        onClose() {},
        onCaptureChange(take) {
          captureChanges = [...captureChanges, take !== null]
        },
      }),
    ),
  )
}

window.recordingTest = {
  mountPanel,
  unmountPanel() {
    mountedPanel?.unmount()
    mountedPanel = null
  },
  captureChanges: () => captureChanges,
  opens: () => opens,
  held: () => opens - releases,
  answerNext(next) {
    answer = next
  },
  grant() {
    answerHeld?.(null)
    answerHeld = null
  },
  refuse(next) {
    answerHeld?.(REFUSALS[next])
    answerHeld = null
  },
  advance(seconds) {
    const blocks = Math.round(seconds / BLOCK_SECONDS)
    for (let block = 0; block < blocks && listening; block += 1) {
      listening.hear()
    }
  },
  disconnect() {
    listening?.listeners.onInterrupted()
  },
}

export const harnessRecorderEngine: RecorderEngine = query.has('comparison')
  ? { open: openFake }
  : browserRecorderEngine
