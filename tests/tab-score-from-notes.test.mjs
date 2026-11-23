import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'
import { scoreFromNotes } from '../src/features/tab/scoreFromNotes.ts'

// At 120 BPM a beat is half a second and a 4/4 bar two seconds; the first
// downbeat sounds 0.25 s into the section. The values stay exact in binary.
const TEMPO = 120
const DOWNBEAT = 0.25
const TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']

const note = (beat, beats, string, fret, extra = {}) => ({
  startSeconds: DOWNBEAT + beat * 0.5,
  beat,
  beats,
  string,
  fret,
  confidence: 0.9,
  ...extra,
})

const transcription = (notes, extra = {}) => ({
  tuning: TUNING,
  timeSignature: [4, 4],
  tempoBpm: TEMPO,
  notes,
  ...extra,
})

// [string, fret] or [string, fret, tied]; no notes for a rest.
const beat = (duration, notes = [], dotted = false) => ({
  duration,
  dotted,
  palmMute: false,
  notes: notes.map(([string, fret, tied = false]) => ({
    string,
    fret,
    hammerOn: false,
    tieFromPrevious: tied,
  })),
})

const bar = (number, startSeconds, beats) => ({ number, startSeconds, beats })

// Every converted score must pass the screen's own check.
function convert(input) {
  const score = scoreFromNotes(input)
  assert.notEqual(score, null, 'expected a score')
  const parsed = parseTabScore(score)
  assert.equal(parsed.ok, true, parsed.error)
  return score
}

test('four quarter notes fill one bar that starts on the first downbeat', () => {
  const score = convert(
    transcription([
      note(0, 1, 1, 0),
      note(1, 1, 2, 1),
      note(2, 1, 3, 2),
      note(3, 1, 4, 3),
    ]),
  )
  assert.deepEqual(score, {
    tuning: TUNING,
    timeSignature: [4, 4],
    bars: [
      bar(1, 0.25, [
        beat(4, [[1, 0]]),
        beat(4, [[2, 1]]),
        beat(4, [[3, 2]]),
        beat(4, [[4, 3]]),
      ]),
    ],
    endSeconds: 2.25,
  })
})

test('notes on one onset form a chord that keeps the surer note per string', () => {
  const score = convert(
    transcription([
      note(0, 4, 2, 1, { confidence: 0.5 }),
      note(0, 4, 1, 0),
      note(0, 4, 1, 5, { confidence: 0.4 }),
      note(0, 4, 2, 3, { confidence: 0.8 }),
    ]),
  )
  assert.deepEqual(score.bars[0].beats, [
    beat(1, [
      [1, 0],
      [2, 3],
    ]),
  ])
})

test('a note across a bar line goes on as a tie in the next bar', () => {
  const score = convert(transcription([note(3, 2, 3, 2)]))
  assert.deepEqual(score.bars, [
    bar(1, 0.25, [beat(2, [], true), beat(4, [[3, 2]])]),
    bar(2, 2.25, [beat(4, [[3, 2, true]]), beat(2, [], true)]),
  ])
  assert.equal(score.endSeconds, 4.25)
})

test('a note stops at the next onset and silence becomes rests', () => {
  const score = convert(
    transcription([note(0, 3, 1, 3), note(2, 1, 2, 2), note(4, 1, 1, 0)]),
  )
  assert.deepEqual(score.bars, [
    bar(1, 0.25, [beat(2, [[1, 3]]), beat(4, [[2, 2]]), beat(4)]),
    bar(2, 2.25, [beat(4, [[1, 0]]), beat(2, [], true)]),
  ])
})

test('lengths take dotted values and tie what no single value holds', () => {
  const score = convert(
    transcription([
      note(0, 1.5, 1, 1),
      note(1.5, 0.75, 1, 2),
      note(2.25, 1.25, 1, 3),
      note(3.5, 0.5, 1, 4),
    ]),
  )
  assert.deepEqual(score.bars[0].beats, [
    beat(4, [[1, 1]], true),
    beat(8, [[1, 2]], true),
    beat(4, [[1, 3]]),
    beat(16, [[1, 3, true]]),
    beat(8, [[1, 4]]),
  ])
})

test('triplets snap to the nearest sixteenth and leave no gap between them', () => {
  const third = 1 / 3
  const score = convert(
    transcription([
      note(0, third, 1, 0),
      note(third, third, 1, 1),
      note(2 * third, third, 1, 2),
      note(1, 3, 1, 3),
    ]),
  )
  assert.deepEqual(score.bars[0].beats, [
    beat(16, [[1, 0]]),
    beat(8, [[1, 1]]),
    beat(16, [[1, 2]]),
    beat(2, [[1, 3]], true),
  ])
})

