import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_TAB_INPUTS } from '../src/features/tab/demoTabScores.ts'
import {
  layoutTab,
  stringLabels,
  stringY,
  TAB_METRICS,
} from '../src/features/tab/layout.ts'
import {
  beamGroups,
  hammerOnMarks,
  palmMuteMarks,
  rhythmMarks,
  tieMarks,
} from '../src/features/tab/notation.ts'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'

function parsed(input) {
  const result = parseTabScore(input)
  assert.equal(result.ok, true, result.error)
  return result.score
}

const standard = parsed(DEMO_TAB_INPUTS['e-standard'])
const dropD = parsed(DEMO_TAB_INPUTS['drop-d'])
const quarterRest = { duration: 4 }
const eighth = (string, fret, extra = {}) => ({
  duration: 8,
  notes: [{ string, fret }],
  ...extra,
})

function scoreOf(bars, tuning = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']) {
  return parsed({
    tuning,
    timeSignature: [4, 4],
    bars: bars.map((beats, index) => ({
      number: index + 1,
      startSeconds: index * 2,
      beats,
    })),
    endSeconds: bars.length * 2,
  })
}

const restBar = () => [quarterRest, quarterRest, quarterRest, quarterRest]

test('a wide tab fits four bars a row and a phone-width tab fits two', () => {
  const wide = layoutTab(standard, 1280)
  assert.equal(wide.barsPerRow, 4)
  assert.equal(wide.rows.length, 1)

  const phone = layoutTab(standard, 342)
  assert.equal(phone.barsPerRow, 2)
  assert.equal(phone.rows.length, 2)
  assert.deepEqual(
    phone.bars.map((bar) => bar.row),
    [0, 0, 1, 1],
  )
})

test('a row never holds more than four bars', () => {
  const layout = layoutTab(scoreOf(Array.from({ length: 8 }, restBar)), 2400)
  assert.equal(layout.barsPerRow, 4)
  assert.equal(layout.rows.length, 2)
})

test('a tab narrower than its widest bar falls back to one bar a row', () => {
  const layout = layoutTab(standard, 180)
  assert.equal(layout.barsPerRow, 1)
  assert.equal(layout.rows.length, 4)
})

test('bars in a row sit side by side and never pass the right edge', () => {
  for (const width of [320, 342, 390, 744, 1280]) {
    const layout = layoutTab(standard, width)
    for (const row of layout.rows) {
      const bars = layout.bars.filter((bar) => bar.row === row.index)
      assert.equal(bars[0].x, TAB_METRICS.staffX, `width ${width}`)
      for (let i = 1; i < bars.length; i += 1) {
        assert.ok(
          Math.abs(bars[i].x - (bars[i - 1].x + bars[i - 1].width)) < 1e-9,
        )
      }
    }
    const right = Math.max(...layout.bars.map((bar) => bar.x + bar.width))
    assert.ok(right <= width, `width ${width}: right edge ${right}`)
  }
})

test('rows stack with a gap and the height covers the last row', () => {
  const layout = layoutTab(scoreOf(Array.from({ length: 8 }, restBar)), 1280)
  const { rowHeight } = layout
  assert.equal(layout.rows[0].y, 0)
  assert.equal(layout.rows[1].y, rowHeight + TAB_METRICS.rowGap)
  assert.equal(layout.height, rowHeight * 2 + TAB_METRICS.rowGap)
  assert.equal(layout.bars[4].y, layout.rows[1].y)
  assert.equal(layout.bars[4].height, rowHeight)
})

test('fewer strings make a shorter row', () => {
  const bass = scoreOf([restBar()], ['G2', 'D2', 'A1', 'E1'])
  const guitar = scoreOf([restBar()])
  const eight = scoreOf(
    [restBar()],
    ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1', 'F#1'],
  )
  assert.equal(
    layoutTab(guitar, 800).rowHeight - layoutTab(bass, 800).rowHeight,
    2 * TAB_METRICS.lineGap,
  )
  assert.equal(
    layoutTab(eight, 800).rowHeight - layoutTab(guitar, 800).rowHeight,
    2 * TAB_METRICS.lineGap,
  )
})

test('beats run left to right inside their bar with their start ticks', () => {
  const layout = layoutTab(standard, 1280)
  const firstBar = layout.beats.filter((beat) => beat.barIndex === 0)
  assert.deepEqual(
    firstBar.map((beat) => beat.tick),
    [0, 2, 4, 6, 8, 10, 11, 12],
  )
  for (const bar of layout.bars) {
    const beats = layout.beats.filter((beat) => beat.barIndex === bar.index)
    beats.forEach((beat, i) => {
      assert.ok(beat.x > bar.x && beat.x < bar.x + bar.width)
      assert.equal(beat.indexInBar, i)
      assert.equal(beat.row, bar.row)
      if (i > 0) assert.ok(beat.x > beats[i - 1].x)
    })
  }
})

