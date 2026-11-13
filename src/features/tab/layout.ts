import {
  beatTicks,
  type TabBar,
  type TabBeat,
  type TabDuration,
  type TabNote,
  type TabScore,
} from './model.ts'

// Sizes in CSS pixels. Fret numbers use Mono/Tab (JetBrains Mono 13/16); the
// font is monospaced with a 0.6 em advance, so text width is known up front.
export const TAB_METRICS = {
  fretSize: 13,
  smallSize: 10,
  charWidth: 13 * 0.6,
  smallCharWidth: 10 * 0.6,
  lineGap: 14,
  // Left of the staff: string names.
  staffX: 22,
  // Above the staff: bar numbers and P.M.
  top: 26,
  stemGap: 6,
  stem: 14,
  bottom: 8,
  rowGap: 22,
  maxBarsPerRow: 4,
  barPadLeft: 14,
  barPadRight: 10,
  // Room per weight unit before a bar moves to the next row. A beat whose
  // marks need more room takes it.
  minUnit: 11,
  minStaffWidth: 120,
  // Clear space between two fret numbers, or a number and a bar line.
  labelGap: 4,
  // Shortest tie arc, and the space at each end of it.
  tieMin: 8,
  tieGap: 1,
  // Space on each side of the `h` of a hammer-on.
  hammerGap: 2,
  // A rest glyph is 10 px wide; a dotted rest's dot reaches 9 px right.
  restHalfWidth: 5,
  restDotReach: 9,
} as const

// Clear space a tie arc or a hammer-on `h` needs between two fret numbers.
const TIE_ROOM = TAB_METRICS.tieMin + 2 * TAB_METRICS.tieGap
export const HAMMER_ROOM =
  TAB_METRICS.smallCharWidth + 2 * TAB_METRICS.hammerGap

// Room per duration: longer notes get more, though not in proportion.
const DURATION_WEIGHT: Readonly<Record<TabDuration, number>> = {
  1: 4,
  2: 2.8,
  4: 2,
  8: 1.4,
  16: 1,
}
const DOT_WEIGHT = 1.3

export interface TabRowBox {
  readonly index: number
  readonly y: number
  readonly staffTop: number
  readonly x: number
  readonly width: number
  readonly firstBar: number
  readonly lastBar: number
}

