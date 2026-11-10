import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  processingPhase,
  stageLabel,
  stageStatusLabel,
  statusAnnouncement,
  taskStages,
} from '../src/features/workspace/processing.ts'

const base = {
  processingStatus: 'queued',
  failureKind: null,
  hasSeparatedAudio: false,
}

const statuses = (task, inputKind = 'original') =>
  taskStages(task, inputKind).map((stage) => `${stage.id}:${stage.status}`)

test('original input separates the guitar, then makes the tab', () => {
  assert.deepEqual(statuses(base), [
    'separation:waiting',
    'transcription:waiting',
  ])
  assert.deepEqual(statuses({ ...base, processingStatus: 'processing' }), [
    'separation:running',
    'transcription:waiting',
  ])
  assert.deepEqual(
    statuses({
      ...base,
      processingStatus: 'processing',
      hasSeparatedAudio: true,
    }),
    ['separation:done', 'transcription:running'],
  )
  assert.deepEqual(
    statuses({
      ...base,
      processingStatus: 'completed',
      hasSeparatedAudio: true,
    }),
    ['separation:done', 'transcription:done'],
  )
})

test('failures name the stage that failed (JOB-01, TAB-03)', () => {
  assert.deepEqual(
    statuses({
      ...base,
      processingStatus: 'failed',
      failureKind: 'transcription',
      hasSeparatedAudio: true,
    }),
    ['separation:done', 'transcription:failed'],
  )
  // Without guitar audio the tab is never started.
  assert.deepEqual(
    statuses({ ...base, processingStatus: 'failed', failureKind: 'no-guitar' }),
    ['separation:failed', 'transcription:waiting'],
  )
})

test('a retried task waits with the guitar it already separated (JOB-04)', () => {
  assert.deepEqual(statuses({ ...base, hasSeparatedAudio: true }), [
    'separation:done',
    'transcription:waiting',
  ])
})

test('separated-guitar input skips separation (JOB-02)', () => {
  assert.deepEqual(statuses(base, 'separated-guitar'), [
    'separation:skipped',
    'transcription:waiting',
  ])
  assert.deepEqual(
    statuses({ ...base, processingStatus: 'processing' }, 'separated-guitar'),
    ['separation:skipped', 'transcription:running'],
  )
  assert.deepEqual(
    statuses(
      {
        ...base,
        processingStatus: 'failed',
        failureKind: 'transcription',
        hasSeparatedAudio: true,
      },
      'separated-guitar',
    ),
    ['separation:skipped', 'transcription:failed'],
  )
})

test('stages and their states have distinct labels', () => {
  assert.equal(stageLabel('separation'), '기타 분리')
  assert.equal(stageLabel('transcription'), '타브 생성')
  const labels = ['waiting', 'running', 'done', 'failed', 'skipped'].map(
    stageStatusLabel,
  )
  assert.equal(new Set(labels).size, labels.length)
  assert.equal(stageStatusLabel('skipped'), '건너뜀')
})

test('the phase changes with the status and the running stage only', () => {
  const separating = { ...base, processingStatus: 'processing' }
  const transcribing = { ...separating, hasSeparatedAudio: true }
  const phase = (task) => processingPhase(task, taskStages(task, 'original'))
  const phases = [base, separating, transcribing].map(phase)

  assert.equal(new Set(phases).size, 3)
  assert.equal(
    phase({ ...transcribing, progressPercent: 10 }),
    phase({ ...transcribing, progressPercent: 90 }),
  )
})

test('status changes are announced with what happened', () => {
  const announce = (task, inputKind = 'original') =>
    statusAnnouncement(task, taskStages(task, inputKind))
  assert.equal(announce(base), '순서를 기다리고 있어요.')
  assert.equal(
    announce({ ...base, processingStatus: 'processing' }),
    '기타 분리를 시작했어요.',
  )
  assert.equal(
    announce({
      ...base,
      processingStatus: 'processing',
      hasSeparatedAudio: true,
    }),
    '타브 생성을 시작했어요.',
  )
  assert.equal(
    announce({ ...base, processingStatus: 'processing' }, 'separated-guitar'),
    '타브 생성을 시작했어요.',
  )
  assert.equal(
    announce({
      ...base,
      processingStatus: 'completed',
      hasSeparatedAudio: true,
    }),
    '타브를 다 만들었어요.',
  )
  assert.equal(
    announce({
      ...base,
      processingStatus: 'failed',
      failureKind: 'transcription',
      hasSeparatedAudio: true,
    }),
    '타브를 만들지 못했어요.',
  )
  // Without separated guitar the failure was in the separation.
  assert.equal(
    announce({
      ...base,
      processingStatus: 'failed',
      failureKind: 'transcription',
    }),
    '기타를 분리하지 못했어요.',
  )
  assert.equal(
    announce({
      ...base,
      processingStatus: 'failed',
      failureKind: 'no-guitar',
    }),
    '기타 소리를 거의 찾지 못했어요.',
  )
})
