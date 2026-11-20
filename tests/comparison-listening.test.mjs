import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimeMap } from '../src/features/comparison/timeMap.ts'
import {
  ALTERNATE_TURN_SECONDS,
  REGION_LOOP_PADDING_SECONDS,
  alternateTrack,
  alternateTurnAt,
  baselineElapsed,
  baselineTrackKind,
  firstListenMode,
  listenClock,
  listenOptions,
  listenPartialNotice,
  nextListenPass,
  regionListenRange,
  takeReaches,
  trackElapsed,
  trackRange,
} from '../src/features/comparison/comparisonListening.ts'

const region = (start, end, performanceStart, performanceEnd) => ({
  startSeconds: start,
  endSeconds: end,
  performanceStartSeconds: performanceStart,
  performanceEndSeconds: performanceEnd,
  unavailableReason: null,
})

const track = (kind, available) => ({ kind, available, offsetSeconds: 0 })

function near(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${actual} should be close to ${expected}`,
  )
}

// A take played at half speed: every baseline second lasts two in the file.
const HALF_SPEED = createTimeMap([], 10, 20)

test('the baseline clock plays the section where it sits in the file', () => {
  const clock = listenClock('baseline', { start: 2, end: 6 }, HALF_SPEED, 10)
  assert.deepEqual(clock.range, { startTenths: 120, endTenths: 160 })
  near(clock.toBaseline(1), 3)
  near(clock.toPlayer(3), 1)
})

test('the take clock converts through the time map both ways', () => {
  const clock = listenClock('performance', { start: 2, end: 6 }, HALF_SPEED, 0)
  assert.deepEqual(clock.range, { startTenths: 40, endTenths: 120 })
  near(clock.toBaseline(2), 3)
  near(clock.toPlayer(3), 2)
})

test('a range between tenths widens outward and keeps its true place', () => {
  const same = createTimeMap([], 10, 10)
  const clock = listenClock('baseline', { start: 1.234, end: 5.678 }, same, 0)
  assert.deepEqual(clock.range, { startTenths: 12, endTenths: 57 })
  near(clock.toPlayer(1.234), 0.034)
  near(clock.toBaseline(0.034), 1.234)
})

test('a place before the range is its start on the player', () => {
  const clock = listenClock('performance', { start: 2, end: 6 }, HALF_SPEED, 0)
  assert.equal(clock.toPlayer(0), 0)
})

test('only a position that moved back on its own starts the next pass', () => {
  assert.equal(nextListenPass(2, null, 1), 2)
  assert.equal(nextListenPass(2, 1, 1.5), 2)
  assert.equal(nextListenPass(2, 1.5, 1.49), 2)
  assert.equal(nextListenPass(2, 3.9, 0.1), 3)
})

const BASELINES = [
  { baseline: 'original-song', kind: 'original', label: '원곡' },
  { baseline: 'separated-input', kind: 'stem', label: '올린 음원' },
]

// Each sound is either playable, listed as unavailable, or not listed at all.
const STATES = [
  { name: 'available', enabled: true, entry: (kind) => [track(kind, true)] },
  {
    name: 'unavailable',
    enabled: false,
    entry: (kind) => [track(kind, false)],
  },
  { name: 'missing', enabled: false, entry: () => [] },
]

const noticeFor = (label, baselineOn, performanceOn) => {
  if (!baselineOn && !performanceOn) return '재생할 수 있는 음원이 없어요.'
  if (!baselineOn)
    return `${label}을 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.`
  if (!performanceOn)
    return '내 연주를 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.'
  return null
}

const firstModeFor = (baselineOn, performanceOn) => {
  if (performanceOn) return 'performance'
  return baselineOn ? 'baseline' : null
}

test('the baseline names the track it is played from', () => {
  assert.equal(baselineTrackKind('original-song'), 'original')
  assert.equal(baselineTrackKind('separated-input'), 'stem')
})

for (const { baseline, kind, label } of BASELINES) {
  for (const baselineState of STATES) {
    for (const performanceState of STATES) {
      const name = `${baseline}: baseline ${baselineState.name}, performance ${performanceState.name}`
      const playback = {
        tracks: [
          ...baselineState.entry(kind),
          ...performanceState.entry('performance'),
        ],
      }
      const baselineOn = baselineState.enabled
      const performanceOn = performanceState.enabled

      test(`options, first mode and notice for ${name}`, () => {
        const options = listenOptions(playback, baseline)

        assert.deepEqual(options, [
          { id: 'baseline', label, enabled: baselineOn },
          { id: 'performance', label: '내 연주', enabled: performanceOn },
          {
            id: 'alternate',
            label: '번갈아',
            enabled: baselineOn && performanceOn,
          },
        ])
        assert.equal(
          firstListenMode(options),
          firstModeFor(baselineOn, performanceOn),
        )
        assert.equal(
          listenPartialNotice(options),
          noticeFor(label, baselineOn, performanceOn),
        )
      })
    }
  }
}

test('the other kind of baseline track does not stand in for the baseline', () => {
  const stemOnly = { tracks: [track('stem', true), track('performance', true)] }
  const originalOnly = {
    tracks: [track('original', true), track('performance', true)],
  }

  assert.equal(listenOptions(stemOnly, 'original-song')[0].enabled, false)
  assert.equal(listenOptions(stemOnly, 'separated-input')[0].enabled, true)
  assert.equal(listenOptions(originalOnly, 'separated-input')[0].enabled, false)
  assert.equal(listenOptions(originalOnly, 'original-song')[0].enabled, true)
})

test('the notices use the right particle after each name', () => {
  const noBaseline = { tracks: [track('performance', true)] }
  const noPerformance = { tracks: [track('original', true)] }

  assert.equal(
    listenPartialNotice(listenOptions(noBaseline, 'original-song')),
    '원곡을 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.',
  )
  assert.equal(
    listenPartialNotice(listenOptions(noBaseline, 'separated-input')),
    '올린 음원을 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.',
  )
  assert.equal(
    listenPartialNotice(listenOptions(noPerformance, 'original-song')),
    '내 연주를 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.',
  )
})

test('alternate is never the first mode, even when it alone is enabled', () => {
  assert.equal(
    firstListenMode([
      { id: 'baseline', label: '원곡', enabled: false },
      { id: 'performance', label: '내 연주', enabled: false },
      { id: 'alternate', label: '번갈아', enabled: true },
    ]),
    null,
  )
})

test('the constants keep their agreed lengths', () => {
  assert.equal(REGION_LOOP_PADDING_SECONDS, 0.5)
  assert.equal(ALTERNATE_TURN_SECONDS, 4)
})

test('a region is padded on both sides', () => {
  assert.deepEqual(regionListenRange({ startSeconds: 5, endSeconds: 7 }, 20), {
    start: 4.5,
    end: 7.5,
  })
})

test('padding stops at the section start', () => {
  assert.deepEqual(
    regionListenRange({ startSeconds: 0.2, endSeconds: 2 }, 20),
    { start: 0, end: 2.5 },
  )
  assert.deepEqual(regionListenRange({ startSeconds: 0, endSeconds: 2 }, 20), {
    start: 0,
    end: 2.5,
  })
})

test('padding stops at the section end', () => {
  assert.deepEqual(
    regionListenRange({ startSeconds: 18, endSeconds: 19.8 }, 20),
    { start: 17.5, end: 20 },
  )
  assert.deepEqual(
    regionListenRange({ startSeconds: 18, endSeconds: 20 }, 20),
    {
      start: 17.5,
      end: 20,
    },
  )
})

test('padding stops at both edges of a region as long as the section', () => {
  assert.deepEqual(regionListenRange({ startSeconds: 0, endSeconds: 10 }, 10), {
    start: 0,
    end: 10,
  })
})

test('a section length that cannot be read leaves nothing to play', () => {
  for (const section of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
    assert.deepEqual(
      regionListenRange({ startSeconds: 2, endSeconds: 4 }, section),
      { start: 0, end: 0 },
    )
  }
})

test('the baseline keeps its range', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  assert.deepEqual(trackRange('baseline', { start: 4.5, end: 7.5 }, map), {
    start: 4.5,
    end: 7.5,
  })
})

test('a slow take plays a longer range than the baseline', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)
  const range = { start: 5, end: 7 }

  const performance = trackRange('performance', range, map)

  near(performance.start, 8)
  near(performance.end, 11)
  assert.ok(performance.end - performance.start > range.end - range.start)
})

test('a padded range follows the take outside the region too', () => {
  const map = createTimeMap([], 10, 20)
  const range = regionListenRange({ startSeconds: 2, endSeconds: 4 }, 10)

  const performance = trackRange('performance', range, map)

  near(performance.start, 3)
  near(performance.end, 9)
})

test('mapping a range leaves the given range as it was', () => {
  const map = createTimeMap([], 10, 20)
  const range = Object.freeze({ start: 1, end: 2 })

  trackRange('performance', range, map)

  assert.deepEqual(range, { start: 1, end: 2 })
})

test('elapsed time on the baseline is the same on both clocks', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  assert.equal(trackElapsed('baseline', 6, map), 6)
  assert.equal(baselineElapsed('baseline', 6, map), 6)
})

test('elapsed time converts to and from the performance', () => {
  const map = createTimeMap([region(5, 7, 8, 11)], 20, 30)

  near(trackElapsed('performance', 5, map), 8)
  near(trackElapsed('performance', 7, map), 11)
  near(baselineElapsed('performance', 8, map), 5)
  near(baselineElapsed('performance', 11, map), 7)
})

test('elapsed time survives the round trip at region boundaries', () => {
  const regions = [region(2.8, 3.9, 3.1, 4.4), region(7.1, 8.4, 8, 9.5)]
  const map = createTimeMap(regions, 18.2, 20.5)
  const times = regions.flatMap(({ startSeconds, endSeconds }) => {
    const padded = regionListenRange({ startSeconds, endSeconds }, 18.2)
    return [startSeconds, endSeconds, padded.start, padded.end]
  })

  for (const listenTrack of ['baseline', 'performance']) {
    for (const time of [0, ...times, 18.2]) {
      near(
        baselineElapsed(listenTrack, trackElapsed(listenTrack, time, map), map),
        time,
      )
    }
  }
})

const turn = (passIndex, elapsedInRange, rangeSeconds) =>
  alternateTrack({
    passIndex,
    elapsedInRange,
    rangeSeconds,
    regionSelected: false,
  })

test('with a region selected each pass is one turn', () => {
  const pass = (passIndex, elapsedInRange = 0) =>
    alternateTrack({
      passIndex,
      elapsedInRange,
      rangeSeconds: 12,
      regionSelected: true,
    })

  assert.equal(pass(0), 'baseline')
  assert.equal(pass(1), 'performance')
  assert.equal(pass(2), 'baseline')
  assert.equal(pass(3), 'performance')
  assert.equal(pass(0, 5), 'baseline')
  assert.equal(pass(1, 9), 'performance')
})

test('without a region the sounds change every turn', () => {
  assert.equal(turn(0, 0, 16), 'baseline')
  assert.equal(turn(0, 2, 16), 'baseline')
  assert.equal(turn(0, 6, 16), 'performance')
  assert.equal(turn(0, 10, 16), 'baseline')
  assert.equal(turn(0, 14, 16), 'performance')
})

test('a time exactly on a boundary belongs to the next turn', () => {
  assert.equal(turn(0, 3.999, 16), 'baseline')
  assert.equal(turn(0, 4, 16), 'performance')
  assert.equal(turn(0, 7.999, 16), 'performance')
  assert.equal(turn(0, 8, 16), 'baseline')
  assert.equal(turn(0, 12, 16), 'performance')
})

test('a boundary read back a rounding error short is still on it', () => {
  assert.equal(turn(0, 3.9999999999999996, 16), 'performance')
  assert.equal(turn(0, 15.999999999999998, 16), 'performance')
  assert.equal(turn(0, 3.99999, 16), 'baseline')
})

test('a boundary taken through the take clock and back keeps its turn', () => {
  // The places of a 24-second take of a 23.7-second section, from the mock.
  const map = createTimeMap(
    [
      region(3.65, 5.072, 3.696, 5.136),
      region(9.243, 10.902, 9.36, 11.04),
      region(17.301, 18.486, 17.52, 18.72),
      region(19.908, 21.804, 20.16, 22.08),
    ],
    23.7,
    24,
  )
  const clock = listenClock('performance', { start: 0, end: 23.7 }, map, 0)
  for (const seconds of [4, 8, 12, 16, 20]) {
    const back = clock.toBaseline(clock.toPlayer(seconds))
    assert.equal(turn(0, back, 23.7), turn(0, seconds, 23.7), `${seconds}s`)
  }
})

test('an even number of turns starts every pass on the baseline', () => {
  assert.equal(turn(0, 0, 8), 'baseline')
  assert.equal(turn(1, 0, 8), 'baseline')
  assert.equal(turn(1, 4, 8), 'performance')
  assert.equal(turn(2, 0, 8), 'baseline')
})

test('an odd number of turns carries on across passes', () => {
  const heard = [0, 1, 2].flatMap((passIndex) =>
    [0, 4, 8].map((elapsed) => turn(passIndex, elapsed, 10)),
  )

  assert.deepEqual(heard, [
    'baseline',
    'performance',
    'baseline',
    'performance',
    'baseline',
    'performance',
    'baseline',
    'performance',
    'baseline',
  ])
})

test('a range shorter than a turn changes sound on each pass', () => {
  assert.equal(turn(0, 1, 2), 'baseline')
  assert.equal(turn(1, 1, 2), 'performance')
  assert.equal(turn(2, 1, 2), 'baseline')
})

test('a time past the range stays in the last turn of the pass', () => {
  assert.equal(turn(0, 10, 10), 'baseline')
  assert.equal(turn(0, 12, 10), 'baseline')
  assert.equal(turn(0, 1000, 10), 'baseline')
  assert.equal(turn(1, 12, 10), 'performance')
  assert.equal(turn(0, 8, 8), 'performance')
  assert.equal(turn(0, 5, 2), 'baseline')
})

for (const bad of [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
]) {
  test(`a pass index of ${bad} counts as the first pass`, () => {
    assert.equal(turn(bad, 0, 16), 'baseline')
    assert.equal(turn(bad, 4, 16), 'performance')
    assert.equal(
      alternateTrack({
        passIndex: bad,
        elapsedInRange: 0,
        rangeSeconds: 16,
        regionSelected: true,
      }),
      'baseline',
    )
  })

  test(`an elapsed time of ${bad} counts as the start of the pass`, () => {
    assert.equal(turn(0, bad, 16), 'baseline')
    assert.equal(turn(1, bad, 10), 'performance')
  })

  test(`a range of ${bad} counts as one turn per pass`, () => {
    assert.equal(turn(0, 0, bad), 'baseline')
    assert.equal(turn(0, 5, bad), 'baseline')
    assert.equal(turn(1, 0, bad), 'performance')
  })
}

test('a range of no length counts as one turn per pass', () => {
  assert.equal(turn(0, 0, 0), 'baseline')
  assert.equal(turn(1, 0, 0), 'performance')
})

test('a fractional pass index counts as the pass it is inside', () => {
  assert.equal(turn(1.5, 0, 16), 'baseline')
  assert.equal(
    alternateTrack({
      passIndex: 2.5,
      elapsedInRange: 0,
      rangeSeconds: 16,
      regionSelected: true,
    }),
    'baseline',
  )
})

test('a take that stopped early holds nothing past its end', () => {
  const map = createTimeMap([region(10, 18, 10, 18)], 30, 18)

  assert.equal(takeReaches(map, 5, 30), true)
  assert.equal(takeReaches(map, 17.5, 30), true)
  assert.equal(takeReaches(map, 17.97, 30), false)
  assert.equal(takeReaches(map, 20, 30), false)
})

test('a take as long as the section reaches its very end', () => {
  const map = createTimeMap([], 30, 30)

  assert.equal(takeReaches(map, 29.99, 30), true)
  assert.equal(takeReaches(map, 30, 30), true)
})

test('a slower take with no place to go by still reaches the end', () => {
  const map = createTimeMap([], 30, 18)

  assert.equal(takeReaches(map, 29.99, 30), true)
})

test('the turn at a place gives the take only what it has sound for', () => {
  const map = createTimeMap([region(10, 18, 10, 18)], 30, 18)
  const at = (passIndex, elapsedInRange, regionSelected = false) =>
    alternateTurnAt(map, {
      passIndex,
      elapsedInRange,
      rangeSeconds: 30,
      regionSelected,
    })

  assert.equal(at(0, 2), 'baseline')
  assert.equal(at(0, 6), 'performance')
  // 20 to 24 seconds is the take's turn, but the take stopped at 18.
  assert.equal(at(0, 22), 'baseline')
  // A chosen place counts passes alone.
  assert.equal(at(1, 22, true), 'performance')
})
