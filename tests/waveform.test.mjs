import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePeaks,
  fillPeaks,
  peakBars,
} from '../src/features/waveform/peaks.ts'
import {
  formatTickLabel,
  handleDragStarts,
  keyboardRange,
  keyboardSeek,
  labelSteps,
  moveHandle,
  nearestHandle,
  rangeFromForm,
  ratioToTime,
  shiftRange,
  spanFrom,
  startsDrag,
  tickTimes,
  timeToRatio,
  zoomWindow,
} from '../src/features/waveform/timeline.ts'

const yieldNow = () => Promise.resolve()

test('a peak is the loudest sample of any channel in its bucket', () => {
  const out = new Float32Array(2)
  fillPeaks(
    [
      Float32Array.from([0.1, -0.5, 0.2, 0.3]),
      Float32Array.from([0, 0.1, -0.9, 0]),
    ],
    2,
    0,
    2,
    out,
  )
  assert.deepEqual(
    [...out].map((value) => value.toFixed(2)),
    ['0.50', '0.90'],
  )
})

test('fractional bucket sizes cover every sample exactly once', () => {
  // 2.5 samples per bucket: [0,2) [2,5) [5,7) [7,10)
  const samples = Float32Array.from([1, 0, 0, 0, 2, 0, 3, 0, 0, 4])
  const out = new Float32Array(4)
  fillPeaks([samples], 2.5, 0, 4, out)
  assert.deepEqual([...out], [1, 2, 3, 4])
})

test('peaks are normalised to the loudest bucket at a fixed rate', async () => {
  const samples = Float32Array.from([0.1, 0, 0, 0, 0.4, 0, 0, 0, 0.2, 0])
  const peaks = await computePeaks([samples], 400, {
    signal: new AbortController().signal,
    peaksPerSecond: 100,
    yieldToMain: yieldNow,
  })
  assert.equal(peaks.peaksPerSecond, 100)
  // 10 frames at 4 per bucket: the last bucket is partial.
  assert.deepEqual(
    [...peaks.values].map((value) => value.toFixed(2)),
    ['0.25', '1.00', '0.50'],
  )
})

test('silence stays silent instead of dividing by zero', async () => {
  const peaks = await computePeaks([new Float32Array(8)], 400, {
    signal: new AbortController().signal,
    peaksPerSecond: 100,
    yieldToMain: yieldNow,
  })
  assert.deepEqual([...peaks.values], [0, 0])
})

test('peak computation yields once its time budget is spent', async () => {
  let clock = 0
  let yields = 0
  const peaks = await computePeaks([new Float32Array(400).fill(0.5)], 400, {
    signal: new AbortController().signal,
    peaksPerSecond: 100,
    batchSize: 10,
    budgetMs: 8,
    now: () => (clock += 5),
    yieldToMain: async () => {
      yields += 1
    },
  })
  assert.equal(peaks.values.length, 100)
  assert.ok(yields >= 4, `expected several yields, got ${yields}`)
})

test('peak computation stops when cancelled between slices', async () => {
  const controller = new AbortController()
  let clock = 0
  const computing = computePeaks([new Float32Array(400)], 400, {
    signal: controller.signal,
    peaksPerSecond: 100,
    batchSize: 10,
    budgetMs: 8,
    now: () => (clock += 5),
    yieldToMain: async () => controller.abort(),
  })
  await assert.rejects(computing, { name: 'AbortError' })

  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    computePeaks([new Float32Array(4)], 400, {
      signal: aborted.signal,
      yieldToMain: yieldNow,
    }),
    { name: 'AbortError' },
  )
})

test('bars take the loudest peak in their slice of the window', () => {
  const peaks = {
    peaksPerSecond: 10,
    values: Float32Array.from([0.1, 0.5, 0.2, 0.9, 0.3, 0.4]),
  }
  assert.deepEqual(
    [...peakBars(peaks, { start: 0, end: 0.4 }, 2)],
    [0.5, 0.9].map(Math.fround),
  )
  // Past the decoded audio there is nothing to draw.
  assert.deepEqual(
    [...peakBars(peaks, { start: 0.4, end: 0.8 }, 2)],
    [Math.fround(0.4), 0],
  )
  // A bar narrower than a bucket shows the bucket it falls in.
  assert.deepEqual(
    [...peakBars(peaks, { start: 0.3, end: 0.32 }, 2)],
    [Math.fround(0.9), Math.fround(0.9)],
  )
})

test('times and positions convert both ways within a window', () => {
  const window = { start: 40, end: 70 }
  assert.equal(timeToRatio(55, window), 0.5)
  assert.equal(ratioToTime(0.5, window), 55)
  assert.equal(ratioToTime(timeToRatio(42.1, window), window), 42.1)
})

