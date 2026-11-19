import { createContext } from 'react'
import type { CapturedAudio } from './recordedTake.ts'
import { measureLevel, mergeChunks } from './wavEncoder.ts'

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

const PROCESSOR_NAME = 'earmark-capture'
const BLOCK_FRAMES = 2048

// Guitar processing would change the very sound being compared.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

// Kept as text so the worklet needs no separate file for the bundler to place.
const PROCESSOR_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(${BLOCK_FRAMES})
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    let read = 0
    while (read < input.length) {
      const count = Math.min(
        input.length - read,
        this.block.length - this.filled,
      )
      this.block.set(input.subarray(read, read + count), this.filled)
      this.filled += count
      read += count
      if (this.filled === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer])
        this.block = new Float32Array(${BLOCK_FRAMES})
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('${PROCESSOR_NAME}', CaptureProcessor)
`

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

async function loadProcessor(context: AudioContext) {
  const url = URL.createObjectURL(
    new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }),
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
  const processor = new AudioWorkletNode(context, PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  // Browsers only run a node that leads to the output; silence keeps the
  // microphone from playing back into the room.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor).connect(mute).connect(context.destination)

  // Appended in place: copying per block would grow with the length of the take.
  let blocks: Float32Array[] = []
  let peaks: number[] = []
  let frames = 0
  let finished = false

  processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (finished) return
    blocks.push(event.data)
    peaks.push(measureLevel(event.data).peak)
    frames += event.data.length
    listeners.onProgress(frames / context.sampleRate)
  }

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
      elapsedSeconds: () => frames / context.sampleRate,
      peaks: () => peaks,
      restart() {
        blocks = []
        peaks = []
        frames = 0
      },
      finish() {
        finished = true
        return {
          samples: mergeChunks(blocks),
          sampleRate: context.sampleRate,
        }
      },
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
