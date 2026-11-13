import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barAtTime } from '../src/features/tab/barAtTime.ts'
import { DEMO_TAB_INPUTS } from '../src/features/tab/demoTabScores.ts'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'

const quarter = (string, fret, extra = {}) => ({
  duration: 4,
  notes: [{ string, fret, ...extra }],
})
const rest = { duration: 4 }

// Four quarter-note bars in 4/4 on a six-string tuning, two seconds each.
function scoreWith(bars, overrides = {}) {
  return {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    timeSignature: [4, 4],
    bars: bars.map((beats, index) => ({
      number: index + 1,
      startSeconds: index * 2,
      beats,
    })),
    endSeconds: bars.length * 2,
    ...overrides,
  }
}

function errorOf(input) {
  const result = parseTabScore(input)
  assert.equal(result.ok, false, 'expected the input to be rejected')
  return result.error
}

test('the demo scores parse and every optional flag becomes a boolean', () => {
  for (const [id, input] of Object.entries(DEMO_TAB_INPUTS)) {
    const result = parseTabScore(input)
    assert.equal(result.ok, true, `${id}: ${result.error}`)
    for (const bar of result.score.bars) {
      for (const beat of bar.beats) {
        assert.equal(typeof beat.dotted, 'boolean')
        assert.equal(typeof beat.palmMute, 'boolean')
        assert.ok(Array.isArray(beat.notes))
        for (const note of beat.notes) {
          assert.equal(typeof note.hammerOn, 'boolean')
          assert.equal(typeof note.tieFromPrevious, 'boolean')
        }
      }
    }
  }
})

test('a beat with no notes is a rest with an empty note list', () => {
  const result = parseTabScore(scoreWith([[rest, rest, rest, rest]]))
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(result.score.bars[0].beats[0].notes, [])
})

test('parsing leaves the input untouched and shares no objects with it', () => {
  const input = scoreWith([[quarter(1, 0), rest, quarter(2, 1), rest]])
  const before = structuredClone(input)
  const result = parseTabScore(input)
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(input, before)
  assert.notEqual(result.score.bars, input.bars)
  assert.notEqual(result.score.bars[0].beats[0], input.bars[0].beats[0])
  assert.notEqual(result.score.tuning, input.tuning)
})

test('anything other than a score object is rejected', () => {
  assert.match(errorOf(null), /score/)
  assert.match(errorOf('tab'), /score/)
  assert.match(errorOf(scoreWith([], { tuning: undefined })), /tuning/)
})

test('the tuning needs four to eight pitch names', () => {
  const bars = [[rest, rest, rest, rest]]
  assert.match(
    errorOf(scoreWith(bars, { tuning: ['E4', 'B3', 'G3'] })),
    /tuning/,
  )
  assert.match(
    errorOf(scoreWith(bars, { tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'X2'] })),
    /tuning\[5\]/,
  )
  const sharps = parseTabScore(
    scoreWith(bars, { tuning: ['F#4', 'C#4', 'Ab3', 'Eb3'] }),
  )
  assert.equal(sharps.ok, true, sharps.error)
})

test('a score with no bars is rejected', () => {
  assert.match(errorOf(scoreWith([])), /bars/)
})

test('frets must be whole numbers from 0 to 24', () => {
  for (const fret of [-1, 25, 1.5, '3']) {
    assert.match(
      errorOf(scoreWith([[quarter(1, fret), rest, rest, rest]])),
      /bars\[0\]\.beats\[0\]\.notes\[0\]\.fret/,
      `fret ${fret}`,
    )
  }
  const high = parseTabScore(scoreWith([[quarter(1, 24), rest, rest, rest]]))
  assert.equal(high.ok, true, high.error)
})

test('a note must sit on a string the tuning has', () => {
  for (const string of [0, 7, 2.5]) {
    assert.match(
      errorOf(scoreWith([[quarter(string, 0), rest, rest, rest]])),
      /notes\[0\]\.string/,
      `string ${string}`,
    )
  }
})

test('a beat cannot hold two notes on the same string', () => {
  const chord = {
    duration: 4,
    notes: [
      { string: 3, fret: 2 },
      { string: 3, fret: 4 },
    ],
  }
  assert.match(
    errorOf(scoreWith([[chord, rest, rest, rest]])),
    /notes\[1\]\.string/,
  )
})

