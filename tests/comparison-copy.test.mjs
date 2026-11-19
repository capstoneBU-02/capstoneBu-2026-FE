import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baselineLabel,
  comparisonFailureCopy,
  comparisonProgressLabel,
  comparisonSummaryCopy,
  notComparableCopy,
  regionTagLabel,
  tempoNote,
  unavailableRegionCopy,
} from '../src/features/comparison/comparisonCopy.ts'

const baselines = [
  ['original-song', '원곡'],
  ['separated-input', '올린 음원'],
]

const failure = (retry) => ({ stage: 'compare', code: 'COMPARE_FAILED', retry })
const region = (kind) => ({ kind })

test('the baseline is named as the player knows it (CMP-01)', () => {
  for (const [baseline, label] of baselines) {
    assert.equal(baselineLabel(baseline), label)
  }
})

test('a comparison that has not started waits for its turn', () => {
  assert.equal(
    comparisonProgressLabel({ state: 'queued', currentStage: null }),
    '비교 순서를 기다리고 있어요',
  )
})

test('progress names the stage that is running', () => {
  const labels = {
    align: '연주와 기준 음원을 맞추고 있어요',
    transcription: '연주한 음을 읽고 있어요',
    compare: '다르게 들리는 곳을 찾고 있어요',
  }
  for (const [currentStage, label] of Object.entries(labels)) {
    assert.equal(
      comparisonProgressLabel({ state: 'processing', currentStage }),
      label,
    )
  }
})

test('queued between stages keeps the stage that just finished', () => {
  assert.equal(
    comparisonProgressLabel({ state: 'queued', currentStage: 'align' }),
    '연주와 기준 음원을 맞추고 있어요',
  )
})

test('progress never shows a number', () => {
  const stages = [null, 'align', 'transcription', 'compare']
  for (const currentStage of stages) {
    const label = comparisonProgressLabel({ state: 'queued', currentStage })
    assert.doesNotMatch(label, /[\d%]/)
  }
})

test('a take much shorter than the section could not be lined up', () => {
  for (const [baseline, label] of baselines) {
    assert.deepEqual(notComparableCopy('RERECORD_TOO_SHORT', baseline), {
      title: `${label}과 맞춰 보지 못했어요`,
      description: '연주가 구간보다 많이 짧아요.',
    })
  }
})

test('a take with almost no sound points at the input device', () => {
  for (const [baseline] of baselines) {
    assert.deepEqual(notComparableCopy('RERECORD_FEW_NOTES', baseline), {
      title: '소리가 거의 녹음되지 않았어요',
      description: '입력 장치와 볼륨을 확인해 주세요.',
    })
  }
})

test('a low match asks whether the same section was played', () => {
  for (const [baseline, label] of baselines) {
    assert.deepEqual(notComparableCopy('LOW_MATCH_RATE', baseline), {
      title: `${label}과 맞춰 보지 못했어요`,
      description: '같은 구간을 연주했는지 확인해 주세요.',
    })
  }
})

test('an unknown or missing reason still gets a way forward', () => {
  for (const reason of ['SOMETHING_NEW', '', null]) {
    assert.deepEqual(notComparableCopy(reason, 'original-song'), {
      title: '이 연주는 비교하지 못했어요',
      description: '다시 녹음하거나 다른 파일을 올려 주세요.',
    })
  }
})

test('a place that could not be compared says why (CMP-05)', () => {
  for (const [baseline, label] of baselines) {
    assert.equal(
      unavailableRegionCopy('LOW_CONFIDENCE', baseline),
      '소리가 또렷하지 않아 비교하지 못했어요',
    )
    assert.equal(
      unavailableRegionCopy('UNCLEAR_ALIGNMENT', baseline),
      `${label}과 위치를 맞추기 어려워 비교하지 못했어요`,
    )
  }
})

test('an unknown reason for a place stays general', () => {
  for (const reason of ['SOMETHING_NEW', '', null]) {
    assert.equal(
      unavailableRegionCopy(reason, 'separated-input'),
      '이 부분은 비교하지 못했어요',
    )
  }
})

test('a place that could not be compared never blames the accompaniment', () => {
  const reasons = ['LOW_CONFIDENCE', 'UNCLEAR_ALIGNMENT', 'ACCOMPANIMENT', null]
  for (const reason of reasons) {
    for (const [baseline] of baselines) {
      assert.doesNotMatch(unavailableRegionCopy(reason, baseline), /반주/)
    }
  }
})

