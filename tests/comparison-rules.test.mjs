import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkPerformanceLength,
  isFromPreviousSection,
  recordingLimitSeconds,
  regionCheckProgress,
} from '../src/features/comparison/comparisonRules.ts'

const region = (kind, checked = false) => ({ kind, checked })

test('progress counts only the places that sounded different (CMP-05)', () => {
  assert.deepEqual(
    regionCheckProgress([
      region('pitch-difference', true),
      region('missing-note'),
      region('timing-difference'),
      region('unavailable'),
    ]),
    { checked: 1, total: 3 },
  )
})

test('a place that could not be compared never counts as checked', () => {
  assert.deepEqual(
    regionCheckProgress([
      region('pitch-difference', true),
      region('unavailable', true),
    ]),
    { checked: 1, total: 1 },
  )
})

test('progress is absent when nothing sounded different', () => {
  assert.equal(regionCheckProgress([]), null)
  assert.equal(regionCheckProgress([region('unavailable')]), null)
})

test('a performance from half to twice the section can be compared', () => {
  assert.equal(checkPerformanceLength(10, 20), 'valid')
  assert.equal(checkPerformanceLength(20, 20), 'valid')
  assert.equal(checkPerformanceLength(40, 20), 'valid')
})

test('a performance outside that length is refused before sending', () => {
  assert.equal(checkPerformanceLength(9.99, 20), 'too-short')
  assert.equal(checkPerformanceLength(40.01, 20), 'too-long')
})

test('a length that cannot be read is not a valid performance', () => {
  for (const length of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(checkPerformanceLength(length, 20), 'unreadable')
  }
  assert.equal(checkPerformanceLength(10, 0), 'unreadable')
})

test('recording stops at twice the section so a slow take is kept', () => {
  assert.equal(recordingLimitSeconds(23.7), 47.4)
})

test('a performance keeps the section it was played against (REC-04)', () => {
  const performance = { rangeStartSeconds: 10, rangeEndSeconds: 25 }

  assert.equal(
    isFromPreviousSection(performance, {
      rangeStartSeconds: 10,
      rangeEndSeconds: 25,
    }),
    false,
  )
  assert.equal(
    isFromPreviousSection(performance, {
      rangeStartSeconds: 10,
      rangeEndSeconds: 26,
    }),
    true,
  )
  assert.equal(
    isFromPreviousSection(performance, {
      rangeStartSeconds: 9,
      rangeEndSeconds: 25,
    }),
    true,
  )
})
