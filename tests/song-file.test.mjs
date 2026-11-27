import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UPLOAD_POLICY } from '../src/features/add-song/uploadPolicy.ts'
import {
  addSongFailureMessage,
  checkSongDuration,
  formatClockDuration,
  formatFileSize,
  invalidAudioAdvice,
  isAllowedSongFile,
  isFileRefusal,
  isSameFile,
  precheckSongFile,
  songFileAccept,
  songFileMessage,
  songNameFromFileName,
  songUploadFile,
  uploadHintLabel,
  uploadProgressLabel,
} from '../src/features/add-song/songFile.ts'
import {
  createMediaDurationProbe,
  MediaDurationError,
} from '../src/features/add-song/mediaDuration.ts'

const file = (name, type = '') => ({ name, type })

test('only MP3 and MP4 names with a matching or missing MIME pass the format check', () => {
  for (const candidate of [
    file('neon_harbor_live.mp3', 'audio/mpeg'),
    file('NEON.MP3', 'audio/mp3'),
    file('late_train_cover.mp4', 'video/mp4'),
    file('stem.mp4', 'audio/mp4'),
    // Some platforms report no MIME or a generic one; playback decides later.
    file('no_mime.mp3', ''),
    file('generic.mp4', 'application/octet-stream'),
    file('param.mp3', 'audio/mpeg; charset=binary'),
  ]) {
    assert.equal(isAllowedSongFile(candidate), true, candidate.name)
  }

  for (const candidate of [
    file('neon_harbor_live.wav', 'audio/wav'),
    file('take.m4a', 'audio/mp4'),
    file('mp3', 'audio/mpeg'),
    file('.mp3', 'audio/mpeg'),
    file('cover.mp3.wav', 'audio/wav'),
    // The name says MP3 but the browser identified another format.
    file('renamed.mp3', 'audio/wav'),
    file('crossed.mp3', 'video/mp4'),
    file('notes.txt', 'text/plain'),
  ]) {
    assert.equal(isAllowedSongFile(candidate), false, candidate.name)
  }
})

test('duration is checked in rounded milliseconds, as the server checks it', () => {
  assert.deepEqual(checkSongDuration(252.4), {
    status: 'valid',
    durationSeconds: 252.4,
  })
  assert.equal(checkSongDuration(299.999).status, 'valid')
  assert.equal(checkSongDuration(300).status, 'valid')
  // Rounds to 300000 ms.
  assert.equal(checkSongDuration(300.0004).status, 'valid')
  // The server refuses these, so they are not sent at all.
  assert.deepEqual(checkSongDuration(300.001), {
    status: 'too-long',
    durationSeconds: 300.001,
  })
  assert.equal(checkSongDuration(300.9).status, 'too-long')
  for (const unreadable of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(checkSongDuration(unreadable), { status: 'unreadable' })
  }
  const shorter = { ...UPLOAD_POLICY, maxDurationSeconds: 180 }
  assert.equal(checkSongDuration(181, shorter).status, 'too-long')
})

const MB = 1024 * 1024
const sized = (name, type, size) => ({ name, type, size })

test('format and size are checked before the length, in the server order', () => {
  assert.equal(UPLOAD_POLICY.maxFileBytes, 50 * MB)
  assert.equal(precheckSongFile(sized('a.mp3', 'audio/mpeg', 50 * MB)), null)
  assert.deepEqual(
    precheckSongFile(sized('a.mp3', 'audio/mpeg', 50 * MB + 1)),
    { status: 'too-large' },
  )
  // A wrong format is named first, whatever its size.
  assert.deepEqual(precheckSongFile(sized('a.wav', 'audio/wav', 80 * MB)), {
    status: 'invalid-format',
  })
  const smaller = { ...UPLOAD_POLICY, maxFileBytes: 20 * MB }
  assert.deepEqual(
    precheckSongFile(sized('a.mp4', 'video/mp4', 21 * MB), smaller),
    { status: 'too-large' },
  )
})

test('the file sent carries the MIME type the server accepts for its extension', async () => {
  const unnamed = new File(['abc'], 'No Mime.MP3', {
    type: '',
    lastModified: 1_700_000_000_000,
  })
  const sent = songUploadFile(unnamed)
  assert.equal(sent.type, 'audio/mpeg')
  assert.equal(sent.name, 'No Mime.MP3')
  assert.equal(sent.lastModified, 1_700_000_000_000)
  assert.equal(await sent.text(), 'abc')

  for (const [name, type, expected] of [
    ['generic.mp4', 'application/octet-stream', 'video/mp4'],
    ['stem.mp4', 'audio/mp4', 'video/mp4'],
    ['alias.mp3', 'audio/x-mp3', 'audio/mpeg'],
    ['param.mp3', 'audio/mpeg; charset=binary', 'audio/mpeg'],
  ]) {
    assert.equal(songUploadFile(new File([], name, { type })).type, expected)
  }

  // A file that already has it is sent as it is.
  const ready = new File([], 'ready.mp3', { type: 'audio/mpeg' })
  assert.equal(songUploadFile(ready), ready)
  const unknown = new File([], 'clip.wav', { type: 'audio/wav' })
  assert.equal(songUploadFile(unknown), unknown)
})

