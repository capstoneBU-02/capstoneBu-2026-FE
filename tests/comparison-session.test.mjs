import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparedTakeCount,
  comparisonSessionReducer,
  initialComparisonSession,
  selectedPerformance,
  sessionNotice,
  sessionPanel,
} from '../src/features/comparison/comparisonSession.ts'

function performance(id, latestComparison = null) {
  return {
    id,
    taskId: 'task-1',
    source: 'recording',
    rangeStartSeconds: 10,
    rangeEndSeconds: 30,
    createdAtLabel: '오늘 21:58',
    durationSeconds: 20,
    latestComparison,
  }
}

function status(id, state, extra = {}) {
  return {
    id,
    state,
    currentStage: null,
    stages: [],
    notComparableReason: null,
    failure: null,
    ...extra,
  }
}

function result(comparisonId, state = 'success') {
  return {
    comparisonId,
    state,
    notComparableReason: null,
    baseline: 'original-song',
    overallTempo: null,
    regions: [
      {
        id: 'region-1',
        kind: 'pitch-difference',
        startSeconds: 1,
        endSeconds: 2,
        performanceStartSeconds: 1,
        performanceEndSeconds: 2,
        unavailableReason: null,
        checked: false,
      },
    ],
  }
}

function run(events, from = initialComparisonSession) {
  return events.reduce(comparisonSessionReducer, from)
}

const loaded = (performances) => run([{ type: 'list-loaded', performances }])

test('the list starts loading and shows the empty state when no take exists', () => {
  assert.equal(sessionPanel(initialComparisonSession), 'loading')
  assert.equal(sessionPanel(loaded([])), 'empty')
})

test('a list that failed with nothing to show asks to try again', () => {
  assert.equal(sessionPanel(run([{ type: 'list-failed' }])), 'list-failed')
})

test('a list that fails to refresh keeps the takes on screen', () => {
  const state = run([{ type: 'list-failed' }], loaded([performance('p-1')]))
  assert.equal(sessionPanel(state), 'not-requested')
  assert.equal(state.performances.length, 1)
})

test('the newest take opens first', () => {
  const state = loaded([performance('p-2'), performance('p-1')])
  assert.equal(selectedPerformance(state)?.id, 'p-2')
})

test('loading the list again keeps the chosen take and what it shows', () => {
  const list = [
    performance('p-2', { id: 'c-2', state: 'success' }),
    performance('p-1', { id: 'c-1', state: 'success' }),
  ]
  const opened = run(
    [
      { type: 'select', performanceId: 'p-1' },
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
    ],
    loaded(list),
  )
  const again = comparisonSessionReducer(opened, {
    type: 'list-loaded',
    performances: list,
  })
  assert.equal(selectedPerformance(again)?.id, 'p-1')
  assert.equal(again.result?.comparisonId, 'c-1')
  assert.equal(again.follow, opened.follow)
})

test('a chosen take that left the list falls back to the newest', () => {
  const state = run(
    [{ type: 'list-loaded', performances: [performance('p-3')] }],
    loaded([performance('p-1')]),
  )
  assert.equal(selectedPerformance(state)?.id, 'p-3')
})

test('a take with no comparison waits to be requested', () => {
  assert.equal(sessionPanel(loaded([performance('p-1')])), 'not-requested')
})

test('a kept failure is not shown until its details arrive', () => {
  const state = loaded([performance('p-1', { id: 'c-1', state: 'failed' })])
  assert.equal(sessionPanel(state), 'loading-result')
  const settled = comparisonSessionReducer(state, {
    type: 'status-loaded',
    status: status('c-1', 'failed'),
  })
  assert.equal(sessionPanel(settled), 'failed')
})

test('choosing another take drops what the last one showed', () => {
  const state = run(
    [
      { type: 'status-loaded', status: status('c-2', 'success') },
      { type: 'result-loaded', result: result('c-2'), playback: null },
      { type: 'select', performanceId: 'p-1' },
    ],
    loaded([
      performance('p-2', { id: 'c-2', state: 'success' }),
      performance('p-1', { id: 'c-1', state: 'processing' }),
    ]),
  )
  assert.equal(state.result, null)
  assert.equal(state.status?.id, 'c-1')
  assert.equal(sessionPanel(state), 'running')
})

test('choosing the open take again changes nothing', () => {
  const state = loaded([performance('p-1')])
  assert.equal(
    comparisonSessionReducer(state, { type: 'select', performanceId: 'p-1' }),
    state,
  )
})

test('choosing a take that is not listed changes nothing', () => {
  const state = loaded([performance('p-1')])
  assert.equal(
    comparisonSessionReducer(state, { type: 'select', performanceId: 'nope' }),
    state,
  )
})

test('a saved take goes first and opens', () => {
  const state = run(
    [{ type: 'saved', performance: performance('p-2') }],
    loaded([performance('p-1')]),
  )
  assert.deepEqual(
    state.performances.map((take) => take.id),
    ['p-2', 'p-1'],
  )
  assert.equal(selectedPerformance(state)?.id, 'p-2')
})