test('label steps keep labels apart at any width', () => {
  assert.deepEqual(labelSteps({ start: 0, end: 252.4 }, 1136), {
    major: 30,
    minor: 10,
  })
  assert.equal(labelSteps({ start: 39.6, end: 68.3 }, 1136).major, 2)
  assert.equal(labelSteps({ start: 0, end: 252.4 }, 358).major, 60)
  assert.equal(labelSteps({ start: 0, end: 10 }, 1136).major, 1)
  // A zero width (not laid out yet) still returns a usable step.
  assert.ok(labelSteps({ start: 0, end: 252.4 }, 0).major > 0)
})

test('ticks fall on whole steps inside the window', () => {
  assert.deepEqual(
    tickTimes({ start: 39.6, end: 48.3 }, 2),
    [40, 42, 44, 46, 48],
  )
  assert.deepEqual(tickTimes({ start: 0, end: 1 }, 0.5), [0, 0.5, 1])
  assert.deepEqual(tickTimes({ start: 0, end: 0.3 }, 0.1), [0, 0.1, 0.2, 0.3])
})

test('tick labels read mm:ss and keep a tenth only when needed', () => {
  assert.equal(formatTickLabel(0), '00:00')
  assert.equal(formatTickLabel(90), '01:30')
  assert.equal(formatTickLabel(240), '04:00')
  assert.equal(formatTickLabel(0.5), '00:00.5')
})

test('the zoom window pads the selection and stays inside the song', () => {
  assert.deepEqual(zoomWindow({ startTenths: 421, endTenths: 658 }, 2524), {
    start: 39.6,
    end: 68.3,
  })
  assert.deepEqual(zoomWindow({ startTenths: 5, endTenths: 100 }, 2524), {
    start: 0,
    end: 12.5,
  })
  assert.deepEqual(zoomWindow({ startTenths: 2500, endTenths: 2524 }, 2524), {
    start: 247.5,
    end: 252.4,
  })
})

test('the selection follows the inputs when both read as an ordered range', () => {
  assert.deepEqual(rangeFromForm('00:42.1', '01:05.8', 2524), {
    startTenths: 421,
    endTenths: 658,
  })
  assert.equal(rangeFromForm('', '01:05.8', 2524), null)
  assert.equal(rangeFromForm('00:42.1', '1:5', 2524), null)
  assert.equal(rangeFromForm('01:05.8', '00:42.1', 2524), null)
  assert.equal(rangeFromForm('00:42.1', '00:42.1', 2524), null)
  // An end past the song is drawn at the song end; the form shows the error.
  assert.deepEqual(rangeFromForm('04:00.0', '09:00.0', 2524), {
    startTenths: 2400,
    endTenths: 2524,
  })
  assert.equal(rangeFromForm('05:00.0', '09:00.0', 2524), null)
})

test('a dragged handle stays inside the song and never crosses the other', () => {
  const range = { startTenths: 421, endTenths: 658 }
  assert.deepEqual(moveHandle(range, 'start', 500, 2524), {
    startTenths: 500,
    endTenths: 658,
  })
  assert.deepEqual(moveHandle(range, 'start', 700, 2524), {
    startTenths: 657,
    endTenths: 658,
  })
  assert.deepEqual(moveHandle(range, 'start', -30, 2524), {
    startTenths: 0,
    endTenths: 658,
  })
  assert.deepEqual(moveHandle(range, 'end', 100, 2524), {
    startTenths: 421,
    endTenths: 422,
  })
  assert.deepEqual(moveHandle(range, 'end', 9999, 2524), {
    startTenths: 421,
    endTenths: 2524,
  })
})

test('keys move a handle by a tenth, a second or five seconds', () => {
  const range = { startTenths: 421, endTenths: 658 }
  const move = (handle, key, shiftKey = false) =>
    keyboardRange(range, handle, { key, shiftKey }, 2524)
  assert.equal(move('start', 'ArrowRight').startTenths, 422)
  assert.equal(move('start', 'ArrowUp').startTenths, 422)
  assert.equal(move('start', 'ArrowLeft').startTenths, 420)
  assert.equal(move('start', 'ArrowDown').startTenths, 420)
  assert.equal(move('start', 'ArrowRight', true).startTenths, 431)
  assert.equal(move('end', 'ArrowLeft', true).endTenths, 648)
  assert.equal(move('end', 'PageUp').endTenths, 708)
  assert.equal(move('end', 'PageDown').endTenths, 608)
  assert.equal(move('start', 'Home').startTenths, 0)
  assert.equal(move('start', 'End').startTenths, 657)
  assert.equal(move('end', 'Home').endTenths, 422)
  assert.equal(move('end', 'End').endTenths, 2524)
  assert.equal(move('start', 'Enter'), null)
})