test('hint and messages derive from the policy so a limit changes in one place', () => {
  assert.equal(uploadHintLabel(), 'MP3, MP4 · 최대 5분')
  assert.equal(
    songFileMessage({ status: 'too-large' }),
    '50MB 이하 파일만 올릴 수 있어요. 용량을 줄여서 다시 올려 주세요.',
  )
  assert.match(
    songFileMessage(
      { status: 'too-large' },
      { ...UPLOAD_POLICY, maxFileBytes: 1.5 * MB },
    ),
    /^1\.5MB 이하 파일만/,
  )
  assert.equal(
    songFileMessage({ status: 'invalid-format' }),
    'MP3, MP4 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.',
  )
  assert.equal(
    songFileMessage({ status: 'too-long', durationSeconds: 391 }),
    '5분 이하 파일만 올릴 수 있어요. 필요한 부분만 잘라서 올려 주세요.',
  )
  assert.equal(
    songFileMessage({ status: 'unreadable' }),
    '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.',
  )
  // A slow read is not a broken file.
  assert.equal(
    songFileMessage({ status: 'timed-out' }),
    '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.',
  )
  assert.equal(songFileMessage({ status: 'checking' }), null)
  assert.equal(songFileMessage({ status: 'valid', durationSeconds: 10 }), null)

  const policy = { ...UPLOAD_POLICY, maxDurationSeconds: 210 }
  assert.equal(uploadHintLabel(policy), 'MP3, MP4 · 최대 3분 30초')
  assert.match(
    songFileMessage({ status: 'too-long', durationSeconds: 300 }, policy),
    /^3분 30초 이하 파일만/,
  )
  assert.equal(
    uploadHintLabel({ ...UPLOAD_POLICY, maxDurationSeconds: 45 }),
    'MP3, MP4 · 최대 45초',
  )
})

test('a section the server could not read asks for another range or a file in the allowed formats', () => {
  assert.equal(
    invalidAudioAdvice(),
    '고른 구간에서 소리를 읽지 못했어요. 소리가 나는 구간을 다시 고르거나 다른 MP3, MP4 파일을 올려 보세요.',
  )
  const mp3Only = {
    ...UPLOAD_POLICY,
    formats: UPLOAD_POLICY.formats.filter((format) => format.label === 'MP3'),
  }
  assert.match(invalidAudioAdvice(mp3Only), /다른 MP3 파일을/)
})

test('a refused add names what the server found, with the same wording as the checks', () => {
  assert.equal(
    addSongFailureMessage('song-unsupported'),
    '이 파일은 처리할 수 없어요. 다른 MP3, MP4 파일로 다시 올려 주세요.',
  )
  assert.equal(
    addSongFailureMessage('song-too-long'),
    songFileMessage({ status: 'too-long', durationSeconds: 301 }),
  )
  assert.equal(
    addSongFailureMessage('song-too-large'),
    songFileMessage({ status: 'too-large' }),
  )
  assert.equal(
    addSongFailureMessage('storage-full'),
    '작업 공간에 더 올릴 수 없어요. 올릴 수 있는 곡 수나 저장 용량을 모두 사용했어요.',
  )
  assert.equal(
    addSongFailureMessage('add-song-failed'),
    '곡을 추가하지 못했어요. 다시 시도해 주세요.',
  )
  for (const reason of ['song-unsupported', 'song-too-long', 'song-too-large'])
    assert.equal(isFileRefusal(reason), true, reason)
  for (const reason of ['storage-full', 'add-song-failed'])
    assert.equal(isFileRefusal(reason), false, reason)
})

test('a file chosen again from disk counts as the file the server refused', () => {
  const at = Date.UTC(2026, 10, 28)
  const refused = new File(['abcd'], 'riff.mp3', {
    type: 'audio/mpeg',
    lastModified: at,
  })
  const again = new File(['wxyz'], 'riff.mp3', {
    type: 'audio/mpeg',
    lastModified: at,
  })
  assert.equal(isSameFile(refused, refused), true)
  assert.equal(isSameFile(refused, again), true)
  for (const other of [
    new File(['abcd'], 'riff2.mp3', { type: 'audio/mpeg', lastModified: at }),
    new File(['abcde'], 'riff.mp3', { type: 'audio/mpeg', lastModified: at }),
    new File(['abcd'], 'riff.mp3', { type: 'video/mp4', lastModified: at }),
    // Saved again after an edit.
    new File(['abcd'], 'riff.mp3', {
      type: 'audio/mpeg',
      lastModified: at + 1,
    }),
  ])
    assert.equal(isSameFile(refused, other), false, other.name)
})