test('every kind of difference shares one tag', () => {
  for (const kind of [
    'pitch-difference',
    'missing-note',
    'timing-difference',
  ]) {
    assert.equal(regionTagLabel(kind), '다르게 들림')
  }
  assert.equal(regionTagLabel('unavailable'), '비교 못 함')
})

test('a failure that cannot be sent again offers another take', () => {
  const expected = {
    title: '비교를 끝내지 못했어요',
    description:
      '이 연주는 다시 시도할 수 없어요. 다시 녹음하거나 다른 파일을 올려 주세요.',
    canRetry: false,
  }
  assert.deepEqual(comparisonFailureCopy(null), expected)
  assert.deepEqual(comparisonFailureCopy(failure(null)), expected)
})

test('a failure with no tries left says they were used up', () => {
  assert.deepEqual(comparisonFailureCopy(failure({ left: 0, limit: 3 })), {
    title: '비교를 끝내지 못했어요',
    description:
      '다시 시도할 수 있는 횟수를 모두 사용했어요. 다시 녹음하거나 다른 파일을 올려 주세요.',
    canRetry: false,
  })
})

test('a failure with tries left shows how many remain', () => {
  assert.deepEqual(comparisonFailureCopy(failure({ left: 2, limit: 3 })), {
    title: '비교를 끝내지 못했어요',
    description: '다시 시도할 수 있어요. 남은 횟수 2회',
    canRetry: true,
  })
})

test('a result with differences needs no summary', () => {
  assert.equal(
    comparisonSummaryCopy([region('pitch-difference')], 'original-song'),
    null,
  )
  assert.equal(
    comparisonSummaryCopy(
      [region('unavailable'), region('timing-difference')],
      'original-song',
    ),
    null,
  )
})

test('no differences still asks the player to listen again', () => {
  for (const [baseline, label] of baselines) {
    assert.deepEqual(comparisonSummaryCopy([], baseline), {
      title: '다르게 들리는 곳이 없어요',
      description: `${label}과 번갈아 들으며 한 번 더 확인해 보세요.`,
    })
  }
})

test('places left uncompared are counted in the summary', () => {
  assert.deepEqual(
    comparisonSummaryCopy(
      [region('unavailable'), region('unavailable')],
      'original-song',
    ),
    {
      title: '비교하지 못한 곳이 있어요',
      description:
        '2곳은 비교하지 못했어요. 나머지 부분에서는 다르게 들리는 곳을 찾지 못했어요.',
    },
  )
})

test('places left uncompared never read as no differences', () => {
  const copy = comparisonSummaryCopy([region('unavailable')], 'separated-input')
  assert.ok(!copy.title.includes('다르게 들리는 곳이 없어요'))
  assert.ok(!copy.description.includes('다르게 들리는 곳이 없어요'))
})

test('only a slow take gets a tempo note, without numbers', () => {
  assert.equal(tempoNote({ isSlow: true }), '전체적으로 느린 연주예요')
  assert.equal(tempoNote({ isSlow: false }), null)
  assert.equal(tempoNote(null), null)
})

test('no copy judges the take as right, wrong or complete (COPY-04)', () => {
  const reasons = [
    'RERECORD_TOO_SHORT',
    'RERECORD_FEW_NOTES',
    'LOW_MATCH_RATE',
    'LOW_CONFIDENCE',
    'UNCLEAR_ALIGNMENT',
    null,
  ]
  const copies = baselines.flatMap(([baseline]) => [
    ...reasons.flatMap((reason) => [
      ...Object.values(notComparableCopy(reason, baseline)),
      unavailableRegionCopy(reason, baseline),
    ]),
    ...Object.values(comparisonSummaryCopy([], baseline)),
    ...Object.values(comparisonSummaryCopy([region('unavailable')], baseline)),
  ])
  const labels = [
    tempoNote({ isSlow: true }),
    regionTagLabel('pitch-difference'),
    regionTagLabel('unavailable'),
    comparisonFailureCopy(null).description,
  ]
  for (const copy of [...copies, ...labels]) {
    assert.doesNotMatch(copy, /정답|오답|틀렸|틀린|잘못|실수|완벽|완주|똑같/)
  }
})
