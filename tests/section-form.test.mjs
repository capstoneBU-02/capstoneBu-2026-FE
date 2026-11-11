import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECTION_POLICY } from '../src/features/new-section/sectionPolicy.ts'
import {
  formatSectionLength,
  formatSectionTime,
  parseSectionTime,
  songLengthTenths,
} from '../src/features/new-section/sectionTime.ts'
import {
  checkSectionForm,
  checkSectionRange,
  createSectionForm,
  isPolicySectionName,
  nextSectionNumber,
  sectionFormReducer,
  sectionName,
  sectionNumberText,
} from '../src/features/new-section/sectionForm.ts'

test('section times parse mm:ss.d into tenths and reject other shapes', () => {
  assert.equal(parseSectionTime('00:42.1'), 421)
  assert.equal(parseSectionTime('01:05.8'), 658)
  assert.equal(parseSectionTime('0:42'), 420)
  assert.equal(parseSectionTime(' 4:12.4 '), 2524)
  assert.equal(parseSectionTime('00:00.0'), 0)
  for (const text of [
    '',
    '42.1',
    '00:60.0',
    '00:42.12',
    '00:4',
    '-00:01.0',
    '100:00.0',
    '00:42,1',
    '00:42.',
    'ab:cd.e',
  ]) {
    assert.equal(parseSectionTime(text), null, text)
  }
})

test('section times format back to the Figma mm:ss.d and 23.7초 shapes', () => {
  assert.equal(formatSectionTime(421), '00:42.1')
  assert.equal(formatSectionTime(2524), '04:12.4')
  assert.equal(formatSectionTime(0), '00:00.0')
  assert.equal(formatSectionLength(237), '23.7초')
  assert.equal(formatSectionLength(300), '30.0초')
})

test('a song length counts only whole tenths it really contains', () => {
  assert.equal(songLengthTenths(252.4), 2524)
  assert.equal(songLengthTenths(252.49), 2524)
  assert.equal(songLengthTenths(0.3), 3)
  assert.equal(songLengthTenths(96), 960)
})

test('repeated section names get the next free number', () => {
  assert.equal(nextSectionNumber('벌스', ['벌스 1', '솔로']), 2)
  assert.equal(nextSectionNumber('벌스', ['벌스 2']), 1)
  assert.equal(nextSectionNumber('솔로', ['솔로']), 2)
  assert.equal(nextSectionNumber('코러스', []), 1)
  assert.equal(nextSectionNumber('벌스', ['프리벌스 1', '벌스 1', '벌스 3']), 2)
  assert.equal(sectionName('벌스', '2'), '벌스 2')
  assert.equal(sectionName('솔로', ''), '솔로')

  // The repository accepts only names the screen can compose.
  for (const name of ['벌스 2', '솔로', '인터루드 99'])
    assert.equal(isPolicySectionName(name), true, name)
  for (const name of [
    '',
    '벌스 0',
    '벌스 100',
    '벌스  2',
    '기타 솔로',
    '벌스 02',
  ])
    assert.equal(isPolicySectionName(name), false, name)
})

const song = { songDurationSeconds: 252.4, existingNames: ['벌스 1'] }

function fill(start, end, extra = []) {
  return [
    { type: 'start', value: start },
    { type: 'blur', field: 'start' },
    { type: 'end', value: end },
    { type: 'blur', field: 'end' },
    ...extra,
  ].reduce(sectionFormReducer, createSectionForm())
}

test('a fresh form follows the policy defaults and asks for nothing yet', () => {
  const form = createSectionForm()
  assert.equal(form.baseName, SECTION_POLICY.names[0])
  assert.equal(form.part, SECTION_POLICY.parts[0].id)
  assert.equal(form.tuningId, SECTION_POLICY.tunings[0].id)
  assert.equal(sectionNumberText(form, ['인트로 1']), '2')

  const check = checkSectionForm(form, song)
  assert.equal(check.request, null)
  // Nothing is shown before the user leaves a field or tries to submit.
  assert.deepEqual(check.shown, {})
  assert.ok(check.errors.start && check.errors.end)
  assert.equal(check.lengthTenths, null)
})