test('longer notes get more room than shorter ones', () => {
  const beats = layoutTab(standard, 1280).beats
  const afterEighth = beats[1].x - beats[0].x
  const afterSixteenth = beats[6].x - beats[5].x
  assert.ok(afterEighth > afterSixteenth)
  const wider = layoutTab(standard, 1600).beats
  assert.ok(wider[1].x - wider[0].x > afterEighth)
})

test('string lines are spaced evenly from the top of each staff', () => {
  const layout = layoutTab(standard, 342)
  assert.equal(stringY(layout, 0, 1), layout.rows[0].staffTop)
  assert.equal(
    stringY(layout, 1, 6),
    layout.rows[1].staffTop + 5 * TAB_METRICS.lineGap,
  )
})

test('string names drop the octave and the top string is lower case', () => {
  assert.deepEqual(stringLabels(standard.tuning), [
    'e',
    'B',
    'G',
    'D',
    'A',
    'E',
  ])
  assert.deepEqual(stringLabels(dropD.tuning), ['e', 'B', 'G', 'D', 'A', 'D'])
  assert.deepEqual(stringLabels(['F#4', 'C#4', 'Ab3', 'Eb3']), [
    'f#',
    'C#',
    'Ab',
    'Eb',
  ])
})

test('eighths and sixteenths beam together within one quarter of a bar', () => {
  assert.deepEqual(beamGroups(layoutTab(standard, 1280)), [
    [0, 1],
    [2, 3],
    [4, 5, 6],
    [11],
    [14, 15, 16, 17],
  ])
  // A rest breaks a group.
  const broken = scoreOf([
    [quarterRest, quarterRest, quarterRest, eighth(1, 0), eighth(1, 2)],
    [
      eighth(1, 3),
      { duration: 8 },
      eighth(1, 5),
      eighth(1, 7),
      quarterRest,
      quarterRest,
    ],
  ])
  assert.deepEqual(beamGroups(layoutTab(broken, 1280)), [[3, 4], [5], [7, 8]])
})

test('a bar line breaks a beam group even within one quarter', () => {
  // In 2/8 each bar is a single quarter, so only the bar line splits them.
  const twoEight = parsed({
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    timeSignature: [2, 8],
    bars: [1, 2].map((number) => ({
      number,
      startSeconds: number - 1,
      beats: [eighth(1, 0), eighth(1, 2)],
    })),
    endSeconds: 2,
  })
  assert.deepEqual(beamGroups(layoutTab(twoEight, 1280)), [
    [0, 1],
    [2, 3],
  ])
})

test('rhythm marks give stems, beams, flags and dots under the staff', () => {
  const layout = layoutTab(standard, 1280)
  const marks = rhythmMarks(layout)
  const stemmed = marks.stems.map((stem) => stem.beatIndex)
  // Rests (7, 10, 19) and the whole note (20) have no stem.
  assert.deepEqual(
    stemmed,
    [0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18],
  )
  const staffBottom = stringY(layout, 0, 6)
  for (const stem of marks.stems) {
    assert.equal(stem.x, layout.beats[stem.beatIndex].x)
    assert.ok(stem.y1 > staffBottom && stem.y2 > stem.y1)
  }
  assert.equal(marks.beams.filter((beam) => beam.level === 1).length, 4)
  const secondary = marks.beams.filter((beam) => beam.level === 2)
  assert.deepEqual(
    secondary.map((beam) => [beam.x1, beam.x2]),
    [
      [layout.beats[5].x, layout.beats[6].x],
      [layout.beats[14].x, layout.beats[17].x],
    ],
  )
  assert.deepEqual(
    marks.flags.map((flag) => [flag.beatIndex, flag.count]),
    [[11, 1]],
  )
  assert.deepEqual(
    marks.dots.map((dot) => dot.beatIndex),
    [18],
  )
})

test('a half note has a shorter stem than a quarter note', () => {
  const layout = layoutTab(dropD, 1280)
  const { stems } = rhythmMarks(layout)
  const half = stems.find(
    (stem) => layout.beats[stem.beatIndex].beat.duration === 2,
  )
  const quarter = stems.find(
    (stem) => layout.beats[stem.beatIndex].beat.duration === 4,
  )
  assert.ok(half.y2 - half.y1 < quarter.y2 - quarter.y1)
})

