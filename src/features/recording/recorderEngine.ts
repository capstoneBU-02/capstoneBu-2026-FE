import { createContext } from 'react'
import {
  CAPTURE_PROCESSOR_NAME,
  CAPTURE_PROCESSOR_SOURCE,
  receiveCapture,
} from './captureWorklet.ts'
import type { CapturedAudio } from './recordedTake.ts'

export interface MicrophoneCapture {
  readonly deviceLabel: string
  elapsedSeconds(): number
  // The loudest sample of each block heard so far, oldest first.
  peaks(): readonly number[]
  // Forgets what was heard and keeps listening.
  restart(): void
  finish(): CapturedAudio
}

export interface CaptureListeners {
  // Called as sound arrives, also while the tab is in the background.
  onProgress(elapsedSeconds: number): void
  // The microphone went away during the take.
  onInterrupted(): void
}

export interface MicrophoneRequest {
  // Rejects with the browser's own error, which classifyMicrophoneError reads.
  readonly capture: Promise<MicrophoneCapture>
  // Safe at any moment and more than once, even before the browser answers.
  release(): void
}

export interface RecorderEngine {
  // Must be called directly from the click that starts the take: Safari lets
  // no sound in when the audio starts after the user's gesture has ended.
  open(listeners: CaptureListeners): MicrophoneRequest
}

// Guitar processing would change the very sound being compared.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

async function loadProcessor(context: AudioContext) {
  const url = URL.createObjectURL(
    new Blob([CAPTURE_PROCESSOR_SOURCE], { type: 'text/javascript' }),
  )
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// A context that cannot start delivers no sound, and the take then ends as
// interrupted; there is nothing more to do with the failure here.
function resumeQuietly(context: AudioContext) {
  context.resume().catch(() => undefined)
}

function listenToMicrophone(
  context: AudioContext,
  stream: MediaStream,
  track: MediaStreamTrack,
  listeners: CaptureListeners,
): { capture: MicrophoneCapture; disconnect: () => void } {
  const source = context.createMediaStreamSource(stream)
  const processor = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  // Browsers only run a node that leads to the output; silence keeps the
  // microphone from playing back into the room.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor).connect(mute).connect(context.destination)

  const received = receiveCapture(processor.port, (frames) =>
    listeners.onProgress(frames / context.sampleRate),
  )

  const onTrackEnded = () => listeners.onInterrupted()
  let hasRun = context.state === 'running'
  // A context that stops running stops the take without any error.
  const onContextState = () => {
    if (context.state === 'running') hasRun = true
    else if (hasRun) listeners.onInterrupted()
  }
  track.addEventListener('ended', onTrackEnded)
  context.addEventListener('statechange', onContextState)

  return {
    capture: {
      deviceLabel: track.label,
      elapsedSeconds: () => received.frames() / context.sampleRate,
      peaks: received.peaks,
      restart: received.restart,
      finish: () => ({
        samples: received.finish(),
        sampleRate: context.sampleRate,
      }),
    },
    disconnect() {
      track.removeEventListener('ended', onTrackEnded)
      context.removeEventListener('statechange', onContextState)
      processor.port.onmessage = null
      source.disconnect()
      processor.disconnect()
      mute.disconnect()
    },
  }
}

function openBrowserMicrophone(listeners: CaptureListeners): MicrophoneRequest {
  let context: AudioContext
  try {
    context = new AudioContext()
    resumeQuietly(context)
  } catch (error) {
    return { capture: Promise.reject(error), release() {} }
  }
  const audio = context

  let released = false
  let stream: MediaStream | null = null
  let disconnect = () => {}

  function release() {
    if (released) return
    released = true
    disconnect()
    if (stream) stopTracks(stream)
    audio.close().catch(() => undefined)
  }

  function assertHeld() {
    if (released) throw new DOMException('Released', 'AbortError')
  }

  async function connect() {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
    })
    stream = media
    if (released) stopTracks(media)
    assertHeld()
    await loadProcessor(audio)
    assertHeld()
    // Safari can suspend the context while its permission prompt is open.
    resumeQuietly(audio)
    const [track] = media.getAudioTracks()
    if (!track || track.readyState === 'ended') {
      throw new DOMException('No live track', 'NotReadableError')
    }
    const listening = listenToMicrophone(audio, media, track, listeners)
    disconnect = listening.disconnect
    return listening.capture
  }

  return {
    capture: connect().catch((error: unknown) => {
      release()
      throw error
    }),
    release,
  }
}

export const browserRecorderEngine: RecorderEngine = {
  open: openBrowserMicrophone,
}

export const RecorderEngineContext = createContext<RecorderEngine>(
  browserRecorderEngine,
)
