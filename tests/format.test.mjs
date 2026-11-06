import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTaskRange,
  formatTime,
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
