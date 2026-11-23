import type {
  TabBar,
  TabBeat,
  TabDuration,
  TabNote,
  TabScore,
} from './model.ts'
import { MAX_BARS } from './parseTabScore.ts'

// Turns notes already placed on a beat grid into bars the renderer can draw.
// Onsets snap to the sixteenth, so triplets land on the nearest one; notes
// on one onset form a chord, and a length that no single value holds or that
// crosses a bar line goes on as ties.

export interface PlacedNote {
  // Seconds from the start of the section.
  readonly startSeconds: number
  // Quarter-note beats from the first bar's first downbeat.
  readonly beat: number
  // Length in quarter-note beats.
  readonly beats: number
  // 1 is the highest-pitched string.
  readonly string: number
  readonly fret: number
  // 0 to 1; the surer note keeps a string two notes share.
  readonly confidence: number
}

export interface NoteTranscription {
  // Pitch names, highest string first, as in TabScore.
  readonly tuning: readonly string[]
  readonly timeSignature: readonly [number, number]
  readonly tempoBpm: number
  readonly notes: readonly PlacedNote[]
}

const TICKS_PER_BEAT = 4

interface Piece {
  readonly ticks: number
  readonly duration: TabDuration
  readonly dotted: boolean
}

// Longest first; a sixteenth takes no dot.
const PIECES: readonly Piece[] = [
  { ticks: 16, duration: 1, dotted: false },
  { ticks: 12, duration: 2, dotted: true },
  { ticks: 8, duration: 2, dotted: false },
  { ticks: 6, duration: 4, dotted: true },
  { ticks: 4, duration: 4, dotted: false },
  { ticks: 3, duration: 8, dotted: true },
  { ticks: 2, duration: 8, dotted: false },
  { ticks: 1, duration: 16, dotted: false },
]

// Sixteenths from the first downbeat. A sound holds its chord; a rest has
// no notes.
interface Span {
  readonly start: number
  readonly end: number
  readonly notes: readonly TabNote[]
}

const tickOf = (beats: number) => Math.round(beats * TICKS_PER_BEAT)