test('a lone sixteenth beside an eighth gets a short second beam', () => {
  const score = scoreOf([
    [
      { duration: 8, dotted: true, notes: [{ string: 1, fret: 0 }] },
      { duration: 16, notes: [{ string: 1, fret: 2 }] },
      quarterRest,
      quarterRest,
      quarterRest,
    ],
  ])
  const layout = layoutTab(score, 1280)
  const [stub] = rhythmMarks(layout).beams.filter((beam) => beam.level === 2)
  assert.ok(stub, 'expected a partial second beam')
  assert.equal(stub.x2, layout.beats[1].x)
  assert.ok(stub.x1 > layout.beats[0].x && stub.x1 < layout.beats[1].x)
})

test('a palm-mute run is one labelled mark from its first to last beat', () => {
  const layout = layoutTab(standard, 1280)
  const marks = palmMuteMarks(layout)
  assert.equal(marks.length, 1)
  const [mark] = marks
  assert.equal(mark.labeled, true)
  assert.equal(mark.row, 0)
  assert.ok(mark.x1 < layout.beats[0].x)
  assert.ok(mark.x2 > layout.beats[3].x && mark.x2 < layout.beats[4].x)
  assert.ok(mark.y < layout.rows[0].staffTop)
})

test('a palm-mute run that wraps is split per row and labelled once', () => {
  const pm = (fret) => eighth(6, fret, { palmMute: true })
  const score = scoreOf([
    restBar(),
    [quarterRest, quarterRest, quarterRest, pm(0), pm(1)],
    [pm(2), pm(3), quarterRest, quarterRest, quarterRest],
  ])
  const layout = layoutTab(score, 342)
  const marks = palmMuteMarks(layout)
  assert.deepEqual(
    marks.map((mark) => [mark.row, mark.labeled]),
    [
      [0, true],
      [1, false],
    ],
  )
})

test('a tie arcs from the previous note, and from the staff start after a wrap', () => {
  const wide = layoutTab(standard, 1280)
  const ties = tieMarks(wide)
  assert.deepEqual(
    ties.map((tie) => [tie.beatIndex, tie.string, tie.row]),
    [
      [12, 3, 0],
      [13, 3, 0],
    ],
  )
  for (const tie of ties) {
    assert.ok(tie.x1 > wide.beats[tie.beatIndex - 1].x)
    assert.ok(tie.x2 < wide.beats[tie.beatIndex].x && tie.x2 > tie.x1)
    assert.ok(tie.y > stringY(wide, 0, 3))
  }

  const phone = layoutTab(standard, 342)
  const wrapped = tieMarks(phone).find((tie) => tie.beatIndex === 13)
  assert.equal(wrapped.row, 1)
  assert.equal(wrapped.x1, phone.rows[1].x)
})

test('a hammer-on mark sits between its two notes on the string line', () => {
  const layout = layoutTab(dropD, 1280)
  const marks = hammerOnMarks(layout)
  assert.equal(marks.length, 1)
  const [mark] = marks
  assert.equal(mark.y, stringY(layout, 0, 5))
  assert.ok(mark.x > layout.beats[4].x && mark.x < layout.beats[5].x)
})

test('a hammer-on into the next row sits just after its first note', () => {
  const score = scoreOf([
    restBar(),
    [
      quarterRest,
      quarterRest,
      quarterRest,
      { duration: 4, notes: [{ string: 4, fret: 2, hammerOn: true }] },
    ],
    [
      { duration: 4, notes: [{ string: 4, fret: 4 }] },
      quarterRest,
      quarterRest,
      quarterRest,
    ],
  ])
  const layout = layoutTab(score, 342)
  const [mark] = hammerOnMarks(layout)
  const from = layout.beats[7]
  assert.equal(mark.row, from.row)
  assert.ok(mark.x > from.x)
  assert.ok(mark.x < layout.bars[1].x + layout.bars[1].width)
})

const SIX_STRINGS = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']
const note = (duration, string, fret, extra = {}) => ({
  duration,
  notes: [{ string, fret, ...extra }],
})
const tie = { tieFromPrevious: true }
const hammer = { hammerOn: true }