test('a valid range becomes the request with the composed section name', () => {
  const form = fill('0:42.1', '01:05.8', [
    { type: 'name', baseName: '벌스' },
    { type: 'part', part: 'lead' },
    { type: 'tuning', tuningId: SECTION_POLICY.tunings[1].id },
  ])
  // Leaving a field rewrites a parsed time in the canonical shape.
  assert.equal(form.start, '00:42.1')
  const check = checkSectionForm(form, song)
  assert.deepEqual(check.errors, {})
  assert.equal(check.lengthTenths, 237)
  assert.deepEqual(check.request, {
    sectionName: '벌스 2',
    part: 'lead',
    tuningId: SECTION_POLICY.tunings[1].id,
    rangeStartSeconds: 42.1,
    rangeEndSeconds: 65.8,
  })
})

test('the range satisfies 0 ≤ start < end ≤ song length', () => {
  const cases = [
    ['00:00.0', '00:10.0', {}],
    ['04:00.0', '04:12.4', {}],
    [
      '00:10.0',
      '00:05.0',
      { end: '끝이 시작보다 앞에 있어요. 끝 시간을 다시 입력해 주세요.' },
    ],
    [
      '00:10.0',
      '00:10.0',
      { end: '끝이 시작과 같아요. 끝 시간을 다시 입력해 주세요.' },
    ],
    [
      '04:00.0',
      '04:12.5',
      { end: '끝이 곡 길이(04:12.4)를 넘어요. 끝 시간을 다시 입력해 주세요.' },
    ],
    [
      '04:12.4',
      '04:12.4',
      {
        start:
          '시작은 곡 길이(04:12.4)보다 앞이어야 해요. 시작 시간을 다시 입력해 주세요.',
        end: '끝이 시작과 같아요. 끝 시간을 다시 입력해 주세요.',
      },
    ],
    [
      '0:4',
      '00:61.0',
      {
        start: '시작 시간을 00:00.0 형식으로 입력해 주세요.',
        end: '끝 시간을 00:00.0 형식으로 입력해 주세요.',
      },
    ],
  ]
  for (const [start, end, errors] of cases) {
    const check = checkSectionForm(fill(start, end), song)
    assert.deepEqual(check.errors, errors, `${start}–${end}`)
    assert.equal(check.request === null, Object.keys(errors).length > 0)
  }
})

test('the section limit accepts the boundary and refuses anything longer', () => {
  const limit = SECTION_POLICY.maxDurationSeconds
  assert.equal(limit, 30)
  const boundary = checkSectionForm(fill('00:42.1', '01:12.1'), song)
  assert.deepEqual(boundary.errors, {})
  assert.equal(boundary.lengthTenths, 300)

  const over = checkSectionForm(fill('00:42.1', '01:12.2'), song)
  assert.deepEqual(over.errors, {
    range: '구간은 30초까지 정할 수 있어요. 범위를 줄여 주세요.',
  })
  // The length stays visible so the user can see how far over it is.
  assert.equal(over.lengthTenths, 301)
  assert.equal(over.request, null)

  const shorter = { ...SECTION_POLICY, maxDurationSeconds: 90 }
  assert.equal(
    checkSectionForm(fill('00:00.0', '01:30.1'), song, shorter).errors.range,
    '구간은 1분 30초까지 정할 수 있어요. 범위를 줄여 주세요.',
  )
})

test('errors appear for touched fields, and every field once submit is tried', () => {
  const startOnly = [
    { type: 'start', value: '00:4' },
    { type: 'blur', field: 'start' },
    { type: 'end', value: '00:0' },
  ].reduce(sectionFormReducer, createSectionForm())
  const check = checkSectionForm(startOnly, song)
  assert.deepEqual(Object.keys(check.shown), ['start'])

  const tried = sectionFormReducer(startOnly, { type: 'attempt' })
  assert.deepEqual(Object.keys(checkSectionForm(tried, song).shown).sort(), [
    'end',
    'start',
  ])
  // An over-limit range waits until both ends were touched.
  const half = [
    { type: 'start', value: '00:00.0' },
    { type: 'end', value: '00:40.0' },
    { type: 'blur', field: 'end' },
  ].reduce(sectionFormReducer, createSectionForm())
  assert.ok(checkSectionForm(half, song).errors.range)
  assert.deepEqual(checkSectionForm(half, song).shown, {})
})