test('a started comparison is followed from its first status', () => {
  const before = loaded([performance('p-1')])
  const state = run(
    [
      { type: 'action-started', action: 'requesting', performanceId: 'p-1' },
      {
        type: 'comparison-started',
        performanceId: 'p-1',
        comparison: { id: 'c-1', state: 'queued' },
      },
    ],
    before,
  )
  assert.equal(state.pending, null)
  assert.equal(state.status?.id, 'c-1')
  assert.equal(sessionPanel(state), 'running')
  assert.notEqual(state.follow, before.follow)
  assert.deepEqual(selectedPerformance(state)?.latestComparison, {
    id: 'c-1',
    state: 'queued',
  })
})

test('a comparison started for a take no longer open leaves the screen alone', () => {
  const before = run(
    [{ type: 'select', performanceId: 'p-1' }],
    loaded([performance('p-2'), performance('p-1')]),
  )
  const state = comparisonSessionReducer(before, {
    type: 'comparison-started',
    performanceId: 'p-2',
    comparison: { id: 'c-2', state: 'queued' },
  })
  assert.equal(state.status, null)
  assert.equal(state.follow, before.follow)
  assert.equal(state.performances[0].latestComparison?.id, 'c-2')
})

test('a retry of the same comparison is followed again', () => {
  const failed = run(
    [{ type: 'status-loaded', status: status('c-1', 'failed') }],
    loaded([performance('p-1', { id: 'c-1', state: 'failed' })]),
  )
  const state = comparisonSessionReducer(failed, {
    type: 'comparison-started',
    performanceId: 'p-1',
    comparison: { id: 'c-1', state: 'queued' },
  })
  assert.notEqual(state.follow, failed.follow)
  assert.equal(sessionPanel(state), 'running')
})

test('a status for another comparison is ignored', () => {
  const state = loaded([performance('p-1', { id: 'c-1', state: 'queued' })])
  assert.equal(
    comparisonSessionReducer(state, {
      type: 'status-loaded',
      status: status('c-9', 'success'),
    }),
    state,
  )
})

test('a status updates the take it belongs to', () => {
  const state = run(
    [{ type: 'status-loaded', status: status('c-1', 'success') }],
    loaded([performance('p-1', { id: 'c-1', state: 'queued' })]),
  )
  assert.equal(selectedPerformance(state)?.latestComparison?.state, 'success')
  assert.equal(sessionPanel(state), 'loading-result')
})

test('a finished comparison shows its result', () => {
  const state = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'queued' })]),
  )
  assert.equal(sessionPanel(state), 'result')
})

test('a take that could not be compared waits for its result, which names the baseline', () => {
  const waiting = run(
    [{ type: 'status-loaded', status: status('c-1', 'not-comparable') }],
    loaded([performance('p-1', { id: 'c-1', state: 'queued' })]),
  )
  assert.equal(sessionPanel(waiting), 'loading-result')
  const state = comparisonSessionReducer(waiting, {
    type: 'result-loaded',
    result: result('c-1', 'not-comparable'),
    playback: null,
  })
  assert.equal(sessionPanel(state), 'not-comparable')
})

test('a result for another comparison is ignored', () => {
  const state = loaded([performance('p-1', { id: 'c-1', state: 'success' })])
  assert.equal(
    comparisonSessionReducer(state, {
      type: 'result-loaded',
      result: result('c-9'),
      playback: null,
    }),
    state,
  )
})

test('a result that failed to load can be asked for again', () => {
  const failed = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-failed', comparisonId: 'c-1' },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'success' })]),
  )
  assert.equal(sessionPanel(failed), 'result-failed')
  const again = comparisonSessionReducer(failed, { type: 'reload-result' })
  assert.equal(sessionPanel(again), 'loading-result')
  assert.notEqual(again.follow, failed.follow)
})

for (const [name, events] of [
  ['as the list knew it', []],
  [
    'after its status arrived',
    [{ type: 'status-loaded', status: status('c-1', 'processing') }],
  ],
]) {
  test(`a running comparison that can no longer be read asks again, ${name}`, () => {
    const state = run(
      [...events, { type: 'result-failed', comparisonId: 'c-1' }],
      loaded([performance('p-1', { id: 'c-1', state: 'queued' })]),
    )
    assert.equal(sessionPanel(state), 'result-failed')
    const again = comparisonSessionReducer(state, { type: 'reload-result' })
    assert.equal(sessionPanel(again), 'running')
  })
}

test('a kept failure that can no longer be read asks again', () => {
  const state = run(
    [{ type: 'result-failed', comparisonId: 'c-1' }],
    loaded([performance('p-1', { id: 'c-1', state: 'failed' })]),
  )
  assert.equal(sessionPanel(state), 'result-failed')
})

test('a running comparison hides a result kept from its last attempt', () => {
  const state = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
      { type: 'status-loaded', status: status('c-1', 'processing') },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'success' })]),
  )
  assert.equal(state.result, null)
  assert.equal(sessionPanel(state), 'running')
})