// Two-digit frets, bracketed ties and hammer-ons packed into short notes,
// with ties and hammer-ons on both sides of a bar line.
const crowded = scoreOf([
  [
    note(16, 1, 12),
    note(16, 1, 15),
    note(16, 1, 17),
    note(16, 1, 19),
    note(8, 2, 12),
    note(8, 2, 12, tie),
    note(4, 3, 14, hammer),
    note(4, 3, 17),
  ],
  [
    note(4, 3, 17, tie),
    note(8, 4, 10),
    note(8, 4, 10, tie),
    note(16, 5, 12, hammer),
    note(16, 5, 14),
    { duration: 8 },
    note(4, 6, 12, hammer),
  ],
  [note(4, 6, 15), note(4, 6, 15, tie), { duration: 2 }],
  [
    { duration: 2, dotted: true, notes: [{ string: 2, fret: 10 }] },
    note(4, 2, 10, tie),
  ],
])

const labelOf = (value) =>
  value.tieFromPrevious ? `(${value.fret})` : String(value.fret)
const halfLabel = (value) => (labelOf(value).length * TAB_METRICS.charWidth) / 2

// How far a beat's staff marks reach from its x: fret numbers, or a rest.
function reachOf(beat) {
  const { restHalfWidth, restDotReach } = TAB_METRICS
  if (beat.notes.length === 0) {
    return {
      left: restHalfWidth,
      right: beat.dotted ? restDotReach : restHalfWidth,
    }
  }
  const half = Math.max(...beat.notes.map(halfLabel))
  return { left: half, right: half }
}

test('fret numbers, ties and hammer-ons keep clear at any width', () => {
  const { labelGap, tieMin, smallCharWidth } = TAB_METRICS
  const slack = 1e-9
  for (let width = 150; width <= 1400; width += 1) {
    const layout = layoutTab(crowded, width)
    const at = `width ${width}`
    layout.beats.forEach((placed, index) => {
      const bar = layout.bars[placed.barIndex]
      const { left, right } = reachOf(placed.beat)
      assert.ok(placed.x - left >= bar.x + labelGap - slack, at)
      assert.ok(placed.x + right <= bar.x + bar.width - labelGap + slack, at)
      const next = layout.beats[index + 1]
      if (next?.row !== placed.row) return
      const gap = next.x - reachOf(next.beat).left - (placed.x + right)
      assert.ok(gap >= labelGap - slack, `${at}: beat ${index}`)
    })
    for (const mark of tieMarks(layout)) {
      assert.ok(
        mark.x2 - mark.x1 >= tieMin - slack,
        `${at}: tie at beat ${mark.beatIndex}`,
      )
    }
    for (const mark of hammerOnMarks(layout)) {
      const from = layout.beats[mark.beatIndex]
      const to = layout.beats[mark.beatIndex + 1]
      const onString = (beat) =>
        beat.notes.find((value) => value.string === mark.string)
      const bar = layout.bars[from.barIndex]
      const end =
        to.barIndex === from.barIndex
          ? to.x - halfLabel(onString(to.beat))
          : bar.x + bar.width
      const h = `${at}: h after beat ${mark.beatIndex}`
      assert.ok(
        mark.x - smallCharWidth / 2 > from.x + halfLabel(onString(from.beat)),
        h,
      )
      assert.ok(mark.x + smallCharWidth / 2 < end, h)
    }
  }
})