test('the number is optional but must stay within the policy when typed', () => {
  const typed = (value) =>
    [
      { type: 'number', value },
      { type: 'blur', field: 'number' },
    ].reduce(sectionFormReducer, fill('00:00.0', '00:10.0'))
  assert.equal(checkSectionForm(typed(''), song).request.sectionName, '인트로')
  assert.equal(typed('07').number, '7')
  assert.equal(
    checkSectionForm(typed('07'), song).request.sectionName,
    '인트로 7',
  )
  // Enter submits without a blur; the request still uses the plain number.
  const unblurred = sectionFormReducer(fill('00:00.0', '00:10.0'), {
    type: 'number',
    value: '007',
  })
  assert.equal(unblurred.number, '007')
  const request = checkSectionForm(unblurred, song).request
  assert.equal(request.sectionName, '인트로 7')
  assert.ok(isPolicySectionName(request.sectionName))
  for (const value of ['0', '100', '1a', '-1']) {
    assert.equal(
      checkSectionForm(typed(value), song).shown.number,
      '번호는 1부터 99까지 숫자로 입력해 주세요.',
      value,
    )
  }
  // An untouched number keeps following the chosen name.
  const auto = sectionFormReducer(createSectionForm(), {
    type: 'name',
    baseName: '벌스',
  })
  assert.equal(sectionNumberText(auto, ['벌스 1']), '2')
  const kept = sectionFormReducer(typed('5'), {
    type: 'name',
    baseName: '벌스',
  })
  assert.equal(sectionNumberText(kept, ['벌스 1']), '5')
})

test('a waveform selection writes the same fields the inputs edit', () => {
  const form = sectionFormReducer(createSectionForm(), {
    type: 'range',
    startSeconds: 42.14,
    endSeconds: 65.76,
    songDurationSeconds: 252.4,
  })
  assert.equal(form.start, '00:42.1')
  assert.equal(form.end, '01:05.8')
  assert.ok(form.touched.start && form.touched.end)
})

test('a waveform selection to the file end stays inside the song', () => {
  const song = { songDurationSeconds: 252.49, existingNames: [] }
  const form = sectionFormReducer(createSectionForm(), {
    type: 'range',
    startSeconds: 230,
    endSeconds: 252.49,
    songDurationSeconds: song.songDurationSeconds,
  })
  assert.equal(form.end, '04:12.4')
  assert.equal(checkSectionForm(form, song).errors.end, undefined)
  const early = sectionFormReducer(createSectionForm(), {
    type: 'range',
    startSeconds: -0.04,
    endSeconds: 10,
    songDurationSeconds: song.songDurationSeconds,
  })
  assert.equal(early.start, '00:00.0')
})

test('replacing the file clears the range and part but keeps name and tuning', () => {
  const form = fill('00:42.1', '01:05.8', [
    { type: 'name', baseName: '코러스' },
    { type: 'number', value: '3' },
    { type: 'part', part: 'lead' },
    { type: 'tuning', tuningId: SECTION_POLICY.tunings[2].id },
    { type: 'attempt' },
  ])
  const replaced = sectionFormReducer(form, { type: 'replace-file' })
  assert.deepEqual(replaced, {
    ...createSectionForm(),
    baseName: '코러스',
    number: '3',
    tuningId: SECTION_POLICY.tunings[2].id,
  })
  // The reducer never mutates the previous state.
  assert.equal(form.start, '00:42.1')
})

test('the repository check applies the same range rule to seconds', () => {
  assert.equal(checkSectionRange(42.1, 65.8, 252.4), true)
  assert.equal(checkSectionRange(0, 30, 252.4), true)
  assert.equal(checkSectionRange(0, 30.1, 252.4), false)
  assert.equal(checkSectionRange(10, 10, 252.4), false)
  assert.equal(checkSectionRange(250, 252.5, 252.4), false)
  assert.equal(checkSectionRange(-1, 5, 252.4), false)
  assert.equal(checkSectionRange(Number.NaN, 5, 252.4), false)
})

test('the repository check refuses times between tenths', () => {
  // The screen sends whole tenths; a server would not round others in.
  assert.equal(checkSectionRange(0, 30.04, 252.4), false)
  assert.equal(checkSectionRange(10.05, 20, 252.4), false)
  assert.equal(checkSectionRange(0.3, 0.7, 252.4), true)
  assert.equal(checkSectionRange(3 / 10, 271 / 10, 252.4), true)
})
