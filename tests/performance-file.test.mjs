import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UPLOAD_POLICY } from '../src/features/add-song/uploadPolicy.ts'
import { songFileAccept } from '../src/features/add-song/songFile.ts'
import {
  checkPerformanceDuration,
  PERFORMANCE_PRIVACY_NOTE,
  performanceFileAccept,
  performanceFileMessage,
  performanceFileMeta,
  performanceUploadFile,
  performanceUploadGuide,
  performanceUploadHint,
} from '../src/features/comparison/performanceFile.ts'

// Swaps the shared policy for one call, to prove labels are read from it
// rather than written into the copy.
function withFormatLabels(labels, read) {
  const original = UPLOAD_POLICY.formats
  UPLOAD_POLICY.formats = labels.map((label) => ({
    label,
    extensions: [label.toLowerCase()],
    mimeTypes: [],
  }))
  try {
    return read()
  } finally {
    UPLOAD_POLICY.formats = original
  }
}

test('a file of exactly half or exactly twice the section can be compared', () => {
  assert.deepEqual(checkPerformanceDuration(10, 20), {
    status: 'valid',
    durationSeconds: 10,
  })
  assert.deepEqual(checkPerformanceDuration(40, 20), {
    status: 'valid',
    durationSeconds: 40,
  })
  assert.equal(checkPerformanceDuration(11.85, 23.7).status, 'valid')
  assert.equal(checkPerformanceDuration(47.4, 23.7).status, 'valid')
})

test('a file just outside those lengths is refused and keeps its duration', () => {
  assert.deepEqual(checkPerformanceDuration(9.99, 20), {
    status: 'too-short',
    durationSeconds: 9.99,
  })
  assert.deepEqual(checkPerformanceDuration(40.01, 20), {
    status: 'too-long',
    durationSeconds: 40.01,
  })
})

test('a length that cannot be read carries no duration', () => {
  for (const length of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(checkPerformanceDuration(length, 20), {
      status: 'unreadable',
    })
  }
  assert.deepEqual(checkPerformanceDuration(10, 0), { status: 'unreadable' })
})

test('the file input accepts the same files as a song upload', () => {
  assert.equal(performanceFileAccept(), songFileAccept())
})

test('the guide names the section and its length at one decimal', () => {
  assert.equal(
    performanceUploadGuide('벌스 1', 23.7),
    '벌스 1(23.7초) 구간을 연주한 파일을 올려 주세요. 반주 없이 기타 소리만 들어 있어야 해요.',
  )
  assert.match(
    performanceUploadGuide('벌스 1', 20),
    /^벌스 1\(20\.0초\) 구간을 /,
  )
  assert.match(
    performanceUploadGuide('벌스 1', 23.76),
    /^벌스 1\(23\.8초\) 구간을 /,
  )
})

test('the guide reads correctly after a name with no final consonant', () => {
  assert.match(performanceUploadGuide('솔로', 12), /^솔로\(12\.0초\) 구간을 /)
})

test('the hint and the privacy note use the agreed copy', () => {
  assert.equal(
    performanceUploadHint(),
    'MP3, MP4 · 구간을 처음부터 끝까지 연주한 파일',
  )
  assert.equal(
    PERFORMANCE_PRIVACY_NOTE,
    '올린 연주는 다른 테스터에게 보이지 않아요.',
  )
})

test('each refused file explains what to do next', () => {
  assert.equal(
    performanceFileMessage({ status: 'too-short', durationSeconds: 5 }, 23.7),
    '구간(23.7초)보다 많이 짧아요. 구간 전체를 연주한 파일을 올려 주세요.',
  )
  assert.equal(
    performanceFileMessage({ status: 'too-long', durationSeconds: 90 }, 23.7),
    '구간(23.7초)보다 많이 길어요. 구간만 연주한 파일을 올려 주세요.',
  )
  assert.equal(
    performanceFileMessage({ status: 'invalid-format' }, 23.7),
    'MP3, MP4 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.',
  )
  assert.equal(
    performanceFileMessage({ status: 'too-large' }, 23.7),
    '50MB 이하 파일만 올릴 수 있어요. 용량을 줄여서 다시 올려 주세요.',
  )
  assert.equal(
    performanceFileMessage({ status: 'unreadable' }, 23.7),
    '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.',
  )
  assert.equal(
    performanceFileMessage({ status: 'timed-out' }, 23.7),
    '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.',
  )
})

test('the section length in a message always shows one decimal', () => {
  assert.match(
    performanceFileMessage({ status: 'too-short', durationSeconds: 5 }, 20),
    /^구간\(20\.0초\)보다 많이 짧아요/,
  )
  assert.match(
    performanceFileMessage({ status: 'too-long', durationSeconds: 90 }, 23.76),
    /^구간\(23\.8초\)보다 많이 길어요/,
  )
})

test('a file being checked or already accepted shows no message', () => {
  assert.equal(performanceFileMessage({ status: 'checking' }, 23.7), null)
  assert.equal(
    performanceFileMessage({ status: 'valid', durationSeconds: 20 }, 23.7),
    null,
  )
})

test('format labels follow the upload policy', () => {
  const labels = ['MP3', 'MP4', 'WAV']

  assert.equal(
    withFormatLabels(labels, performanceUploadHint),
    'MP3, MP4, WAV · 구간을 처음부터 끝까지 연주한 파일',
  )
  assert.equal(
    withFormatLabels(labels, () =>
      performanceFileMessage({ status: 'invalid-format' }, 23.7),
    ),
    'MP3, MP4, WAV 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.',
  )
  assert.equal(
    withFormatLabels(labels, performanceFileAccept),
    '.mp3,.mp4,.wav',
  )
})

test('the file card shows the length whenever it is known', () => {
  const file = { size: 8.4 * 1024 * 1024 }

  for (const status of ['valid', 'too-short', 'too-long']) {
    assert.equal(
      performanceFileMeta(file, { status, durationSeconds: 83.9 }),
      '01:23 · 8.4MB',
      status,
    )
  }
})

test('the file card says why the length is missing', () => {
  const file = { size: 1536 }

  assert.equal(
    performanceFileMeta(file, { status: 'checking' }),
    '길이 확인 중 · 1.5KB',
  )
  assert.equal(
    performanceFileMeta(file, { status: 'unreadable' }),
    '길이 알 수 없음 · 1.5KB',
  )
  assert.equal(
    performanceFileMeta(file, { status: 'timed-out' }),
    '길이 알 수 없음 · 1.5KB',
  )
  assert.equal(performanceFileMeta(file, { status: 'invalid-format' }), '1.5KB')
})

test('a file over the size limit shows only its size', () => {
  assert.equal(
    performanceFileMeta({ size: 60 * 1024 * 1024 }, { status: 'too-large' }),
    '60.0MB',
  )
})

test('a chosen file goes with its name and the type the server accepts', () => {
  const chosen = new File(['take'], '연습 3.mp3', { type: 'audio/mp3' })
  const sent = performanceUploadFile({ audio: chosen })
  assert.equal(sent.name, '연습 3.mp3')
  assert.equal(sent.type, 'audio/mpeg')

  const exact = new File(['take'], '연습.mp4', { type: 'video/mp4' })
  assert.equal(performanceUploadFile({ audio: exact }), exact)
})

test('a recording goes as a WAV file with a name', async () => {
  const sent = performanceUploadFile({
    audio: new Blob(['wave'], { type: 'audio/wav' }),
  })
  assert.ok(sent instanceof File)
  assert.equal(sent.name, 'take.wav')
  assert.equal(sent.type, 'audio/wav')
  assert.equal(await sent.text(), 'wave')
})