export interface TabBarBox {
  readonly index: number
  readonly number: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TabPlacedBeat {
  // Index into layout.bars, and into that bar's beats.
  readonly barIndex: number
  readonly indexInBar: number
  readonly row: number
  readonly x: number
  // Sixteenths from the start of the bar.
  readonly tick: number
  readonly beat: TabBeat
}

export interface TabLayout {
  // At least the requested width; wider when one bar does not fit.
  readonly width: number
  readonly height: number
  readonly rowHeight: number
  readonly staffHeight: number
  readonly barsPerRow: number
  // Sixteenths per beam group: a quarter, or a dotted quarter in 6/8.
  readonly beamGroupTicks: number
  readonly rows: readonly TabRowBox[]
  readonly bars: readonly TabBarBox[]
  // Every beat of the score in order; notation marks refer to these indexes.
  readonly beats: readonly TabPlacedBeat[]
}

// A held note shows its fret in brackets.
export const fretLabel = (note: TabNote) =>
  note.tieFromPrevious ? `(${note.fret})` : String(note.fret)

// Width of fret text such as `2` or `(12)` at the fret size.
export function fretTextWidth(text: string): number {
  return text.length * TAB_METRICS.charWidth
}

// How far a note's fret text reaches either side of its beat's x.
export const labelHalf = (note: TabNote) => fretTextWidth(fretLabel(note)) / 2

// Compound time (3/8, 6/8, 9/8, 12/8) beams in dotted quarters.
export function beamGroupTicks([beats, unit]: readonly [
  number,
  number,
]): number {
  const compound = unit >= 8 && beats % 3 === 0
  return compound ? (3 * 16) / unit : 4
}

interface Reach {
  readonly left: number
  readonly right: number
}

// One beat's share of a bar: weight × unit, but never less than `need`.
interface Span {
  readonly weight: number
  readonly need: number
}

interface BarSpacing {
  readonly padLeft: number
  readonly spans: readonly Span[]
  readonly minWidth: number
}

const weightOf = (beat: TabBeat) =>
  DURATION_WEIGHT[beat.duration] * (beat.dotted ? DOT_WEIGHT : 1)

// How far the marks a beat draws on the staff reach from its x.
function reachOf(beat: TabBeat): Reach {
  const { restHalfWidth, restDotReach } = TAB_METRICS
  if (beat.notes.length === 0) {
    const right = beat.dotted ? restDotReach : restHalfWidth
    return { left: restHalfWidth, right }
  }
  const half = Math.max(...beat.notes.map(labelHalf))
  return { left: half, right: half }
}

const roomBefore = (beat: TabBeat) =>
  beat.notes.some((note) => note.tieFromPrevious)
    ? TIE_ROOM
    : TAB_METRICS.labelGap

const roomAfter = (beat: TabBeat) =>
  beat.notes.some((note) => note.hammerOn) ? HAMMER_ROOM : TAB_METRICS.labelGap

// What each beat needs so fret numbers, ties and hammer-ons stay clear of
// each other and of the bar lines. A tie into the first beat may start at the
// staff edge after a wrap; a hammer-on out of the last beat stays in its bar.
function spacingOf(bar: TabBar): BarSpacing {
  const { barPadLeft, barPadRight, minUnit } = TAB_METRICS
  const { beats } = bar
  const reaches = beats.map(reachOf)
  const padLeft = Math.max(barPadLeft, reaches[0].left + roomBefore(beats[0]))
  const spans = beats.map((beat, index): Span => {
    const next = beats[index + 1]
    const need =
      next === undefined
        ? reaches[index].right + roomAfter(beat) - barPadRight
        : reaches[index].right +
          Math.max(roomAfter(beat), roomBefore(next)) +
          reaches[index + 1].left
    return { weight: weightOf(beat), need: Math.max(0, need) }
  })
  const inner = spans.reduce(
    (total, span) => total + Math.max(span.weight * minUnit, span.need),
    0,
  )
  return { padLeft, spans, minWidth: padLeft + inner + barPadRight }
}

const spanWidth = (span: Span, unit: number) =>
  Math.max(span.weight * unit, span.need)

// The unit at which the spans fill `inner` exactly. Spans switch from their
// need to weight × unit in order of need / weight, so the total grows in
// straight pieces and each piece solves directly.
function unitToFill(spans: readonly Span[], inner: number): number {
  const threshold = (span: Span) => span.need / span.weight
  const order = [...spans].sort((a, b) => threshold(a) - threshold(b))
  let fixed = order.reduce((total, span) => total + span.need, 0)
  let weight = 0
  let unit = 0
  for (const [index, span] of order.entries()) {
    fixed -= span.need
    weight += span.weight
    unit = (inner - fixed) / weight
    const next = order[index + 1]
    if (next === undefined || unit <= threshold(next)) break
  }
  return unit
}

function placeBeats(
  bar: TabBar,
  box: TabBarBox,
  spacing: BarSpacing,
): TabPlacedBeat[] {
  const inner = box.width - spacing.padLeft - TAB_METRICS.barPadRight
  const unit = unitToFill(spacing.spans, inner)
  let x = box.x + spacing.padLeft
  let tick = 0
  return bar.beats.map((beat, indexInBar): TabPlacedBeat => {
    const placed = {
      barIndex: box.index,
      indexInBar,
      row: box.row,
      x,
      tick,
      beat,
    }
    x += spanWidth(spacing.spans[indexInBar], unit)
    tick += beatTicks(beat)
    return placed
  })
}

// Bars share one width so bar lines line up from row to row. A row holds as
// many bars as fit at the widest bar's minimum, up to four. A width that is
// not a finite number counts as 0.
export function layoutTab(score: TabScore, width: number): TabLayout {
  const { lineGap, top, stemGap, stem, bottom, rowGap, staffX } = TAB_METRICS
  const target = Number.isFinite(width) ? Math.max(0, width) : 0
  const staffHeight = lineGap * (score.tuning.length - 1)
  const rowHeight = top + staffHeight + stemGap + stem + bottom
  const spacings = score.bars.map(spacingOf)
  const widest = spacings.reduce(
    (most, spacing) => Math.max(most, spacing.minWidth),
    0,
  )
  // One pixel stays free for the closing bar line.
  const available = Math.max(TAB_METRICS.minStaffWidth, target - staffX - 1)
  const barsPerRow = Math.max(
    1,
    Math.min(TAB_METRICS.maxBarsPerRow, Math.floor(available / widest)),
  )
  // Narrower than one bar: the bar keeps its minimum and the tab scrolls.
  const barWidth = Math.max(widest, available / barsPerRow)
  const rowY = (row: number) => row * (rowHeight + rowGap)

  const bars = score.bars.map((bar, index): TabBarBox => {
    const row = Math.floor(index / barsPerRow)
    return {
      index,
      number: bar.number,
      row,
      x: staffX + (index % barsPerRow) * barWidth,
      y: rowY(row),
      width: barWidth,
      height: rowHeight,
    }
  })
  const rowCount = Math.ceil(bars.length / barsPerRow)
  const rows = Array.from({ length: rowCount }, (_, index): TabRowBox => {
    const firstBar = index * barsPerRow
    const lastBar = Math.min(bars.length, firstBar + barsPerRow) - 1
    return {
      index,
      y: rowY(index),
      staffTop: rowY(index) + top,
      x: staffX,
      width: (lastBar - firstBar + 1) * barWidth,
      firstBar,
      lastBar,
    }
  })
  return {
    width: Math.max(target, staffX + barsPerRow * barWidth + 1),
    height: rowCount * rowHeight + (rowCount - 1) * rowGap,
    rowHeight,
    staffHeight,
    barsPerRow,
    beamGroupTicks: beamGroupTicks(score.timeSignature),
    rows,
    bars,
    beats: score.bars.flatMap((bar, index) =>
      placeBeats(bar, bars[index], spacings[index]),
    ),
  }
}

// The y of a string line; string 1 is the top line.
export function stringY(
  layout: TabLayout,
  row: number,
  string: number,
): number {
  return layout.rows[row].staffTop + (string - 1) * TAB_METRICS.lineGap
}

// E4 B3 G3 D3 A2 E2 → e B G D A E. The top string is lower case so it reads
// apart from a bottom string with the same name.
export function stringLabels(tuning: readonly string[]): readonly string[] {
  return tuning.map((name, index) => {
    const label = name.replace(/-?\d+$/, '')
    return index === 0 ? label.toLowerCase() : label
  })
}
