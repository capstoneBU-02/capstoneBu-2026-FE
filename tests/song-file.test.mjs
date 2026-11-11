import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UPLOAD_POLICY } from '../src/features/add-song/uploadPolicy.ts'
import {
  checkSongDuration,
  formatClockDuration,
  formatFileSize,
  isAllowedSongFile,
  songFileAccept,
  songFileMessage,
  songNameFromFileName,
  uploadHintLabel,
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

test('duration is checked in the whole seconds that the card displays', () => {
  assert.deepEqual(checkSongDuration(252.4), {
    status: 'valid',
    durationSeconds: 252.4,
  })
  // 300.9 s reads as 05:00, so it must not be rejected as over five minutes.
  assert.equal(checkSongDuration(300.9).status, 'valid')
  assert.deepEqual(checkSongDuration(301), {
    status: 'too-long',
    durationSeconds: 301,
  })
  for (const unreadable of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(checkSongDuration(unreadable), { status: 'unreadable' })
  }
  const shorter = { ...UPLOAD_POLICY, maxDurationSeconds: 180 }
  assert.equal(checkSongDuration(181, shorter).status, 'too-long')
})

test('hint and messages derive from the policy so a limit changes in one place', () => {
  assert.equal(uploadHintLabel(), 'MP3, MP4 · 최대 5분')
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
