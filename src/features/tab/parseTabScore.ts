import {
  beatTicks,
  type TabBar,
  type TabBeat,
  type TabDuration,
  type TabNote,
  type TabScore,
} from './model.ts'

// Checks a transcription at the boundary and builds a fresh display model.
// The renderer trusts what comes out of here and never sees the input.
export type TabParseResult =
  | { readonly ok: true; readonly score: TabScore }
  | { readonly ok: false; readonly error: string }

const MIN_STRINGS = 4
const MAX_STRINGS = 8
const MAX_FRET = 24
const MAX_BEATS_PER_BAR = 32
const MAX_BARS = 1000
// Note values from whole to sixteenth, for durations and beat units alike.
const NOTE_VALUES: readonly number[] = [1, 2, 4, 8, 16]
const PITCH = /^[A-G][#b]?-?\d$/

type Fields = Readonly<Record<string, unknown>>

class TabFormatError extends Error {}

function fail(path: string, expected: string): never {
  throw new TabFormatError(`${path}: expected ${expected}`)
}

function record(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'an object')
  }
  return value as Fields
}

// A hole in a sparse array comes back as undefined and fails its own check.
function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'an array')
  return Array.from(value)
}

function flag(value: unknown, path: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') fail(path, 'true or false')
  return value
}

function integerIn(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fail(path, `an integer from ${min} to ${max}`)
  }
  return value
}

function secondsAfter(
  value: unknown,
  path: string,
  previous: number | null,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'seconds from 0')
  }
  if (previous !== null && value <= previous)
    fail(path, `seconds after ${previous}`)
  return value
}

function parseTuning(value: unknown): readonly string[] {
  const names = list(value, 'tuning')
  if (names.length < MIN_STRINGS || names.length > MAX_STRINGS) {
    fail('tuning', `${MIN_STRINGS} to ${MAX_STRINGS} pitch names`)
  }
  return names.map((name, index) => {
    if (typeof name !== 'string' || !PITCH.test(name)) {
      fail(`tuning[${index}]`, 'a pitch name such as E4 or F#3')
    }
    return name
  })
}

function parseTimeSignature(value: unknown): readonly [number, number] {
  const parts = list(value, 'timeSignature')
  const unit = parts[1]
  if (
    parts.length !== 2 ||
    typeof unit !== 'number' ||
    !NOTE_VALUES.includes(unit)
  ) {
    fail('timeSignature', '[beats, unit] with a unit of 1, 2, 4, 8 or 16')
  }
  return [integerIn(parts[0], 'timeSignature[0]', 1, MAX_BEATS_PER_BAR), unit]
}

function parseNote(value: unknown, path: string, strings: number): TabNote {
  const note = record(value, path)
  return {
    string: integerIn(note.string, `${path}.string`, 1, strings),
    fret: integerIn(note.fret, `${path}.fret`, 0, MAX_FRET),
    hammerOn: flag(note.hammerOn, `${path}.hammerOn`),
    tieFromPrevious: flag(note.tieFromPrevious, `${path}.tieFromPrevious`),
  }
}

function parseBeat(value: unknown, path: string, strings: number): TabBeat {
  const beat = record(value, path)
  const duration = beat.duration
  if (typeof duration !== 'number' || !NOTE_VALUES.includes(duration)) {
    fail(`${path}.duration`, '1, 2, 4, 8 or 16')
  }
  const dotted = flag(beat.dotted, `${path}.dotted`)
  if (dotted && duration === 16) fail(`${path}.dotted`, 'no dot on a sixteenth')
  const raw = beat.notes === undefined ? [] : list(beat.notes, `${path}.notes`)
  const notes = raw.map((note, index) =>
    parseNote(note, `${path}.notes[${index}]`, strings),
  )
  notes.forEach((note, index) => {
    if (notes.findIndex((other) => other.string === note.string) !== index) {
      fail(`${path}.notes[${index}].string`, 'one note per string in a beat')
    }
  })
  return {
    duration: duration as TabDuration,
    dotted,
    palmMute: flag(beat.palmMute, `${path}.palmMute`),
    notes,
  }
}

function parseBars(
  value: unknown,
  strings: number,
  barTicks: number,
): readonly TabBar[] {
  const raw = list(value, 'bars')
  if (raw.length === 0) fail('bars', 'at least one bar')
  if (raw.length > MAX_BARS) fail('bars', `at most ${MAX_BARS} bars`)
  const bars: TabBar[] = []
  raw.forEach((item, index) => {
    const path = `bars[${index}]`
    const bar = record(item, path)
    const previous = bars.at(-1)
    const number = integerIn(
      bar.number,
      `${path}.number`,
      (previous?.number ?? 0) + 1,
      Number.MAX_SAFE_INTEGER,
    )
    const startSeconds = secondsAfter(
      bar.startSeconds,
      `${path}.startSeconds`,
      previous?.startSeconds ?? null,
    )
    const rawBeats = list(bar.beats, `${path}.beats`)
    const beats = rawBeats.map((beat, beatIndex) =>
      parseBeat(beat, `${path}.beats[${beatIndex}]`, strings),
    )
    const ticks = beats.reduce((total, beat) => total + beatTicks(beat), 0)
    if (ticks !== barTicks) {
      fail(
        `${path}.beats`,
        `${barTicks} sixteenths to fill the bar, got ${ticks}`,
      )
    }
    bars.push({ number, startSeconds, beats })
  })
  return bars
}

// A tie holds the same fret from the beat before; a hammer-on goes up to a
// higher fret on the same string in the beat after. Both may cross a bar line.
function checkLinks(bars: readonly TabBar[]): void {
  const beats = bars.flatMap((bar, barIndex) =>
    bar.beats.map((beat, beatIndex) => ({
      beat,
      path: `bars[${barIndex}].beats[${beatIndex}]`,
    })),
  )
  beats.forEach(({ beat, path }, index) => {
    beat.notes.forEach((note, noteIndex) => {
      const notePath = `${path}.notes[${noteIndex}]`
      const before = beats[index - 1]?.beat.notes.find(
        (other) => other.string === note.string,
      )
      if (note.tieFromPrevious && before?.fret !== note.fret) {
        fail(
          `${notePath}.tieFromPrevious`,
          'the same fret on this string in the beat before',
        )
      }
      const after = beats[index + 1]?.beat.notes.find(
        (other) => other.string === note.string,
      )
      if (note.hammerOn && !(after !== undefined && after.fret > note.fret)) {
        fail(
          `${notePath}.hammerOn`,
          'a higher fret on this string in the beat after',
        )
      }
    })
  })
}

export function parseTabScore(input: unknown): TabParseResult {
  try {
    const score = record(input, 'score')
    const tuning = parseTuning(score.tuning)
    const timeSignature = parseTimeSignature(score.timeSignature)
    const barTicks = (timeSignature[0] * 16) / timeSignature[1]
    const bars = parseBars(score.bars, tuning.length, barTicks)
    checkLinks(bars)
    const endSeconds = secondsAfter(
      score.endSeconds,
      'endSeconds',
      bars.at(-1)!.startSeconds,
    )
    return { ok: true, score: { tuning, timeSignature, bars, endSeconds } }
  } catch (error) {
    if (error instanceof TabFormatError)
      return { ok: false, error: error.message }
    throw error
  }
}