test('a note ends where its own end snaps, not after its rounded length', () => {
  // From the second triplet eighth to the second beat's last triplet eighth.
  const score = convert(transcription([note(1 / 3, 4 / 3, 1, 0)]))
  assert.deepEqual(score.bars[0].beats, [
    beat(16),
    beat(4, [[1, 0]], true),
    beat(2),
    beat(16),
  ])
})

test('a chord lasts as long as the notes it keeps', () => {
  const score = convert(
    transcription([note(0, 4, 1, 0, { confidence: 0.5 }), note(0, 1, 1, 5)]),
  )
  assert.deepEqual(score.bars[0].beats, [beat(4, [[1, 5]]), beat(2, [], true)])
})

test('the score starts at the bar of the first note and numbers it 1', () => {
  const score = convert(transcription([note(4.5, 0.5, 2, 5)]))
  assert.deepEqual(score.bars, [
    bar(1, 2.25, [beat(8), beat(8, [[2, 5]]), beat(2, [], true)]),
  ])
  assert.equal(score.endSeconds, 4.25)
})

test('bar times follow the notes, fill empty bars between and run on after', () => {
  // Bar 3 is played half a second late; bar 2 has no note.
  const late = note(8, 6, 2, 2)
  const score = convert(
    transcription([
      note(0, 4, 1, 0),
      { ...late, startSeconds: late.startSeconds + 0.5 },
    ]),
  )
  assert.deepEqual(score.bars, [
    bar(1, 0.25, [beat(1, [[1, 0]])]),
    bar(2, 2.5, [beat(1)]),
    bar(3, 4.75, [beat(1, [[2, 2]])]),
    bar(4, 6.75, [beat(2, [[2, 2, true]]), beat(2)]),
  ])
  assert.equal(score.endSeconds, 8.75)
})

test('one stray note does not move its bar', () => {
  const stray = note(1, 1, 2, 0)
  const score = convert(
    transcription([
      note(0, 1, 1, 0),
      { ...stray, startSeconds: stray.startSeconds + 0.5 },
      note(2, 2, 3, 0),
    ]),
  )
  assert.equal(score.bars[0].startSeconds, 0.25)
})

test('a pickup bar starts at 0 s and bar times always move forward', () => {
  const pickup = convert(
    transcription([
      { ...note(3, 1, 1, 0), startSeconds: 0.125 },
      { ...note(4, 4, 1, 2), startSeconds: 0.625 },
    ]),
  )
  assert.deepEqual(
    pickup.bars.map((item) => item.startSeconds),
    [0, 0.625],
  )
  assert.equal(pickup.endSeconds, 2.625)

  // A bar heard before the one ahead of it starts a sixteenth after it.
  const crossed = convert(
    transcription([
      { ...note(0, 4, 1, 0), startSeconds: 1 },
      { ...note(4, 4, 1, 2), startSeconds: 0.875 },
    ]),
  )
  assert.deepEqual(
    crossed.bars.map((item) => item.startSeconds),
    [1, 1.125],
  )
})

test('a transcription with nothing to draw gives no score', () => {
  const one = [note(0, 1, 1, 0)]
  assert.equal(scoreFromNotes(transcription([])), null)
  assert.equal(
    scoreFromNotes(transcription(one, { timeSignature: [6, 8] })),
    null,
  )
  assert.equal(scoreFromNotes(transcription(one, { tempoBpm: 0 })), null)
  assert.equal(scoreFromNotes(transcription(one, { tempoBpm: NaN })), null)
  assert.equal(scoreFromNotes(transcription([note(-1, 1, 1, 0)])), null)
})

test('a transcription longer than the screen draws gives no score', () => {
  const last = (bars) => note(bars * 4 - 1, 1, 1, 0)
  assert.equal(
    scoreFromNotes(transcription([note(0, 1, 1, 0), last(1001)])),
    null,
  )
  assert.equal(
    convert(transcription([note(0, 1, 1, 0), last(1000)])).bars.length,
    1000,
  )
})

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('converting leaves the transcription untouched', () => {
  const input = deepFreeze(
    transcription([note(0, 4, 2, 1), note(0, 4, 1, 0), note(3, 2, 1, 0)]),
  )
  const before = structuredClone(input)
  const score = convert(input)
  assert.deepEqual(input, before)
  assert.notEqual(score.tuning, input.tuning)
})
