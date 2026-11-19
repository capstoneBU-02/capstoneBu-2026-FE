import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  comparisonPanel,
  isComparisonRunning,
  performanceOptions,
  regionLegend,
  regionTimeLabel,
  viewRegions,
  withRegionChecked,
} from '../src/features/comparison/comparisonView.ts'

const section = { rangeStartSeconds: 40, rangeEndSeconds: 60 }

const region = (id, startSeconds, endSeconds, overrides = {}) => ({
  id,
  kind: 'pitch-difference',
  startSeconds,
  endSeconds,
  performanceStartSeconds: startSeconds,
  performanceEndSeconds: endSeconds,
  unavailableReason: null,
  checked: false,
  ...overrides,
})

const unavailable = (id, startSeconds, endSeconds) =>
  region(id, startSeconds, endSeconds, {
    kind: 'unavailable',
    unavailableReason: 'LOW_CONFIDENCE',
  })

const performance = (id, source, createdAtLabel, overrides = {}) => ({
  id,
  taskId: 'task-1',
  source,
  rangeStartSeconds: section.rangeStartSeconds,
  rangeEndSeconds: section.rangeEndSeconds,
  createdAtLabel,
  durationSeconds: 20,
  latestComparison: null,
  ...overrides,
})

const result = (regions) => ({
  comparisonId: 'comparison-1',
  state: 'success',
  notComparableReason: null,
  baseline: 'original-song',
  overallTempo: { isSlow: false },
  regions,
})

const ids = (items) => items.map((item) => item.id)

test('regions are ordered by start, then end, then input order', () => {
  const ordered = viewRegions(
    [
      region('late', 9, 10),
      region('tie-long', 2, 6),
      region('tie-first', 2, 4),
      region('tie-second', 2, 4),
      region('early', 1, 2),
    ],
    section,
  )

  assert.deepEqual(ids(ordered), [
    'early',
    'tie-first',
    'tie-second',
    'tie-long',
    'late',
  ])
})

test('ordering leaves an unsorted input untouched', () => {
  const input = Object.freeze([region('b', 5, 6), region('a', 1, 2)])

  const ordered = viewRegions(input, section)

  assert.deepEqual(ids(input), ['b', 'a'])
  assert.deepEqual(ids(ordered), ['a', 'b'])
  assert.notEqual(ordered, input)
})

test('numbers count only the differences, in time order', () => {
  const ordered = viewRegions(
    [
      region('third', 8, 9, { kind: 'timing-difference' }),
      unavailable('gap-late', 6, 7),
      region('second', 4, 5, { kind: 'missing-note' }),
      unavailable('gap-early', 0, 1),
      region('first', 2, 3),
    ],
    section,
  )

  assert.deepEqual(
    ordered.map(({ id, number }) => [id, number]),
    [
      ['gap-early', null],
      ['first', 1],
      ['second', 2],
      ['gap-late', null],
      ['third', 3],
    ],
  )
})

test('a view region keeps the region and adds its place in the song', () => {
  const source = region('a', 5, 10, { checked: true })

  const [view] = viewRegions([source], section)

  assert.deepEqual(view, {
    ...source,
    number: 1,
    songStartSeconds: 45,
    songEndSeconds: 50,
    startRatio: 0.25,
    endRatio: 0.5,
  })
})

test('ratios stay inside the section', () => {
  const [before, after] = viewRegions(
    [region('before', -2, 5), region('after', 15, 30)],
    section,
  )

  assert.equal(before.startRatio, 0)
  assert.equal(before.endRatio, 0.25)
  assert.equal(after.startRatio, 0.75)
  assert.equal(after.endRatio, 1)
})

test('song time is not clamped along with the ratios', () => {
  const [view] = viewRegions([region('after', 15, 30)], section)

  assert.equal(view.songEndSeconds, 70)
})

test('a section without length gives ratios of zero', () => {
  const sections = [
    { rangeStartSeconds: 40, rangeEndSeconds: 40 },
    { rangeStartSeconds: 40, rangeEndSeconds: 30 },
  ]

  for (const empty of sections) {
    const [view] = viewRegions([region('a', 1, 2)], empty)

    assert.equal(view.startRatio, 0)
    assert.equal(view.endRatio, 0)
    assert.equal(view.songStartSeconds, 41)
    assert.equal(view.songEndSeconds, 42)
  }
})

test('no regions give no view regions', () => {
  assert.deepEqual(viewRegions([], section), [])
})

test('a region time reads as a range of song times', () => {
  assert.equal(
    regionTimeLabel({ songStartSeconds: 45.8, songEndSeconds: 47.2 }),
    '00:45.8 – 00:47.2',
  )
  assert.equal(
    regionTimeLabel({ songStartSeconds: 59.96, songEndSeconds: 65.04 }),
    '01:00.0 – 01:05.0',
  )
})

