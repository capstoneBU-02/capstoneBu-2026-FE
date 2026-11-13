import {
  HAMMER_ROOM,
  labelHalf,
  stringY,
  TAB_METRICS,
  type TabLayout,
  type TabPlacedBeat,
} from './layout.ts'

// Marks drawn around the fret numbers, as plain geometry. Beat indexes refer
// to layout.beats.

export interface StemMark {
  readonly beatIndex: number
  readonly x: number
  readonly y1: number
  readonly y2: number
}

export interface BeamMark {
  readonly row: number
  readonly x1: number
  readonly x2: number
  readonly y: number
  // 1 for eighths, 2 for the extra sixteenth beam.
  readonly level: 1 | 2
}

export interface FlagMark {
  readonly beatIndex: number
  readonly x: number
  readonly y: number
  readonly count: 1 | 2
}

export interface DotMark {
  readonly beatIndex: number
  readonly x: number
  readonly y: number
}

export interface RhythmMarks {
  readonly stems: readonly StemMark[]
  readonly beams: readonly BeamMark[]
  readonly flags: readonly FlagMark[]
  readonly dots: readonly DotMark[]
}

export interface PalmMuteMark {
  readonly row: number
  readonly x1: number
  readonly x2: number
  readonly y: number
  // Only the first piece of a run that wraps carries the P.M. label.
  readonly labeled: boolean
}

export interface TieMark {
  readonly beatIndex: number
  readonly string: number
  readonly row: number
  readonly x1: number
  readonly x2: number
  readonly y: number
}

export interface HammerOnMark {
  readonly beatIndex: number
  readonly string: number
  readonly row: number
  readonly x: number
  readonly y: number
}

const HALF_STEM_RATIO = 0.55
const SECOND_BEAM_GAP = 4
const STUB_BEAM = 6
const TIE_DROP = 6
const PALM_MUTE_RISE = 6

const isNote = (placed: TabPlacedBeat) => placed.beat.notes.length > 0

function stemTop(layout: TabLayout, row: number): number {
  return layout.rows[row].staffTop + layout.staffHeight + TAB_METRICS.stemGap
}

// Eighths and sixteenths that follow each other within one beam group of a
// bar: a quarter, or a dotted quarter in compound time. A rest, a longer note
// or a bar line ends a group. Single beats get flags.
export function beamGroups(layout: TabLayout): readonly (readonly number[])[] {
  const groupOf = (placed: TabPlacedBeat) =>
    Math.floor(placed.tick / layout.beamGroupTicks)
  const groups: number[][] = []
  layout.beats.forEach((placed, index) => {
    if (!isNote(placed) || placed.beat.duration < 8) return
    const group = groups.at(-1)
    const previous = layout.beats[index - 1]
    const joins =
      group !== undefined &&
      group.at(-1) === index - 1 &&
      previous.barIndex === placed.barIndex &&
      groupOf(previous) === groupOf(placed)
    if (joins) group.push(index)
    else groups.push([index])
  })
  return groups
}

function sixteenthBeams(
  layout: TabLayout,
  group: readonly number[],
  y: number,
): BeamMark[] {
  const beats = group.map((index) => layout.beats[index])
  const row = beats[0].row
  const beams: BeamMark[] = []
  let runStart = -1
  beats.forEach((placed, i) => {
    const sixteenth = placed.beat.duration === 16
    if (sixteenth && runStart < 0) runStart = i
    const runEnds = sixteenth && beats[i + 1]?.beat.duration !== 16
    if (!runEnds) return
    const first = beats[runStart]
    if (runStart < i) {
      beams.push({ row, x1: first.x, x2: placed.x, y, level: 2 })
    } else if (beats[i + 1]) {
      const reach = Math.min(STUB_BEAM, (beats[i + 1].x - placed.x) / 2)
      beams.push({ row, x1: placed.x, x2: placed.x + reach, y, level: 2 })
    } else {
      const reach = Math.min(STUB_BEAM, (placed.x - beats[i - 1].x) / 2)
      beams.push({ row, x1: placed.x - reach, x2: placed.x, y, level: 2 })
    }
    runStart = -1
  })
  return beams
}