// Map.groupBy is newer than the browsers this app supports.
function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => number,
): ReadonlyMap<number, readonly T[]> {
  const groups = new Map<number, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

// One note per string, the surest, lowest string number first.
function surestPerString(notes: readonly PlacedNote[]): PlacedNote[] {
  return [...groupBy(notes, (note) => note.string).values()]
    .map((same) =>
      same.reduce((kept, note) =>
        note.confidence > kept.confidence ? note : kept,
      ),
    )
    .sort((a, b) => a.string - b.string)
}

const tabNoteOf = ({ string, fret }: PlacedNote): TabNote => ({
  string,
  fret,
  hammerOn: false,
  tieFromPrevious: false,
})

// Each onset sounds until the last of its kept notes ends, up to the next
// onset. A note's end snaps on its own, so triplets that follow each other
// leave no gap.
function soundsOf(notes: readonly PlacedNote[]): readonly Span[] {
  const onsets = [...groupBy(notes, (note) => tickOf(note.beat))].sort(
    ([a], [b]) => a - b,
  )
  return onsets.map(([tick, group], index) => {
    const kept = surestPerString(group)
    const end = Math.max(
      ...kept.map((note) => Math.max(tick + 1, tickOf(note.beat + note.beats))),
    )
    const next = onsets[index + 1]?.[0] ?? Infinity
    return {
      start: tick,
      end: Math.min(end, next),
      notes: kept.map(tabNoteOf),
    }
  })
}

function withRests(
  sounds: readonly Span[],
  from: number,
  to: number,
): readonly Span[] {
  const rest = (start: number, end: number): Span[] =>
    end > start ? [{ start, end, notes: [] }] : []
  return [
    ...sounds.flatMap((sound, index) => [
      ...rest(sounds[index - 1]?.end ?? from, sound.start),
      sound,
    ]),
    ...rest(sounds.at(-1)?.end ?? from, to),
  ]
}

function piecesOf(ticks: number): readonly Piece[] {
  const piece = PIECES.find((item) => item.ticks <= ticks)
  return piece ? [piece, ...piecesOf(ticks - piece.ticks)] : []
}

// The part of a span from one tick to another. Every piece after the span's
// first holds the sound on.
function beatsOf(span: Span, from: number, to: number): TabBeat[] {
  return piecesOf(to - from).map((piece, index) => {
    const tied = index > 0 || from > span.start
    return {
      duration: piece.duration,
      dotted: piece.dotted,
      palmMute: false,
      notes: span.notes.map((note) => ({ ...note, tieFromPrevious: tied })),
    }
  })
}

function barBeats(spans: readonly Span[], start: number, end: number) {
  return spans
    .filter((span) => span.start < end && span.end > start)
    .flatMap((span) =>
      beatsOf(span, Math.max(span.start, start), Math.min(span.end, end)),
    )
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

interface Meter {
  readonly beatsPerBar: number
  readonly beatSeconds: number
  readonly firstBar: number
  readonly count: number
}

// Where each bar's downbeat sounds, by the middle of what its notes say, so
// a stray note does not move it. Null for a bar that starts no note.
function heardDownbeats(
  notes: readonly PlacedNote[],
  meter: Meter,
): readonly (number | null)[] {
  const { beatsPerBar, beatSeconds, firstBar, count } = meter
  const byBar = groupBy(notes, (note) =>
    Math.floor(tickOf(note.beat) / (beatsPerBar * TICKS_PER_BEAT)),
  )
  return Array.from({ length: count }, (_, index) => {
    const downbeat = (firstBar + index) * beatsPerBar
    const own = byBar.get(firstBar + index)
    return own
      ? median(
          own.map(
            (note) => note.startSeconds - (note.beat - downbeat) * beatSeconds,
          ),
        )
      : null
  })
}

// A bar with no note of its own lies evenly between its neighbours, or a
// bar's length after the last bar heard. The first bar always starts a note.
function filled(
  heard: readonly (number | null)[],
  barSeconds: number,
): readonly number[] {
  return heard.map((time, index) => {
    if (time !== null) return time
    const before = heard.findLastIndex((t, i) => i < index && t !== null)
    const after = heard.findIndex((t, i) => i > index && t !== null)
    const from = heard[before]!
    if (after === -1) return from + (index - before) * barSeconds
    const to = heard[after]!
    return from + ((to - from) * (index - before)) / (after - before)
  })
}

// From 0 s, so a pickup bar starts with the section, and each bar at least
// a sixteenth after the one before.
function forward(times: readonly number[], gap: number): readonly number[] {
  return times.reduce<number[]>((kept, time) => {
    const previous = kept.at(-1)
    const next =
      previous === undefined
        ? Math.max(0, time)
        : Math.max(time, previous + gap)
    return [...kept, next]
  }, [])
}

function canConvert({ notes, timeSignature, tempoBpm }: NoteTranscription) {
  const [beatsPerBar, unit] = timeSignature
  return (
    notes.length > 0 &&
    unit === 4 &&
    Number.isInteger(beatsPerBar) &&
    beatsPerBar > 0 &&
    Number.isFinite(tempoBpm) &&
    tempoBpm > 0 &&
    notes.every((note) => note.beat >= 0)
  )
}

// Null when there is nothing to draw, the meter is not in quarter notes or
// the notes run past the bars the screen draws.
export function scoreFromNotes(input: NoteTranscription): TabScore | null {
  if (!canConvert(input)) return null
  const [beatsPerBar] = input.timeSignature
  const barTicks = beatsPerBar * TICKS_PER_BEAT
  const sounds = soundsOf(input.notes)
  const firstBar = Math.floor(sounds[0].start / barTicks)
  const lastBar = Math.ceil(sounds.at(-1)!.end / barTicks)
  if (lastBar - firstBar > MAX_BARS) return null
  const spans = withRests(sounds, firstBar * barTicks, lastBar * barTicks)
  const beatSeconds = 60 / input.tempoBpm
  const barSeconds = beatsPerBar * beatSeconds
  const meter = {
    beatsPerBar,
    beatSeconds,
    firstBar,
    count: lastBar - firstBar,
  }
  const times = forward(
    filled(heardDownbeats(input.notes, meter), barSeconds),
    beatSeconds / TICKS_PER_BEAT,
  )
  const bars: TabBar[] = times.map((startSeconds, index) => {
    const start = (firstBar + index) * barTicks
    return {
      number: index + 1,
      startSeconds,
      beats: barBeats(spans, start, start + barTicks),
    }
  })
  return {
    tuning: [...input.tuning],
    timeSignature: [beatsPerBar, 4],
    bars,
    endSeconds: times.at(-1)! + barSeconds,
  }
}
