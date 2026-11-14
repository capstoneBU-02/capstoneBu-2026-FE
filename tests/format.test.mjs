import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTaskRange,
  formatTime,
  isTaskInProgress,
  playbackFailureText,
  songInputLabel,
  taskHeadlineStatus,
} from '../src/features/workspace/format.ts'

test('times use minutes, seconds and tenths', () => {
  assert.equal(formatTime(0), '00:00.0')
  assert.equal(formatTime(42.1), '00:42.1')
  assert.equal(formatTime(65.84), '01:05.8')
  assert.equal(formatTime(59.96), '01:00.0')
  assert.equal(formatTime(-1), '00:00.0')
  assert.equal(
    formatTaskRange({ rangeStartSeconds: 42.1, rangeEndSeconds: 65.8 }),
    '00:42.1–01:05.8',
  )
})

test('input kinds and headline statuses have distinct labels', () => {
  assert.notEqual(
    songInputLabel('original'),
    songInputLabel('separated-guitar'),
  )
  const base = { failureKind: null }
  assert.equal(
    taskHeadlineStatus({ ...base, processingStatus: 'completed' }),
    '완료',
  )
  assert.equal(
    taskHeadlineStatus({ ...base, processingStatus: 'processing' }),
    '진행 중',
  )
  assert.equal(
    taskHeadlineStatus({ ...base, processingStatus: 'queued' }),
    '대기',
  )
  assert.equal(
    taskHeadlineStatus({
      processingStatus: 'failed',
      failureKind: 'transcription',
    }),
    '타브 실패',
  )
  assert.equal(
    taskHeadlineStatus({
      processingStatus: 'failed',
      failureKind: 'no-guitar',
    }),
    '기타를 찾지 못함',
  )
})

test('queued and processing tasks both count as in progress', () => {
  const statuses = ['queued', 'processing', 'completed', 'failed']
  assert.deepEqual(
    statuses.map((processingStatus) => isTaskInProgress({ processingStatus })),
    [true, true, false, false],
  )
})

test('a track that fails to play is named once, with 음원', () => {
  assert.equal(
    playbackFailureText('분리 기타'),
    '분리 기타 음원을 재생하지 못했어요. 타브는 그대로 볼 수 있어요.',
  )
  assert.equal(
    playbackFailureText('원곡'),
    '원곡 음원을 재생하지 못했어요. 타브는 그대로 볼 수 있어요.',
  )
  assert.equal(
    playbackFailureText('올린 음원'),
    '올린 음원을 재생하지 못했어요. 타브는 그대로 볼 수 있어요.',
  )
})