export function rhythmMarks(layout: TabLayout): RhythmMarks {
  const { stem } = TAB_METRICS
  const stems: StemMark[] = []
  const dots: DotMark[] = []
  layout.beats.forEach((placed, beatIndex) => {
    if (!isNote(placed)) return
    const { duration, dotted } = placed.beat
    const y1 = stemTop(layout, placed.row)
    const length =
      duration === 1 ? 0 : duration === 2 ? stem * HALF_STEM_RATIO : stem
    if (length > 0) stems.push({ beatIndex, x: placed.x, y1, y2: y1 + length })
    if (dotted) {
      const y = y1 + Math.max(length - 3, 3)
      dots.push({ beatIndex, x: placed.x + 4, y })
    }
  })

  const beams: BeamMark[] = []
  const flags: FlagMark[] = []
  for (const group of beamGroups(layout)) {
    const first = layout.beats[group[0]]
    const y = stemTop(layout, first.row) + stem
    if (group.length === 1) {
      const count = first.beat.duration === 16 ? 2 : 1
      flags.push({ beatIndex: group[0], x: first.x, y, count })
      continue
    }
    const last = layout.beats[group.at(-1)!]
    beams.push({ row: first.row, x1: first.x, x2: last.x, y, level: 1 })
    beams.push(...sixteenthBeams(layout, group, y - SECOND_BEAM_GAP))
  }
  return { stems, beams, flags, dots }
}

// Palm-muted beats in a row form one run. A run that wraps is cut per row.
export function palmMuteMarks(layout: TabLayout): readonly PalmMuteMark[] {
  const runs: TabPlacedBeat[][] = []
  layout.beats.forEach((placed, index) => {
    if (!placed.beat.palmMute) return
    const run = runs.at(-1)
    const continues = layout.beats[index - 1]?.beat.palmMute === true
    if (run !== undefined && continues) run.push(placed)
    else runs.push([placed])
  })
  return runs.flatMap((run) => {
    const rows = [...new Set(run.map((placed) => placed.row))]
    return rows.map((row, i): PalmMuteMark => {
      const inRow = run.filter((placed) => placed.row === row)
      return {
        row,
        x1: inRow[0].x - 4,
        x2: inRow.at(-1)!.x + 6,
        y: layout.rows[row].staffTop - PALM_MUTE_RISE,
        labeled: i === 0,
      }
    })
  })
}

const onString = (placed: TabPlacedBeat, string: number) =>
  placed.beat.notes.find((note) => note.string === string)!

// A tie arcs under the string from the held note's previous fret number, or
// from the start of the staff when the held note opens a new row.
export function tieMarks(layout: TabLayout): readonly TieMark[] {
  const { tieGap } = TAB_METRICS
  return layout.beats.flatMap((placed, beatIndex) =>
    placed.beat.notes
      .filter((note) => note.tieFromPrevious)
      .map((note): TieMark => {
        const previous = layout.beats[beatIndex - 1]
        const held = onString(previous, note.string)
        const x1 =
          previous.row === placed.row
            ? previous.x + labelHalf(held) + tieGap
            : layout.rows[placed.row].x
        return {
          beatIndex,
          string: note.string,
          row: placed.row,
          x1,
          x2: placed.x - labelHalf(note) - tieGap,
          y: stringY(layout, placed.row, note.string) + TIE_DROP,
        }
      }),
  )
}

// The `h` of `2h4` sits in the middle of the space between the two fret
// numbers. When the next note is in another bar it sits just after the first
// note, so it never lands on a bar line.
export function hammerOnMarks(layout: TabLayout): readonly HammerOnMark[] {
  return layout.beats.flatMap((placed, beatIndex) =>
    placed.beat.notes
      .filter((note) => note.hammerOn)
      .map((note): HammerOnMark => {
        const next = layout.beats[beatIndex + 1]
        const from = placed.x + labelHalf(note)
        const to = next.x - labelHalf(onString(next, note.string))
        return {
          beatIndex,
          string: note.string,
          row: placed.row,
          x:
            next.barIndex === placed.barIndex
              ? (from + to) / 2
              : from + HAMMER_ROOM / 2,
          y: stringY(layout, placed.row, note.string),
        }
      }),
  )
}