test('a failed action keeps the screen and says why', () => {
  const state = run(
    [
      { type: 'action-started', action: 'requesting', performanceId: 'p-1' },
      {
        type: 'action-failed',
        performanceId: 'p-1',
        message: '비교를 시작하지 못했어요.',
      },
    ],
    loaded([performance('p-1')]),
  )
  assert.equal(state.pending, null)
  assert.equal(sessionNotice(state), '비교를 시작하지 못했어요.')
  assert.equal(sessionPanel(state), 'not-requested')
})

test('starting an action clears the last notice', () => {
  const state = run(
    [
      { type: 'action-failed', performanceId: 'p-1', message: '실패' },
      { type: 'action-started', action: 'retrying', performanceId: 'p-1' },
    ],
    loaded([performance('p-1')]),
  )
  assert.equal(sessionNotice(state), null)
  assert.equal(state.pending, 'retrying')
})

test('a failure that arrives after another take was chosen stays with its own take', () => {
  const state = run(
    [
      { type: 'action-started', action: 'requesting', performanceId: 'p-2' },
      { type: 'select', performanceId: 'p-1' },
      { type: 'action-failed', performanceId: 'p-2', message: '실패' },
    ],
    loaded([performance('p-2'), performance('p-1')]),
  )
  assert.equal(state.pending, null)
  assert.equal(sessionNotice(state), null)
  const back = comparisonSessionReducer(state, {
    type: 'select',
    performanceId: 'p-2',
  })
  assert.equal(sessionNotice(back), '실패')
})

test('starting an action on one take keeps the notice waiting on another', () => {
  const state = run(
    [
      { type: 'action-started', action: 'requesting', performanceId: 'p-2' },
      { type: 'select', performanceId: 'p-1' },
      { type: 'action-failed', performanceId: 'p-2', message: '실패' },
      { type: 'action-started', action: 'requesting', performanceId: 'p-1' },
      { type: 'select', performanceId: 'p-2' },
    ],
    loaded([performance('p-2'), performance('p-1')]),
  )
  assert.equal(sessionNotice(state), '실패')
})

test('a notice seen on its take is gone once the take is left', () => {
  const left = run(
    [
      { type: 'action-failed', performanceId: 'p-2', message: '실패' },
      { type: 'select', performanceId: 'p-1' },
    ],
    loaded([performance('p-2'), performance('p-1')]),
  )
  const back = comparisonSessionReducer(left, {
    type: 'select',
    performanceId: 'p-2',
  })
  assert.equal(sessionNotice(back), null)
  const saved = run(
    [
      { type: 'action-failed', performanceId: 'p-1', message: '실패' },
      { type: 'saved', performance: performance('p-2') },
      { type: 'select', performanceId: 'p-1' },
    ],
    loaded([performance('p-1')]),
  )
  assert.equal(sessionNotice(saved), null)
})

test('a failed mark keeps a request under way on another take', () => {
  const state = run(
    [
      { type: 'select', performanceId: 'p-2' },
      { type: 'action-started', action: 'requesting', performanceId: 'p-2' },
      { type: 'mark-failed', performanceId: 'p-1', message: '실패' },
    ],
    loaded([
      performance('p-1', { id: 'c-1', state: 'success' }),
      performance('p-2'),
    ]),
  )
  assert.equal(state.pending, 'requesting')
  assert.equal(sessionNotice(state), null)
  const back = comparisonSessionReducer(state, {
    type: 'select',
    performanceId: 'p-1',
  })
  assert.equal(sessionNotice(back), '실패')
})

test('marking again clears the notice of the last failed mark', () => {
  const opened = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
      { type: 'mark-failed', performanceId: 'p-1', message: '실패' },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'success' })]),
  )
  assert.equal(sessionNotice(opened), '실패')
  const state = comparisonSessionReducer(opened, {
    type: 'region-marked',
    comparisonId: 'c-1',
    regionId: 'region-1',
    checked: true,
  })
  assert.equal(sessionNotice(state), null)
})

test('marking a place updates the open result without touching the old one', () => {
  const before = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'success' })]),
  )
  const state = comparisonSessionReducer(before, {
    type: 'region-marked',
    comparisonId: 'c-1',
    regionId: 'region-1',
    checked: true,
  })
  assert.equal(state.result?.regions[0].checked, true)
  assert.equal(before.result?.regions[0].checked, false)
})

test('marking a place of a comparison no longer open changes nothing', () => {
  const before = run(
    [
      { type: 'status-loaded', status: status('c-1', 'success') },
      { type: 'result-loaded', result: result('c-1'), playback: null },
    ],
    loaded([performance('p-1', { id: 'c-1', state: 'success' })]),
  )
  assert.equal(
    comparisonSessionReducer(before, {
      type: 'region-marked',
      comparisonId: 'c-9',
      regionId: 'region-1',
      checked: true,
    }),
    before,
  )
})

test('the tab counts the takes that have a comparison', () => {
  const state = loaded([
    performance('p-3'),
    performance('p-2', { id: 'c-2', state: 'failed' }),
    performance('p-1', { id: 'c-1', state: 'success' }),
  ])
  assert.equal(comparedTakeCount(state), 2)
})