test('the legend counts differences and unavailable places apart', () => {
  assert.deepEqual(
    regionLegend([
      region('a', 0, 1),
      region('b', 1, 2, { kind: 'missing-note' }),
      region('c', 2, 3, { kind: 'timing-difference' }),
      unavailable('d', 3, 4),
    ]),
    { differences: 3, unavailable: 1 },
  )
  assert.deepEqual(regionLegend([]), { differences: 0, unavailable: 0 })
})

test('each source numbers its own takes from the oldest', () => {
  const input = Object.freeze([
    performance('upload-2', 'upload', '오늘 14:05'),
    performance('recording-2', 'recording', '오늘 14:00'),
    performance('upload-1', 'upload', '오늘 13:50'),
    performance('recording-1', 'recording', '오늘 13:40'),
  ])

  const options = performanceOptions(input, section)

  assert.deepEqual(
    options.map(({ id, label }) => [id, label]),
    [
      ['upload-2', '파일 #2'],
      ['recording-2', '녹음 #2'],
      ['upload-1', '파일 #1'],
      ['recording-1', '녹음 #1'],
    ],
  )
  assert.deepEqual(ids(input), [
    'upload-2',
    'recording-2',
    'upload-1',
    'recording-1',
  ])
})

test('a take from the current section shows only its time', () => {
  const [option] = performanceOptions(
    [performance('a', 'recording', '오늘 14:00')],
    section,
  )

  assert.equal(option.detail, '오늘 14:00')
  assert.equal(option.fromPreviousSection, false)
})

test('a take from an earlier section says so (REC-04)', () => {
  const earlier = [
    performance('moved-end', 'recording', '어제 20:10', {
      rangeEndSeconds: 61,
    }),
    performance('moved-start', 'upload', '어제 20:00', {
      rangeStartSeconds: 39,
    }),
  ]

  for (const option of performanceOptions(earlier, section)) {
    assert.equal(option.fromPreviousSection, true)
    assert.match(option.detail, /^어제 20:\d0 · 이전 구간$/)
  }
})

test('no takes give no options', () => {
  assert.deepEqual(performanceOptions([], section), [])
})

test('the panel follows the comparison status and result', () => {
  const loaded = { comparisonId: 'comparison-1' }
  const cases = [
    [null, null, 'empty'],
    [null, loaded, 'empty'],
    [{ state: 'queued' }, null, 'running'],
    [{ state: 'processing' }, null, 'running'],
    [{ state: 'queued' }, loaded, 'running'],
    [{ state: 'failed' }, null, 'failed'],
    [{ state: 'failed' }, loaded, 'failed'],
    [{ state: 'not-comparable' }, null, 'not-comparable'],
    [{ state: 'not-comparable' }, loaded, 'not-comparable'],
    [{ state: 'success' }, null, 'loading-result'],
    [{ state: 'success' }, loaded, 'result'],
  ]

  for (const [status, panelResult, expected] of cases) {
    assert.equal(comparisonPanel(status, panelResult), expected)
  }
})

test('only a queued or processing comparison is running', () => {
  assert.equal(isComparisonRunning('queued'), true)
  assert.equal(isComparisonRunning('processing'), true)
  assert.equal(isComparisonRunning('success'), false)
  assert.equal(isComparisonRunning('not-comparable'), false)
  assert.equal(isComparisonRunning('failed'), false)
})

test('checking a region returns a new result and keeps the old one', () => {
  const first = Object.freeze(region('a', 0, 1))
  const second = Object.freeze(region('b', 1, 2))
  const original = Object.freeze(result(Object.freeze([first, second])))

  const updated = withRegionChecked(original, 'a', true)

  assert.notEqual(updated, original)
  assert.notEqual(updated.regions, original.regions)
  assert.equal(updated.regions[0].checked, true)
  assert.equal(updated.regions[1], second)
  assert.equal(original.regions[0], first)
  assert.equal(first.checked, false)
})

test('a checked region can be unchecked', () => {
  const original = result([region('a', 0, 1, { checked: true })])

  const updated = withRegionChecked(original, 'a', false)

  assert.equal(updated.regions[0].checked, false)
  assert.equal(original.regions[0].checked, true)
})

test('an unavailable region cannot be checked (CMP-05)', () => {
  const original = result([unavailable('gap', 0, 1)])

  assert.equal(withRegionChecked(original, 'gap', true), original)
  assert.equal(original.regions[0].checked, false)
})

test('an unknown region leaves the result as it was', () => {
  const original = result([region('a', 0, 1)])

  assert.equal(withRegionChecked(original, 'missing', true), original)
})
