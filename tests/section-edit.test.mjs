import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECTION_POLICY } from '../src/features/new-section/sectionPolicy.ts'
import {
  checkSectionForm,
  isPolicySectionName,
  parseSectionName,
} from '../src/features/new-section/sectionForm.ts'
import {
  canReviseSection,
  canSendSectionEdit,
  changesSectionResult,
  otherFileSectionForm,
  sectionEditKind,
  sectionFormFromTask,
} from '../src/features/edit-section/sectionEdit.ts'

const verse = {
  id: 'task-verse',
  songId: 'song-neon-harbor',
  sectionName: '벌스 1',
  part: 'rhythm',
  tuningId: 'e-standard',
  partLabel: '리듬 기타',
  tuningLabel: 'E 표준 6현',
  rangeStartSeconds: 42.1,
  rangeEndSeconds: 65.8,
  processingStatus: 'completed',
  failureKind: null,
  progressPercent: null,
  hasSeparatedAudio: true,
  comparisonCount: 2,
  copyStatus: 'confirmed',
  updatedAtLabel: '오늘 21:40',
}

const song = { songDurationSeconds: 252, existingNames: ['솔로'] }
const verseRange = { rangeStartSeconds: 42.1, rangeEndSeconds: 65.8 }

test('a policy section name splits into its name and number', () => {
  assert.deepEqual(parseSectionName('벌스 1'), {
    baseName: '벌스',
    number: '1',
  })
  assert.deepEqual(parseSectionName('코러스 12'), {
    baseName: '코러스',
    number: '12',
  })
  // A bare name has no number, and 코러스 is not read out of 프리코러스.
  assert.deepEqual(parseSectionName('솔로'), { baseName: '솔로', number: '' })
  assert.deepEqual(parseSectionName('프리코러스 2'), {
    baseName: '프리코러스',
    number: '2',
  })
  for (const name of ['', '벌스 0', '벌스 07', '벌스 100', '벌스1', '기타']) {
    assert.equal(parseSectionName(name), null, name)
    assert.equal(isPolicySectionName(name), false, name)
  }
  assert.equal(isPolicySectionName(`벌스 ${SECTION_POLICY.maxNumber}`), true)
})

test('the edit form starts from the task the user is editing', () => {
  const form = sectionFormFromTask(verse)
  assert.equal(form.baseName, '벌스')
  assert.equal(form.number, '1')
  assert.equal(form.start, '00:42.1')
  assert.equal(form.end, '01:05.8')
  assert.equal(form.part, 'rhythm')
  assert.equal(form.tuningId, 'e-standard')
  assert.equal(form.attempted, false)
  assert.deepEqual(form.touched, { start: false, end: false, number: false })

  const check = checkSectionForm(form, song)
  assert.deepEqual(check.shown, {})
  assert.deepEqual(check.request, {
    sectionName: '벌스 1',
    part: 'rhythm',
    tuningId: 'e-standard',
    rangeStartSeconds: 42.1,
    rangeEndSeconds: 65.8,
  })
})

test('a bare section name stays bare instead of taking the next number', () => {
  const form = sectionFormFromTask({
    ...verse,
    sectionName: '솔로',
    part: 'lead',
    tuningId: 'drop-d',
  })
  assert.equal(form.baseName, '솔로')
  assert.equal(form.number, '')
  assert.equal(form.part, 'lead')
  assert.equal(form.tuningId, 'drop-d')
  assert.equal(
    checkSectionForm(form, { ...song, existingNames: [] }).request?.sectionName,
    '솔로',
  )
})

test('only the range, part and tuning change what the tab is made from', () => {
  const same = {
    sectionName: '벌스 1',
    part: 'rhythm',
    tuningId: 'e-standard',
    rangeStartSeconds: 42.1,
    rangeEndSeconds: 65.8,
  }
  assert.equal(changesSectionResult(verse, same), false)
  // A renamed section keeps the same tab.
  assert.equal(
    changesSectionResult(verse, { ...same, sectionName: '코러스 1' }),
    false,
  )
  // Tenths are compared, so floating-point noise is not a change.
  assert.equal(
    changesSectionResult(verse, { ...same, rangeStartSeconds: 42.1000001 }),
    false,
  )
  for (const change of [
    { rangeStartSeconds: 42.2 },
    { rangeEndSeconds: 60 },
    { part: 'lead' },
    { tuningId: 'drop-d' },
  ]) {
    assert.equal(
      changesSectionResult(verse, { ...same, ...change }),
      true,
      JSON.stringify(change),
    )
  }
})