test('upload progress reads as sending, then as the server checking the file', () => {
  assert.equal(uploadProgressLabel(null), '파일 올리는 중')
  assert.equal(uploadProgressLabel(0), '파일 올리는 중 0%')
  assert.equal(uploadProgressLabel(42), '파일 올리는 중 42%')
  assert.equal(uploadProgressLabel(99), '파일 올리는 중 99%')
  assert.equal(uploadProgressLabel(100), '파일 확인 중')
})

test('the file input accepts the allowed extensions and MIME types', () => {
  const accept = songFileAccept().split(',')
  for (const value of ['.mp3', '.mp4', 'audio/mpeg', 'video/mp4']) {
    assert.ok(accept.includes(value), value)
  }
  assert.ok(!accept.includes('.wav'))
})

test('sizes, clock durations and song names match the Figma card', () => {
  assert.equal(formatFileSize(8.4 * 1024 * 1024), '8.4MB')
  assert.equal(formatFileSize(61.2 * 1024 * 1024), '61.2MB')
  assert.equal(formatFileSize(1536), '1.5KB')
  assert.equal(formatFileSize(900), '900B')
  assert.equal(formatFileSize(0), '0B')
  assert.equal(formatFileSize(2.5 * 1024 ** 3), '2.5GB')

  assert.equal(formatClockDuration(252.9), '04:12')
  assert.equal(formatClockDuration(391), '06:31')
  assert.equal(formatClockDuration(0.4), '00:00')
  assert.equal(formatClockDuration(3725), '62:05')

  assert.equal(songNameFromFileName('neon_harbor_live.mp3'), 'neon_harbor_live')
  assert.equal(songNameFromFileName('live.take.2.MP4'), 'live.take.2')
  assert.equal(songNameFromFileName('  spaced  .mp3'), 'spaced')
  assert.equal(songNameFromFileName('.mp3'), '.mp3')
})

class FakeMedia extends EventTarget {
  preload = ''
  src = ''
  duration = Number.NaN
  loads = 0
  removeAttribute(name) {
    if (name === 'src') this.src = ''
  }
  // Like a real media element, reloading without a source clears the duration.
  load() {
    this.loads += 1
    if (!this.src) this.duration = Number.NaN
  }
}

function fakeEnvironment() {
  const created = []
  const revoked = []
  const media = []
  return {
    created,
    revoked,
    media,
    environment: {
      createMedia() {
        const element = new FakeMedia()
        media.push(element)
        return element
      },
      createObjectURL() {
        const url = `blob:fake/${created.length}`
        created.push(url)
        return url
      },
      revokeObjectURL(url) {
        revoked.push(url)
      },
    },
  }
}

const blob = new Blob(['fake'])

test('the duration probe reads metadata and always revokes its object URL', async () => {
  const fake = fakeEnvironment()
  const probe = createMediaDurationProbe(1000, fake.environment)
  const reading = probe(blob, new AbortController().signal)
  const [element] = fake.media
  assert.equal(element.preload, 'metadata')
  assert.equal(element.src, 'blob:fake/0')
  // Loading starts explicitly for browsers that ignore preload on a detached
  // element.
  assert.equal(element.loads, 1)
  assert.deepEqual(fake.revoked, [])

  element.duration = 252
  element.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(await reading, 252)
  assert.deepEqual(fake.revoked, ['blob:fake/0'])
  // The element lets go of the file so the decoder can be released.
  assert.equal(element.src, '')
  assert.equal(element.loads, 2)
})

test('decode errors, timeouts and cancellation reject after revoking', async () => {
  const failing = fakeEnvironment()
  const failed = createMediaDurationProbe(1000, failing.environment)(
    blob,
    new AbortController().signal,
  )
  failing.media[0].dispatchEvent(new Event('error'))
  await assert.rejects(failed, (error) => {
    assert.ok(error instanceof MediaDurationError)
    assert.equal(error.reason, 'unreadable')
    return true
  })
  assert.deepEqual(failing.revoked, failing.created)

  const slow = fakeEnvironment()
  await assert.rejects(
    createMediaDurationProbe(5, slow.environment)(
      blob,
      new AbortController().signal,
    ),
    { reason: 'timeout' },
  )
  assert.deepEqual(slow.revoked, slow.created)

  const cancelled = fakeEnvironment()
  const controller = new AbortController()
  const reading = createMediaDurationProbe(1000, cancelled.environment)(
    blob,
    controller.signal,
  )
  controller.abort()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.deepEqual(cancelled.revoked, cancelled.created)
  // A late event after cancellation cannot resurrect the result.
  cancelled.media[0].dispatchEvent(new Event('loadedmetadata'))
  assert.equal(cancelled.revoked.length, 1)

  const early = fakeEnvironment()
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    createMediaDurationProbe(1000, early.environment)(blob, aborted.signal),
    { name: 'AbortError' },
  )
  assert.deepEqual(early.created, [])
})