test('durations are whole to sixteenth, and a dotted sixteenth is refused', () => {
  assert.match(
    errorOf(scoreWith([[{ duration: 32 }, rest, rest, rest]])),
    /beats\[0\]\.duration/,
  )
  const dottedSixteenth = { duration: 16, dotted: true }
  assert.match(
    errorOf(scoreWith([[dottedSixteenth, rest, rest, rest]])),
    /beats\[0\]\.dotted/,
  )
})

test('each bar must fill the time signature exactly', () => {
  const short = errorOf(
    scoreWith([
      [rest, rest, rest, rest],
      [rest, rest, rest],
    ]),
  )
  assert.match(short, /bars\[1\]/)
  assert.match(short, /12/)
  assert.match(short, /16/)
  const waltz = parseTabScore(
    scoreWith([[{ duration: 2, dotted: true }]], { timeSignature: [3, 4] }),
  )
  assert.equal(waltz.ok, true, waltz.error)
  assert.match(
    errorOf(scoreWith([[rest, rest, rest, rest]], { timeSignature: [4, 3] })),
    /timeSignature/,
  )
})

test('bar numbers increase and bar times move forward within the section', () => {
  const bars = [
    [rest, rest, rest, rest],
    [rest, rest, rest, rest],
  ]
  const repeated = scoreWith(bars)
  repeated.bars[1].number = 1
  assert.match(errorOf(repeated), /bars\[1\]\.number/)

  const backwards = scoreWith(bars)
  backwards.bars[1].startSeconds = 0
  assert.match(errorOf(backwards), /bars\[1\]\.startSeconds/)

  assert.match(errorOf(scoreWith(bars, { endSeconds: 2 })), /endSeconds/)
  const negative = scoreWith(bars)
  negative.bars[0].startSeconds = -0.5
  assert.match(errorOf(negative), /bars\[0\]\.startSeconds/)
})

test('a tie needs the same string sounding in the beat before it', () => {
  const across = parseTabScore(
    scoreWith([
      [rest, rest, rest, quarter(3, 2)],
      [quarter(3, 2, { tieFromPrevious: true }), rest, rest, rest],
    ]),
  )
  assert.equal(across.ok, true, across.error)

  assert.match(
    errorOf(
      scoreWith([[quarter(3, 2, { tieFromPrevious: true }), rest, rest, rest]]),
    ),
    /bars\[0\]\.beats\[0\]\.notes\[0\]\.tieFromPrevious/,
  )
  assert.match(
    errorOf(
      scoreWith([
        [quarter(2, 2), quarter(3, 2, { tieFromPrevious: true }), rest, rest],
      ]),
    ),
    /beats\[1\]\.notes\[0\]\.tieFromPrevious/,
  )
  assert.match(
    errorOf(
      scoreWith([
        [quarter(3, 2), quarter(3, 4, { tieFromPrevious: true }), rest, rest],
      ]),
    ),
    /tieFromPrevious/,
  )
})

test('a hammer-on needs a note on the same string in the next beat', () => {
  assert.match(
    errorOf(scoreWith([[quarter(4, 2, { hammerOn: true }), rest, rest, rest]])),
    /beats\[0\]\.notes\[0\]\.hammerOn/,
  )
  assert.match(
    errorOf(scoreWith([[rest, rest, rest, quarter(4, 2, { hammerOn: true })]])),
    /hammerOn/,
  )
  const across = parseTabScore(
    scoreWith([
      [rest, rest, rest, quarter(4, 2, { hammerOn: true })],
      [quarter(4, 4), rest, rest, rest],
    ]),
  )
  assert.equal(across.ok, true, across.error)
})

test('the bar playing at a time is found from bar start times', () => {
  const result = parseTabScore(
    scoreWith([
      [rest, rest, rest, rest],
      [rest, rest, rest, rest],
      [rest, rest, rest, rest],
    ]),
  )
  assert.equal(result.ok, true, result.error)
  const { score } = result
  assert.equal(barAtTime(score, 0), 0)
  assert.equal(barAtTime(score, 1.99), 0)
  assert.equal(barAtTime(score, 2), 1)
  assert.equal(barAtTime(score, 5.5), 2)
  assert.equal(barAtTime(score, 6), null)
  assert.equal(barAtTime(score, -0.1), null)
  assert.equal(barAtTime(score, Number.NaN), null)
})

test('no bar is current before a score that starts late', () => {
  const input = scoreWith([[rest, rest, rest, rest]], { endSeconds: 3.5 })
  input.bars[0].startSeconds = 1.5
  const result = parseTabScore(input)
  assert.equal(result.ok, true, result.error)
  assert.equal(barAtTime(result.score, 1), null)
  assert.equal(barAtTime(result.score, 1.5), 0)
})

