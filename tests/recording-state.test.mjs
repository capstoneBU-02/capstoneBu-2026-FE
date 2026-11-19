import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordingLimitSeconds } from '../src/features/comparison/comparisonRules.ts'
import {
  SILENCE_PEAK,
  classifyMicrophoneError,
  isMicrophoneHeld,
  isSilentTake,
  microphoneProblemCopy,
  recordingReducer,
  recordingStopReason,
} from '../src/features/recording/recordingState.ts'

const take = Object.freeze({
  audio: new Blob(['take'], { type: 'audio/wav' }),
  durationSeconds: 12.5,
  silent: false,
})

const states = {
  idle: { phase: 'idle' },
  requesting: { phase: 'requesting' },
  recording: { phase: 'recording' },
  blocked: { phase: 'blocked', problem: 'denied' },
  review: { phase: 'review', take },
  saving: { phase: 'saving', take },
  'save-failed': { phase: 'save-failed', take, message: '저장하지 못했어요.' },
}
Object.values(states).forEach(Object.freeze)

const events = {
  start: { type: 'start' },
  granted: { type: 'granted' },
  refused: { type: 'refused', problem: 'no-device' },
  finished: { type: 'finished', take },
  interrupted: { type: 'interrupted' },
  cancel: { type: 'cancel' },
  save: { type: 'save' },
  'save-failed': { type: 'save-failed', message: '다시 시도해 주세요.' },
  saved: { type: 'saved' },
  discard: { type: 'discard' },
}

const validTransitions = [
  ['idle', 'start', { phase: 'requesting' }],
  ['blocked', 'start', { phase: 'requesting' }],
  ['requesting', 'granted', { phase: 'recording' }],
  ['requesting', 'refused', { phase: 'blocked', problem: 'no-device' }],
  ['requesting', 'cancel', { phase: 'idle' }],
  ['recording', 'finished', { phase: 'review', take }],
  ['recording', 'interrupted', { phase: 'blocked', problem: 'interrupted' }],
  ['recording', 'cancel', { phase: 'idle' }],
  ['blocked', 'cancel', { phase: 'idle' }],
  ['review', 'save', { phase: 'saving', take }],
  ['review', 'discard', { phase: 'idle' }],
  ['saving', 'saved', { phase: 'idle' }],
  [
    'saving',
    'save-failed',
    { phase: 'save-failed', take, message: '다시 시도해 주세요.' },
  ],
  ['save-failed', 'save', { phase: 'saving', take }],
  ['save-failed', 'discard', { phase: 'idle' }],
]

const isValidTransition = (phase, eventType) =>
  validTransitions.some(([from, type]) => from === phase && type === eventType)

for (const [phase, eventType, expected] of validTransitions) {
  test(`${phase} + ${eventType} moves to ${expected.phase}`, () => {
    const next = recordingReducer(states[phase], events[eventType])

    assert.deepEqual(next, expected)
    assert.notEqual(next, states[phase])
  })
}

test('every other phase and event pair keeps the same state object', () => {
  let ignoredPairs = 0

  for (const [phase, state] of Object.entries(states)) {
    for (const [eventType, event] of Object.entries(events)) {
      if (isValidTransition(phase, eventType)) continue

      ignoredPairs += 1
      assert.equal(
        recordingReducer(state, event),
        state,
        `${phase} + ${eventType} should be ignored`,
      )
    }
  }

  assert.equal(ignoredPairs, 55)
})

test('the same take is carried through saving and a failed save', () => {
  const review = recordingReducer(states.recording, events.finished)
  const saving = recordingReducer(review, events.save)
  const failed = recordingReducer(saving, events['save-failed'])
  const retrying = recordingReducer(failed, events.save)

  for (const state of [review, saving, failed, retrying]) {
    assert.equal(state.take, take)
  }
})

test('a second failed save shows the newest message', () => {
  const retrying = recordingReducer(states['save-failed'], events.save)
  const failed = recordingReducer(retrying, {
    type: 'save-failed',
    message: '연결을 확인해 주세요.',
  })

  assert.equal(failed.message, '연결을 확인해 주세요.')
})

test('the microphone is held only while requesting or recording', () => {
  const held = Object.values(states)
    .filter(isMicrophoneHeld)
    .map((state) => state.phase)

  assert.deepEqual(held, ['requesting', 'recording'])
})

test('microphone errors are classified by name', () => {
  const problems = {
    NotAllowedError: 'denied',
    SecurityError: 'denied',
    NotFoundError: 'no-device',
    OverconstrainedError: 'no-device',
    NotReadableError: 'busy',
    AbortError: 'busy',
  }

  for (const [name, problem] of Object.entries(problems)) {
    assert.equal(
      classifyMicrophoneError(new DOMException('failed', name)),
      problem,
    )
    assert.equal(classifyMicrophoneError({ name }), problem)
  }
})

test('any other failure means the browser cannot record', () => {
  const failures = [
    new Error('failed'),
    new TypeError('failed'),
    new DOMException('failed', 'InvalidStateError'),
    { name: 'constructor' },
    { name: '__proto__' },
    { name: 42 },
    {},
    'NotAllowedError',
    42,
    null,
    undefined,
  ]

  for (const failure of failures) {
    assert.equal(classifyMicrophoneError(failure), 'unsupported')
  }
})

test('each microphone problem tells the user what to do next', () => {
  const copy = {
    denied: {
      title: '마이크를 쓸 수 없어요',
      description:
        '브라우저 주소창의 권한 설정에서 마이크를 허용하거나, 녹음해 둔 파일을 올려 주세요.',
    },
    'no-device': {
      title: '마이크를 찾지 못했어요',
      description:
        '마이크를 연결한 뒤 다시 시도하거나, 녹음해 둔 파일을 올려 주세요.',
    },
    busy: {
      title: '마이크를 시작하지 못했어요',
      description:
        '다른 앱이 마이크를 사용 중인지 확인하거나, 녹음해 둔 파일을 올려 주세요.',
    },
    interrupted: {
      title: '녹음이 중단됐어요',
      description: '마이크 연결을 확인한 뒤 다시 녹음해 주세요.',
    },
    unsupported: {
      title: '이 브라우저에서는 녹음할 수 없어요',
      description: '녹음해 둔 파일을 올려 주세요.',
    },
  }

  for (const [problem, expected] of Object.entries(copy)) {
    assert.deepEqual(microphoneProblemCopy(problem), expected)
  }
})

test('a take is silent when its peak stays below the threshold', () => {
  assert.equal(SILENCE_PEAK, 0.01)
  assert.equal(isSilentTake(0), true)
  assert.equal(isSilentTake(0.0099), true)
})

test('a take at or above the threshold is not silent', () => {
  assert.equal(isSilentTake(SILENCE_PEAK), false)
  assert.equal(isSilentTake(0.5), false)
})

test('a peak that cannot be read counts as silent', () => {
  for (const peak of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(isSilentTake(peak), true)
  }
})

test('recording continues until the limit for the section', () => {
  assert.equal(recordingStopReason(0, 20), null)
  assert.equal(recordingStopReason(39.99, 20), null)
})

test('recording stops at the limit and beyond it', () => {
  const limit = recordingLimitSeconds(23.7)

  assert.equal(recordingStopReason(limit, 23.7), 'limit')
  assert.equal(recordingStopReason(limit + 0.01, 23.7), 'limit')
})