test('a layout never comes out narrower than its bars', () => {
  for (const width of [
    0,
    100,
    140,
    -20,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const layout = layoutTab(crowded, width)
    const at = `width ${width}`
    assert.ok(Number.isFinite(layout.width), at)
    assert.ok(Number.isFinite(layout.height), at)
    assert.ok(layout.barsPerRow >= 1 && layout.rows.length >= 1, at)
    const right = Math.max(...layout.bars.map((bar) => bar.x + bar.width))
    assert.ok(right <= layout.width, `${at}: right edge ${right}`)
  }
  assert.equal(layoutTab(standard, 1280).width, 1280)
})

test('compound time beams eighths in threes', () => {
  const oneBar = (timeSignature, beats) =>
    parsed({
      tuning: SIX_STRINGS,
      timeSignature,
      bars: [{ number: 1, startSeconds: 0, beats }],
      endSeconds: 2,
    })
  const eighths = (count) =>
    Array.from({ length: count }, (_, index) => eighth(1, index))

  const sixEight = layoutTab(oneBar([6, 8], eighths(6)), 1280)
  assert.deepEqual(beamGroups(sixEight), [
    [0, 1, 2],
    [3, 4, 5],
  ])
  const threeEight = layoutTab(oneBar([3, 8], eighths(3)), 1280)
  assert.deepEqual(beamGroups(threeEight), [[0, 1, 2]])
  assert.deepEqual(rhythmMarks(threeEight).flags, [])
  const threeFour = layoutTab(oneBar([3, 4], eighths(6)), 1280)
  assert.deepEqual(beamGroups(threeFour), [
    [0, 1],
    [2, 3],
    [4, 5],
  ])
})

test('a sixteenth at the start of a group gets a short beam to its right', () => {
  const score = scoreOf([
    [
      note(16, 1, 0),
      { duration: 8, dotted: true, notes: [{ string: 1, fret: 2 }] },
      note(16, 1, 3),
      note(8, 1, 5),
      note(16, 1, 7),
      quarterRest,
      quarterRest,
    ],
  ])
  const layout = layoutTab(score, 1280)
  const x = (index) => layout.beats[index].x
  const stubs = rhythmMarks(layout).beams.filter((beam) => beam.level === 2)
  assert.equal(stubs.length, 3)
  assert.equal(stubs[0].x1, x(0))
  assert.ok(stubs[0].x2 > x(0) && stubs[0].x2 < x(1))
  assert.equal(stubs[1].x1, x(2))
  assert.ok(stubs[1].x2 > x(2) && stubs[1].x2 < x(3))
  assert.equal(stubs[2].x2, x(4))
  assert.ok(stubs[2].x1 < x(4) && stubs[2].x1 > x(3))
})

test('a lone sixteenth gets two flags and a lone eighth one', () => {
  const score = scoreOf([
    [
      note(16, 1, 0),
      { duration: 16 },
      { duration: 8 },
      eighth(1, 2),
      { duration: 8 },
      quarterRest,
      quarterRest,
    ],
  ])
  const { flags } = rhythmMarks(layoutTab(score, 1280))
  assert.deepEqual(
    flags.map((flag) => [flag.beatIndex, flag.count]),
    [
      [0, 2],
      [3, 1],
    ],
  )
})

test('a beat without palm mute ends the run, a rest included', () => {
  const pm = (fret) => eighth(6, fret, { palmMute: true })
  const score = scoreOf([
    [
      pm(0),
      { duration: 8 },
      pm(0),
      { duration: 8, palmMute: true },
      pm(3),
      eighth(6, 0),
      quarterRest,
    ],
  ])
  const layout = layoutTab(score, 1280)
  const marks = palmMuteMarks(layout)
  assert.deepEqual(
    marks.map((mark) => mark.labeled),
    [true, true],
  )
  assert.ok(marks[1].x1 < layout.beats[2].x)
  assert.ok(marks[1].x2 > layout.beats[4].x && marks[1].x2 < layout.beats[5].x)
})

test('a P.M. label stays over its run, clear of the next beat and the bar line', () => {
  const sixteenth = (fret, extra = {}) => ({
    duration: 16,
    notes: [{ string: 6, fret }],
    ...extra,
  })
  const pm = (fret) => sixteenth(fret, { palmMute: true })
  const score = scoreOf([
    // A one-beat run before an open beat, then a run before a rest.
    [pm(0), sixteenth(0), pm(0), pm(0), quarterRest, quarterRest, quarterRest],
    // A one-beat run on the last beat of a bar.
    [
      quarterRest,
      quarterRest,
      quarterRest,
      sixteenth(0),
      sixteenth(0),
      sixteenth(0),
      pm(10),
    ],
  ])
  const labelWidth = 4 * TAB_METRICS.smallCharWidth
  const leftOf = (placed) =>
    placed.beat.notes.length === 0
      ? TAB_METRICS.restHalfWidth
      : Math.max(
          ...placed.beat.notes.map(
            (note) => (String(note.fret).length * TAB_METRICS.charWidth) / 2,
          ),
        )
  for (const width of [0, 200, 390, 640, 1280]) {
    const layout = layoutTab(score, width)
    const marks = palmMuteMarks(layout)
    assert.deepEqual(
      marks.map((mark) => mark.labeled),
      [true, true, true],
      `width ${width}`,
    )
    for (const mark of marks) {
      const labelEnd = mark.x1 + labelWidth
      const run = layout.beats.filter(
        (placed) =>
          placed.beat.palmMute &&
          placed.row === mark.row &&
          placed.x > mark.x1 &&
          placed.x < mark.x2,
      )
      const last = run.at(-1)
      const after = layout.beats[layout.beats.indexOf(last) + 1]
      if (after !== undefined && after.barIndex === last.barIndex) {
        assert.ok(labelEnd <= after.x - leftOf(after), `width ${width}`)
      } else {
        const bar = layout.bars[last.barIndex]
        assert.ok(labelEnd <= bar.x + bar.width, `width ${width}`)
      }
      assert.equal(mark.lineX1, labelEnd + 3)
    }
  }
})