// Copies a list with a hole at one index, as an elided array element would.
function withHoleAt(items, hole) {
  const copy = new Array(items.length)
  items.forEach((item, index) => {
    if (index !== hole) copy[index] = item
  })
  return copy
}

test('holes in a list are rejected like missing values', () => {
  const sparseNotes = scoreWith([[quarter(1, 0), rest, rest, rest]])
  sparseNotes.bars[0].beats[0].notes = withHoleAt(
    [
      { string: 1, fret: 0 },
      { string: 2, fret: 0 },
    ],
    1,
  )
  assert.match(errorOf(sparseNotes), /beats\[0\]\.notes\[1\]/)

  const sparseBeats = scoreWith([[quarter(1, 0), rest, rest, rest]])
  sparseBeats.bars[0].beats = withHoleAt(
    [quarter(1, 0), rest, rest, rest, rest],
    1,
  )
  assert.match(errorOf(sparseBeats), /bars\[0\]\.beats\[1\]/)

  const sparseTuning = scoreWith([[rest, rest, rest, rest]], {
    tuning: withHoleAt(['E4', 'B3', 'G3', 'D3'], 1),
  })
  assert.match(errorOf(sparseTuning), /tuning\[1\]/)

  const sparseBars = scoreWith([[rest, rest, rest, rest]])
  sparseBars.bars = withHoleAt([sparseBars.bars[0], sparseBars.bars[0]], 1)
  assert.match(errorOf(sparseBars), /bars\[1\]/)
})

test('a list in place of the score or odd time signatures are rejected', () => {
  assert.match(errorOf([]), /score/)
  for (const timeSignature of [['4', 4], [Number.NaN, 4], [4, '4'], [4]]) {
    assert.match(
      errorOf(scoreWith([[rest, rest, rest, rest]], { timeSignature })),
      /timeSignature/,
      JSON.stringify(timeSignature),
    )
  }
})

test('bar and end times must be finite numbers', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '2']) {
    const start = scoreWith([
      [rest, rest, rest, rest],
      [rest, rest, rest, rest],
    ])
    start.bars[1].startSeconds = value
    assert.match(errorOf(start), /bars\[1\]\.startSeconds/, String(value))
    const end = scoreWith([[rest, rest, rest, rest]], { endSeconds: value })
    assert.match(errorOf(end), /endSeconds/, String(value))
  }
})

test('a score holds at most a thousand bars', () => {
  const bar = () => [rest, rest, rest, rest]
  const most = parseTabScore(scoreWith(Array.from({ length: 1000 }, bar)))
  assert.equal(most.ok, true, most.error)
  assert.match(
    errorOf(scoreWith(Array.from({ length: 1001 }, bar))),
    /bars: expected .*1000/,
  )
})

test('a hammer-on goes up to a higher fret on the same string', () => {
  for (const fret of [2, 1]) {
    assert.match(
      errorOf(
        scoreWith([
          [quarter(4, 2, { hammerOn: true }), quarter(4, fret), rest, rest],
        ]),
      ),
      /beats\[0\]\.notes\[0\]\.hammerOn/,
      `to fret ${fret}`,
    )
  }
  const open = parseTabScore(
    scoreWith([[quarter(4, 0, { hammerOn: true }), quarter(4, 2), rest, rest]]),
  )
  assert.equal(open.ok, true, open.error)
})

test('the bar found by search matches a scan of every bar', () => {
  for (const count of [1, 2, 3, 4, 5, 7, 8, 50]) {
    const input = scoreWith(
      Array.from({ length: count }, () => [rest, rest, rest, rest]),
    )
    input.bars.forEach((bar, index) => {
      bar.startSeconds = index * 1.37 + (index % 3) * 0.2
    })
    input.endSeconds = count * 1.37 + 1
    const result = parseTabScore(input)
    assert.equal(result.ok, true, result.error)
    const { bars, endSeconds } = result.score
    for (let time = -1; time < endSeconds + 1; time += 0.013) {
      const inside = time >= bars[0].startSeconds && time < endSeconds
      const expected = inside
        ? bars.findLastIndex((bar) => bar.startSeconds <= time)
        : null
      assert.equal(
        barAtTime(result.score, time),
        expected,
        `${count} @ ${time}`,
      )
    }
  }
  const { score } = parseTabScore(scoreWith([[rest, rest, rest, rest]]))
  assert.equal(barAtTime(score, Number.POSITIVE_INFINITY), null)
  assert.equal(barAtTime(score, Number.NEGATIVE_INFINITY), null)
})
