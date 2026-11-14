import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  preferredTrack,
  taskTracks,
  trackChoices,
  trackLead,
  trackRange,
  trackWindow,
  wantedTrack,
} from '../src/features/workspace/tracks.ts'

const base = {
  processingStatus: 'processing',
  failureKind: null,
  hasSeparatedAudio: false,
}
const rows = (task, inputKind = 'original') =>
  taskTracks(task, inputKind).map(
    (track) => `${track.id}:${track.label}:${track.content}`,
  )

test('original input shows the separated guitar above the original', () => {
  assert.deepEqual(rows({ ...base, hasSeparatedAudio: true }), [
    'separated:분리 기타:audio',
    'input:원곡:audio',
  ])
})

test('the guitar row waits for separation', () => {
  assert.deepEqual(rows(base), [
    'separated:분리 기타:pending',
    'input:원곡:audio',
  ])
})

test('no guitar leaves the guitar row flat whatever audio is kept', () => {
  for (const hasSeparatedAudio of [false, true])
    assert.deepEqual(
      rows({
        processingStatus: 'failed',
        failureKind: 'no-guitar',
        hasSeparatedAudio,
      }),
      ['separated:분리 기타:flat', 'input:원곡:audio'],
    )
})

test('a failed task without the guitar says separation failed', () => {
  for (const failureKind of [null, 'transcription'])
    assert.deepEqual(
      rows({
        processingStatus: 'failed',
        failureKind,
        hasSeparatedAudio: false,
      }),
      ['separated:분리 기타:missing', 'input:원곡:audio'],
    )
  // Waiting or separating is not a failure.
  for (const processingStatus of ['queued', 'processing'])
    assert.equal(
      rows({ ...base, processingStatus })[0],
      'separated:분리 기타:pending',
    )
})

test('a failed tab keeps the separated guitar (JOB-04)', () => {
  assert.deepEqual(
    rows({
      processingStatus: 'failed',
      failureKind: 'transcription',
      hasSeparatedAudio: true,
    }),
    ['separated:분리 기타:audio', 'input:원곡:audio'],
  )
})

test('separated-guitar input has one row for the uploaded audio (JOB-02)', () => {
  for (const hasSeparatedAudio of [false, true])
    assert.deepEqual(rows({ ...base, hasSeparatedAudio }, 'separated-guitar'), [
      'input:올린 음원:audio',
    ])
})

test('the separated guitar plays once it exists, the input until then', () => {
  const pick = (task, inputKind) => preferredTrack(taskTracks(task, inputKind))
  assert.equal(pick({ ...base, hasSeparatedAudio: true }), 'separated')
  assert.equal(pick(base), 'input')
  assert.equal(
    pick({
      processingStatus: 'failed',
      failureKind: 'no-guitar',
      hasSeparatedAudio: true,
    }),
    'input',
  )
  assert.equal(
    pick({ ...base, hasSeparatedAudio: true }, 'separated-guitar'),
    'input',
  )
})

test('the input covers the section within the song, the separated guitar starts at 0', () => {
  const task = { rangeStartSeconds: 151, rangeEndSeconds: 172.4 }
  assert.deepEqual(trackWindow('input', task), { start: 151, end: 172.4 })
  assert.deepEqual(trackRange('input', task), {
    startTenths: 1510,
    endTenths: 1724,
  })
  const separated = trackWindow('separated', task)
  assert.equal(separated.start, 0)
  assert.ok(Math.abs(separated.end - 21.4) < 1e-9)
  assert.deepEqual(trackRange('separated', task), {
    startTenths: 0,
    endTenths: 214,
  })
})

test('both tracks round to the same length in tenths', () => {
  // 42.14–65.86 is 23.72 s: 237 tenths alone, 659 - 421 = 238 from the ends.
  const task = { rangeStartSeconds: 42.14, rangeEndSeconds: 65.86 }
  const input = trackRange('input', task)
  const separated = trackRange('separated', task)
  assert.deepEqual(input, { startTenths: 421, endTenths: 659 })
  assert.deepEqual(separated, { startTenths: 0, endTenths: 238 })
})

test('the player counts the input from its rounded start, the guitar from 0', () => {
  const task = { rangeStartSeconds: 42.14, rangeEndSeconds: 65.86 }
  // The input player starts at 42.1, before the section's own start.
  assert.ok(Math.abs(trackLead('input', task) - -0.04) < 1e-9)
  assert.equal(trackLead('separated', task), 0)
  const whole = { rangeStartSeconds: 151, rangeEndSeconds: 172.4 }
  assert.equal(trackLead('input', whole), 0)
})

const noGuitar = {
  processingStatus: 'failed',
  failureKind: 'no-guitar',
  hasSeparatedAudio: true,
}

test('a chosen track plays while it has audio, the preferred one otherwise', () => {
  const both = taskTracks({ ...base, hasSeparatedAudio: true }, 'original')
  assert.equal(wantedTrack(both, null), 'separated')
  assert.equal(wantedTrack(both, 'input'), 'input')
  assert.equal(wantedTrack(both, 'separated'), 'separated')
  for (const task of [base, noGuitar])
    assert.equal(
      wantedTrack(taskTracks(task, 'original'), 'separated'),
      'input',
    )
})

test('the switch offers the original first and the guitar once it has audio', () => {
  const offer = (task, inputKind = 'original') =>
    trackChoices(taskTracks(task, inputKind), () => true).map(
      (choice) => `${choice.id}:${choice.label}:${choice.enabled}`,
    )
  assert.deepEqual(offer({ ...base, hasSeparatedAudio: true }), [
    'input:원곡:true',
    'separated:분리 기타:true',
  ])
  assert.deepEqual(offer(base), [
    'input:원곡:true',
    'separated:분리 기타:false',
  ])
  assert.deepEqual(offer(noGuitar), [
    'input:원곡:true',
    'separated:분리 기타:false',
  ])
  // One track has nothing to switch to.
  assert.deepEqual(offer(base, 'separated-guitar'), [])
})

test('a track whose audio is still loading or failed cannot be chosen yet', () => {
  const both = taskTracks({ ...base, hasSeparatedAudio: true }, 'original')
  const offer = (playable) =>
    trackChoices(both, playable).map(
      (choice) => `${choice.id}:${choice.enabled}`,
    )
  assert.deepEqual(
    offer((id) => id === 'input'),
    ['input:true', 'separated:false'],
  )
  assert.deepEqual(
    offer(() => false),
    ['input:false', 'separated:false'],
  )
})