test('keys held with Alt, Ctrl or Meta are left to the browser', () => {
  const range = { startTenths: 421, endTenths: 658 }
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey'])
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp'])
      assert.equal(
        keyboardRange(
          range,
          'start',
          { key, shiftKey: false, [modifier]: true },
          2524,
        ),
        null,
        `${modifier} + ${key}`,
      )
  // Shift alone still takes a second-long step.
  assert.equal(
    keyboardRange(
      range,
      'end',
      {
        key: 'ArrowRight',
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      },
      2524,
    ).endTenths,
    668,
  )
})

test('dragging across the track selects between the press and the pointer', () => {
  assert.deepEqual(spanFrom(100, 50, 2524), { startTenths: 50, endTenths: 100 })
  assert.deepEqual(spanFrom(100, 180, 2524), {
    startTenths: 100,
    endTenths: 180,
  })
  assert.deepEqual(spanFrom(100, 100, 2524), {
    startTenths: 100,
    endTenths: 101,
  })
  assert.deepEqual(spanFrom(2524, 3000, 2524), {
    startTenths: 2523,
    endTenths: 2524,
  })
  assert.deepEqual(spanFrom(10, -40, 2524), { startTenths: 0, endTenths: 10 })
})

test('dragging the selection moves it whole and stops at the song edges', () => {
  const range = { startTenths: 421, endTenths: 658 }
  assert.deepEqual(shiftRange(range, 100, 2524), {
    startTenths: 521,
    endTenths: 758,
  })
  assert.deepEqual(shiftRange(range, -1000, 2524), {
    startTenths: 0,
    endTenths: 237,
  })
  assert.deepEqual(shiftRange(range, 5000, 2524), {
    startTenths: 2287,
    endTenths: 2524,
  })
})

test('a press on overlapping handles takes the closer boundary', () => {
  const range = { startTenths: 1000, endTenths: 1010 }
  assert.equal(nearestHandle(range, 1002, 'end'), 'start')
  assert.equal(nearestHandle(range, 1008, 'start'), 'end')
  assert.equal(nearestHandle(range, 990, 'end'), 'start')
  // Halfway between, the handle the pointer landed on keeps it.
  assert.equal(nearestHandle(range, 1005, 'end'), 'end')
  assert.equal(nearestHandle(range, 1005, 'start'), 'start')
})

test('a mouse drags once it travels 3 px sideways', () => {
  assert.equal(startsDrag(2, 0, false), false)
  assert.equal(startsDrag(-3, 0, false), true)
  // A mouse never scrolls the page, so only the sideways travel counts.
  assert.equal(startsDrag(1, 40, false), false)
})

test('a finger drags only while heading more sideways than up or down', () => {
  assert.equal(startsDrag(1, 2, true), false)
  assert.equal(startsDrag(4, 1, true), true)
  assert.equal(startsDrag(-4, -1, true), true)
  assert.equal(startsDrag(1, 3, true), false)
  assert.equal(startsDrag(1, -6, true), false)
  // A diagonal is not clearly sideways, so the page may still take it.
  assert.equal(startsDrag(3, 3, true), false)
})

test('a finger on a handle drags only once it clearly leaves a tap', () => {
  // A tap wobbles 2–3 px, about two seconds on a phone.
  assert.equal(handleDragStarts(3), false)
  assert.equal(handleDragStarts(-5), false)
  assert.equal(handleDragStarts(6), true)
  assert.equal(handleDragStarts(-6), true)
})

test('a finger that wobbles up first can still turn sideways into a drag', () => {
  // The first move says nothing yet; the travel so far decides each time.
  assert.equal(startsDrag(1, -3, true), false)
  assert.equal(startsDrag(7, -4, true), true)
})

test('the position slider steps like the section handles and stays inside', () => {
  // 21.4 s: the last tenth the time display reaches is 21.3.
  const seek = (current, key, extra = {}) =>
    keyboardSeek(current, { key, shiftKey: false, ...extra }, 214)
  assert.equal(seek(50, 'ArrowRight'), 51)
  assert.equal(seek(50, 'ArrowUp'), 51)
  assert.equal(seek(50, 'ArrowLeft'), 49)
  assert.equal(seek(50, 'ArrowDown'), 49)
  assert.equal(seek(50, 'ArrowRight', { shiftKey: true }), 60)
  assert.equal(seek(50, 'ArrowLeft', { shiftKey: true }), 40)
  assert.equal(seek(50, 'PageUp'), 100)
  assert.equal(seek(50, 'PageDown'), 0)
  assert.equal(seek(210, 'PageUp'), 213)
  assert.equal(seek(50, 'Home'), 0)
  assert.equal(seek(50, 'End'), 213)
  assert.equal(seek(0, 'ArrowLeft'), 0)
  assert.equal(seek(50, 'Enter'), null)
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey'])
    assert.equal(seek(50, 'ArrowRight', { [modifier]: true }), null)
})
