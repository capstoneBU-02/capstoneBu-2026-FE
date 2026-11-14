// Plays one section of a decoded song through Web Audio. Repeating uses the
// source's own loop points, so the section wraps without a gap; playing once
// schedules the stop at the section end. Framework-free so it can be tested
// with a stand-in for AudioContext.

// Seconds within the song; the end is exclusive.
export interface PlayRange {
  readonly start: number
  readonly end: number
}

export interface SectionPlayerOptions {
  // Called on the first play, inside the user's gesture, so the browser lets
  // the sound start.
  createContext: () => AudioContext
  // Playback stopped without being asked: the section ended or went away.
  onStop: () => void
  repeat: boolean
  // Output gain, 0 to 1.
  volume: number
}

export interface SectionPlayer {
  play(): void
  pause(): void
  // Back to the section start; keeps playing if it was.
  restart(): void
  // To this many seconds after the section start, kept inside the section;
  // keeps playing if it was.
  seek(elapsed: number): void
  // Other audio of the same section, such as another track of it, from the
  // same time since the section start. Keeps playing if it was, through the
  // same output.
  switchAudio(buffer: AudioBuffer, range: PlayRange | null): void
  setRange(range: PlayRange | null): void
  setRepeat(repeat: boolean): void
  setVolume(volume: number): void
  // Seconds within the song.
  position(): number
  // Seconds since the section start; 0 without a section.
  elapsed(): number
  playing(): boolean
  // Stops the sound and closes the output for good.
  dispose(): void
}

// Shorter sections cannot be looped reliably.
const MIN_SECONDS = 0.01
// Volume glides over about this many seconds instead of jumping, which clicks.
const GAIN_GLIDE_SECONDS = 0.015

// Where playback is after `elapsed` seconds from `offset` within the range.
export function sectionPosition(
  offset: number,
  elapsed: number,
  range: PlayRange,
  repeat: boolean,
): number {
  const position = offset + elapsed
  if (position < range.end) return position
  if (!repeat) return range.end
  return range.start + ((position - range.start) % (range.end - range.start))
}

function within(position: number, range: PlayRange): boolean {
  return position >= range.start && position < range.end
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// The part of a section the decoded audio covers. The song's metadata
// length, which the time inputs allow up to, can exceed it slightly.
export function playableRange(
  range: PlayRange | null,
  duration: number,
): PlayRange | null {
  if (!range) return null
  const end = Math.min(range.end, duration)
  return end - range.start >= MIN_SECONDS ? { start: range.start, end } : null
}

interface Output {
  readonly context: AudioContext
  readonly gain: GainNode
}

export function createSectionPlayer(
  buffer: AudioBuffer,
  options: SectionPlayerOptions,
): SectionPlayer {
  const { createContext, onStop } = options
  let audio = buffer
  let repeat = options.repeat
  let volume = options.volume
  let range: PlayRange | null = null
  let output: Output | null = null
  let source: AudioBufferSourceNode | null = null
  // While playing: the position and context time playback last started from.
  let anchor = { offset: 0, time: 0 }
  // While stopped: where play resumes. Null is the section start, wherever
  // that moves; a number is a position the player was paused or cut off at.
  let rest: number | null = null
  let disposed = false

  function now(): number {
    return output?.context.currentTime ?? 0
  }

  function position(): number {
    if (!source || !range) return rest ?? range?.start ?? 0
    return sectionPosition(anchor.offset, now() - anchor.time, range, repeat)
  }

  function resumeAt(at: number, target: PlayRange): number {
    return within(at, target) ? at : target.start
  }

  function openOutput(): Output {
    if (output) return output
    const context = createContext()
    const gain = context.createGain()
    gain.gain.value = volume
    gain.connect(context.destination)
    output = { context, gain }
    return output
  }

  // Stops the current source without reporting it.
  function release(): void {
    if (!source) return
    source.onended = null
    source.stop()
    source.disconnect()
    source = null
  }

  function scheduleEnd(node: AudioBufferSourceNode, at: number): void {
    if (!range || repeat) return
    node.stop(now() + (range.end - at))
  }

  function startAt(at: number): void {
    if (!range) return
    const { context, gain } = openOutput()
    if (context.state !== 'running') void context.resume()
    const node = context.createBufferSource()
    node.buffer = audio
    node.loop = repeat
    node.loopStart = range.start
    node.loopEnd = range.end
    node.connect(gain)
    node.onended = () => {
      if (source !== node) return
      node.disconnect()
      source = null
      rest = null
      onStop()
    }
    node.start(context.currentTime, at)
    source = node
    anchor = { offset: at, time: context.currentTime }
    scheduleEnd(node, at)
  }

  function setRange(next: PlayRange | null): void {
    const target = playableRange(next, audio.duration)
    if (target?.start === range?.start && target?.end === range?.end) return
    const at = position()
    range = target
    if (!target) {
      if (!source) return
      // A section that comes back resumes from here.
      rest = at
      release()
      onStop()
      return
    }
    if (!source) {
      // A position the new range leaves out goes back to its start.
      if (rest !== null && !within(rest, target)) rest = null
      return
    }
    if (!within(at, target)) {
      release()
      startAt(target.start)
      return
    }
    // Still inside: move the loop points under the running source.
    source.loopStart = target.start
    source.loopEnd = target.end
    anchor = { offset: at, time: now() }
    scheduleEnd(source, at)
  }

  // Seconds since the section start, or null at the start itself, which
  // moves with the section.
  function offset(): number | null {
    if (!range || (!source && rest === null)) return null
    return position() - range.start
  }

  function switchAudio(next: AudioBuffer, nextRange: PlayRange | null): void {
    if (disposed) return
    const playing = source !== null
    const elapsed = offset()
    release()
    audio = next
    range = playableRange(nextRange, next.duration)
    if (!range) {
      rest = null
      if (playing) onStop()
      return
    }
    const at = elapsed === null ? null : range.start + elapsed
    const inside = at !== null && within(at, range)
    if (playing) startAt(inside ? at : range.start)
    else rest = inside ? at : null
  }

  return {
    play() {
      if (disposed || source || !range) return
      startAt(rest === null ? range.start : resumeAt(rest, range))
    },
    pause() {
      if (!source || !range) return
      rest = resumeAt(position(), range)
      release()
    },
    restart() {
      if (disposed || !range) return
      if (!source) {
        rest = null
        return
      }
      release()
      startAt(range.start)
    },
    seek(elapsed) {
      if (disposed || !range) return
      const at = clamp(
        range.start + elapsed,
        range.start,
        range.end - MIN_SECONDS,
      )
      if (!source) {
        rest = at
        return
      }
      release()
      startAt(at)
    },
    switchAudio,
    setRange,
    setRepeat(next) {
      if (next === repeat) return
      const at = position()
      repeat = next
      if (!source || !range) return
      release()
      startAt(resumeAt(at, range))
    },
    setVolume(next) {
      volume = next
      if (output)
        output.gain.gain.setTargetAtTime(
          next,
          output.context.currentTime,
          GAIN_GLIDE_SECONDS,
        )
    },
    position,
    elapsed: () => (range ? position() - range.start : 0),
    playing: () => source !== null,
    dispose() {
      if (disposed) return
      disposed = true
      release()
      if (output) void output.context.close()
      output = null
    },
  }
}
