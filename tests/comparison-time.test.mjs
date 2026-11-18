import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimeMap } from '../src/features/comparison/timeMap.ts'

const region = (start, end, performanceStart, performanceEnd) => ({
  startSeconds: start,
  endSeconds: end,
  performanceStartSeconds: performanceStart,
  performanceEndSeconds: performanceEnd,
})

function near(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${actual} should be close to ${expected}`,
  )
}

test('region boundaries map exactly in both directions', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  near(map.toPerformance(5), 8)
  near(map.toPerformance(7), 11)
  near(map.toBaseline(8), 5)
  near(map.toBaseline(11), 7)
})

test('a time between boundaries follows the line between them', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  near(map.toPerformance(6), 9.5)
  near(map.toPerformance(13.5), 20.5)
  near(map.toBaseline(9.5), 6)
  near(map.toBaseline(20.5), 13.5)
})

test('without regions the whole section scales to the performance', () => {
  const map = createTimeMap([], 20, 40)

  near(map.toPerformance(5), 10)
  near(map.toBaseline(10), 5)
})

test('a time outside the section stays at its edge', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  near(map.toPerformance(-1), 0)
  near(map.toPerformance(25), 30)
  near(map.toBaseline(-1), 0)
  near(map.toBaseline(99), 20)
})

test('a region at the section edge replaces the edge itself', () => {
  const map = createTimeMap([region(0, 2, 1, 3), region(8, 10, 9, 11)], 10, 12)

  near(map.toPerformance(0), 1)
  near(map.toPerformance(10), 11)
  near(map.toBaseline(0.5), 0)
  near(map.toBaseline(11.5), 10)
})

test('regions are read in time order and may share a boundary', () => {
  const map = createTimeMap([region(4, 6, 5, 7), region(2, 4, 3, 5)], 10, 12)

  near(map.toPerformance(4), 5)
  near(map.toPerformance(3), 4)
  near(map.toBaseline(6), 5)
})

for (const [name, regions] of [
  ['go back in the performance', [region(2, 4, 6, 7), region(5, 6, 3, 4)]],
  ['overlap', [region(2, 5, 3, 6), region(4, 6, 7, 8)]],
  ['have no length in the performance', [region(2, 4, 6, 6)]],
  ['disagree on a shared boundary', [region(2, 4, 3, 5), region(4, 6, 6, 7)]],
  ['run past the performance', [region(2, 4, 3, 25)]],
  ['run past the section', [region(2, 12, 3, 5)]],
]) {
  test(`regions that ${name} fall back to one line`, () => {
    const map = createTimeMap(regions, 10, 20)

    near(map.toPerformance(5), 10)
    near(map.toBaseline(10), 5)
  })
}

test('a length that cannot be read leaves times unchanged', () => {
  for (const [section, performance] of [
    [0, 10],
    [10, 0],
    [10, Number.NaN],
    [Number.POSITIVE_INFINITY, 10],
  ]) {
    const map = createTimeMap([region(1, 2, 3, 4)], section, performance)

    assert.equal(map.toPerformance(3), 3)
    assert.equal(map.toBaseline(3), 3)
  }
})

test('regions that overlap in time order keep their places', () => {
  const map = createTimeMap([region(2, 5, 3, 6), region(4, 6, 5, 7)], 10, 20)

  near(map.toPerformance(4), 5)
  near(map.toPerformance(5), 6)
})

test('a section length a rounding error short keeps the regions', () => {
  const map = createTimeMap(
    [region(1, 2, 2, 3), region(14, 15.4, 17.5, 19.25)],
    15.399999999999999,
    19.25,
  )

  near(map.toPerformance(2), 3)
})

test('a take that starts at the first region keeps the regions', () => {
  const map = createTimeMap([region(1, 2, 0, 1), region(3, 4, 1.5, 3)], 10, 20)

  near(map.toPerformance(3), 1.5)
  near(map.toPerformance(0.5), 0)
})

test('a file a millisecond shorter than the last region keeps the regions', () => {
  const map = createTimeMap(
    [region(2, 4, 5, 6), region(8, 10, 18, 20.001)],
    12,
    20,
  )

  near(map.toPerformance(5), 9)
})

test('a place with unclear alignment does not line up the two sounds', () => {
  const place = (unavailableReason) => ({
    ...region(8, 9, 9.5, 11),
    kind: 'unavailable',
    unavailableReason,
  })
  const regions = [region(2, 4, 2, 4)]

  const unclear = createTimeMap(
    [...regions, place('UNCLEAR_ALIGNMENT')],
    10,
    12,
  )
  near(unclear.toPerformance(7), 8)

  const lowConfidence = createTimeMap(
    [...regions, place('LOW_CONFIDENCE')],
    10,
    12,
  )
  near(lowConfidence.toPerformance(7), 8.125)
})

test('a time that is not a number stays at the start', () => {
  const map = createTimeMap([], 10, 20)

  assert.equal(map.toPerformance(Number.NaN), 0)
  assert.equal(map.toBaseline(Number.NaN), 0)
})

test('going to the performance and back returns the same time', () => {
  const map = createTimeMap(
    [region(2.8, 3.9, 3.1, 4.4), region(7.1, 8.4, 8, 9.5)],
    18.2,
    20.5,
  )

  for (const time of [0, 1.5, 2.8, 3.3, 5, 7.1, 8, 12, 18.2]) {
    near(map.toBaseline(map.toPerformance(time)), time)
  }
})