test('only a finished task offers a section change', () => {
  assert.equal(canReviseSection(verse), true)
  for (const processingStatus of ['queued', 'processing', 'failed']) {
    assert.equal(
      canReviseSection({ ...verse, processingStatus }),
      false,
      processingStatus,
    )
  }
})

// The song in 코러스 2's range had no guitar (SEPARATION_NO_GUITAR).
const noGuitar = {
  ...verse,
  id: 'task-chorus',
  sectionName: '코러스 2',
  tuningId: 'drop-d',
  rangeStartSeconds: 190,
  rangeEndSeconds: 211,
  processingStatus: 'failed',
  failureKind: 'no-guitar',
  hasSeparatedAudio: false,
}

test('a section without guitar is moved, a finished one changed', () => {
  assert.equal(sectionEditKind(verse), 'revise')
  assert.equal(sectionEditKind(noGuitar), 'redefine')
  // A tab failure is sent again; a queued or running task has no result yet.
  for (const task of [
    { ...verse, processingStatus: 'failed', failureKind: 'transcription' },
    { ...verse, processingStatus: 'queued' },
    { ...verse, processingStatus: 'processing' },
  ])
    assert.equal(sectionEditKind(task), null, JSON.stringify(task))
  // The top bar's 구간 수정 stays for a finished task alone.
  assert.equal(canReviseSection(noGuitar), false)
})

test('a section without guitar has to move its range to be sent', () => {
  const same = {
    sectionName: '코러스 2',
    part: 'rhythm',
    tuningId: 'drop-d',
    rangeStartSeconds: 190,
    rangeEndSeconds: 211,
  }
  // The same range finds no guitar again, whatever the part or tuning.
  for (const change of [{}, { part: 'lead' }, { tuningId: 'e-standard' }])
    assert.equal(
      canSendSectionEdit(noGuitar, { ...same, ...change }),
      false,
      JSON.stringify(change),
    )
  for (const change of [
    { rangeStartSeconds: 185.5 },
    { rangeEndSeconds: 205 },
    { rangeEndSeconds: 205, part: 'lead' },
  ])
    assert.equal(
      canSendSectionEdit(noGuitar, { ...same, ...change }),
      true,
      JSON.stringify(change),
    )
  // A finished task keeps the rule of 구간 수정.
  const verseSame = { ...same, ...verseRange, tuningId: 'e-standard' }
  assert.equal(canSendSectionEdit(verse, verseSame), false)
  assert.equal(canSendSectionEdit(verse, { ...verseSame, part: 'lead' }), true)
  // Nothing else can be sent at all.
  assert.equal(
    canSendSectionEdit(
      { ...verse, processingStatus: 'failed', failureKind: 'transcription' },
      { ...verseSame, rangeEndSeconds: 60 },
    ),
    false,
  )
})

test('another file starts a new section with the name and tuning kept', () => {
  const form = otherFileSectionForm(noGuitar)
  assert.equal(form.baseName, '코러스')
  assert.equal(form.number, '2')
  assert.equal(form.tuningId, 'drop-d')
  // The range and part were chosen for the old file.
  assert.equal(form.start, '')
  assert.equal(form.end, '')
  assert.equal(form.part, SECTION_POLICY.parts[0].id)
  assert.equal(form.attempted, false)
})

test('a part or tuning the policy no longer lists falls back to its first', () => {
  const form = sectionFormFromTask({
    ...verse,
    part: 'bass',
    tuningId: 'b-standard-7',
  })
  assert.equal(form.part, SECTION_POLICY.parts[0].id)
  assert.equal(form.tuningId, SECTION_POLICY.tunings[0].id)
  // What the inputs show is what a submit sends.
  const request = checkSectionForm(form, song).request
  assert.equal(request?.part, SECTION_POLICY.parts[0].id)
  assert.equal(request?.tuningId, SECTION_POLICY.tunings[0].id)
  assert.equal(changesSectionResult({ ...verse, part: 'bass' }, request), true)
})

test('a name the policy does not list falls back to its first name', () => {
  const form = sectionFormFromTask({ ...verse, sectionName: '기타 솔로' })
  assert.equal(form.baseName, SECTION_POLICY.names[0])
  assert.equal(form.number, null)
  // Values the policy lists are kept as they are.
  assert.equal(form.part, 'rhythm')
  assert.equal(form.tuningId, 'e-standard')
})
