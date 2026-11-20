// Both halves of the microphone capture: the worklet that gathers sound on
// the audio thread, and what the page keeps of it. Free of the browser's
// audio objects so the two can be tested together.
import { measureLevel, mergeChunks } from './wavEncoder.ts'

export const CAPTURE_PROCESSOR_NAME = 'earmark-capture'
const BLOCK_FRAMES = 2048

// Kept as text so the worklet needs no separate file for the bundler to place.
// Each block carries the number of the take it was heard for. 처음부터 sends
// the worklet the next number, and the part block it holds belongs to the
// take just given up.
export const CAPTURE_PROCESSOR_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.take = 0
    this.block = new Float32Array(${BLOCK_FRAMES})
    this.filled = 0
    this.port.onmessage = (event) => {
      this.take = event.data
      this.filled = 0
    }
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
        this.port.postMessage(
          { take: this.take, samples: this.block },
          [this.block.buffer],
        )
        this.block = new Float32Array(${BLOCK_FRAMES})
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('${CAPTURE_PROCESSOR_NAME}', CaptureProcessor)
`

// The page's end of the worklet's message port.
export interface CapturePort {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
}

interface CaptureBlock {
  readonly take: number
  readonly samples: Float32Array
}

export interface ReceivedCapture {
  frames(): number
  // The loudest sample of each block heard so far, oldest first.
  peaks(): readonly number[]
  // Forgets what was heard and keeps listening.
  restart(): void
  // Everything heard; later blocks are ignored.
  finish(): Float32Array
}

// Keeps the blocks the worklet sends for the take under way.
export function receiveCapture(
  port: CapturePort,
  onFrames: (frames: number) => void,
): ReceivedCapture {
  // Appended in place: copying per block would grow with the length of the take.
  let blocks: Float32Array[] = []
  let peaks: number[] = []
  let frames = 0
  let take = 0
  let finished = false

  port.onmessage = (event: MessageEvent<CaptureBlock>) => {
    const { take: heardFor, samples } = event.data
    // A block of the take given up can still be on its way after 처음부터.
    if (finished || heardFor !== take) return
    blocks.push(samples)
    peaks.push(measureLevel(samples).peak)
    frames += samples.length
    onFrames(frames)
  }

  return {
    frames: () => frames,
    peaks: () => peaks,
    restart() {
      take += 1
      blocks = []
      peaks = []
      frames = 0
      port.postMessage(take)
    },
    finish() {
      finished = true
      return mergeChunks(blocks)
    },
  }
}
