import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockWorkspaceRepository } from '../src/features/workspace/mockRepository.ts'
import { readDemoScenario } from '../src/app/demoConfig.ts'
import { SECTION_POLICY } from '../src/features/new-section/sectionPolicy.ts'

const signal = () => new AbortController().signal

test('cancelled load preserves the failure for the next request and allows retry', async () => {
  const repository = createMockWorkspaceRepository('error')
  const controller = new AbortController()
  const loading = repository.loadWorkspace(controller.signal)

  controller.abort()

  await assert.rejects(loading, { name: 'AbortError' })
  await assert.rejects(repository.loadWorkspace(signal()), {
    code: 'load-failed',
  })
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, 4)
})

test('cancelled consent cannot mutate the session and sessions are isolated', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const saving = repository.saveConsent('accepted', controller.signal)

  controller.abort()

  await assert.rejects(saving, { name: 'AbortError' })
  assert.equal(
    (await repository.loadWorkspace(signal())).consentChoice,
    'undecided',
  )

  await repository.saveConsent('declined', signal())

  assert.equal(
    (await repository.loadWorkspace(signal())).consentChoice,
    'declined',
  )
  assert.equal(
    (await createMockWorkspaceRepository().loadWorkspace(signal()))
      .consentChoice,
    'undecided',
  )
})

test('failed consent does not count as accepted', async () => {
  const repository = createMockWorkspaceRepository('consent-error')

  await assert.rejects(repository.saveConsent('accepted', signal()), {
    code: 'consent-failed',
  })
  assert.equal(
    (await repository.loadWorkspace(signal())).consentChoice,
    'undecided',
  )
})

test('expired workspace exposes neither a snapshot nor consent writes', async () => {
  const repository = createMockWorkspaceRepository('expired')

  await assert.rejects(repository.loadWorkspace(signal()), { code: 'expired' })
  await assert.rejects(repository.saveConsent('accepted', signal()), {
    code: 'expired',
  })
})

test('partial failure preserves audio and copy confirmation stays separate', async () => {
  const { tasks } =
    await createMockWorkspaceRepository().loadWorkspace(signal())
  const partial = tasks.find((task) => task.failureKind === 'transcription')

  assert.equal(partial.hasSeparatedAudio, true)
  assert.equal(partial.copyStatus, 'needs-review')
  assert.equal(
    tasks.filter((task) => task.copyStatus === 'confirmed').length,
    1,
  )
})

test('songs carry the input kind and every task references a listed song', async () => {
  const { songs, tasks } =
    await createMockWorkspaceRepository().loadWorkspace(signal())
  const songIds = new Set(songs.map((song) => song.id))

  assert.equal(songs.length, 3)
  assert.ok(tasks.every((task) => songIds.has(task.songId)))
  assert.deepEqual(
    new Set(songs.map((song) => song.inputKind)),
    new Set(['original', 'separated-guitar']),
  )
  for (const song of songs) {
    const songTasks = tasks.filter((task) => task.songId === song.id)
    assert.ok(songTasks.length > 0)
    assert.ok(
      songTasks.every((task) => task.rangeEndSeconds <= song.durationSeconds),
    )
  }
  assert.ok(tasks.every((task) => task.tuningLabel.length > 0))
})

test('a workspace without tasks lists no songs', async () => {
  const empty =
    await createMockWorkspaceRepository('empty').loadWorkspace(signal())
  const custom = await createMockWorkspaceRepository('default', {
    tasks: [],
  }).loadWorkspace(signal())

  assert.deepEqual(empty.songs, [])
  assert.deepEqual(custom.songs, [])
})

test('task detail returns copies of the task and its song', async () => {
  const repository = createMockWorkspaceRepository()
  const detail = await repository.loadTask('task-intro', signal())

  assert.equal(detail.task.id, 'task-intro')
  assert.equal(detail.song.id, detail.task.songId)
  assert.equal(detail.song.inputKind, 'separated-guitar')
  detail.task.sectionName = 'changed'
  detail.song.name = 'changed'
  const again = await repository.loadTask('task-intro', signal())
  assert.notEqual(again.task.sectionName, 'changed')
  assert.notEqual(again.song.name, 'changed')
})

test('unknown tasks and other sessions share one unavailable error', async () => {
  const repository = createMockWorkspaceRepository('default', {
    tasks: [],
  })

  await assert.rejects(repository.loadTask('task-verse', signal()), {
    code: 'task-unavailable',
  })
  await assert.rejects(
    createMockWorkspaceRepository().loadTask('task-unknown', signal()),
    { code: 'task-unavailable' },
  )
})

test('task detail honours cancellation, expiry and a one-off failure', async () => {
  const controller = new AbortController()
  const loading = createMockWorkspaceRepository().loadTask(
    'task-verse',
    controller.signal,
  )
  controller.abort()
  await assert.rejects(loading, { name: 'AbortError' })

  await assert.rejects(
    createMockWorkspaceRepository('expired').loadTask('task-verse', signal()),
    { code: 'expired' },
  )

  const failing = createMockWorkspaceRepository('error')
  await assert.rejects(failing.loadTask('task-verse', signal()), {
    code: 'load-failed',
  })
  assert.equal(
    (await failing.loadTask('task-verse', signal())).task.id,
    'task-verse',
  )
})

const upload = (overrides = {}) => ({
  file: new File(['audio'], 'new_take.mp3', { type: 'audio/mpeg' }),
  inputKind: 'separated-guitar',
  durationSeconds: 96.4,
  ...overrides,
})

test('an added song keeps its input kind and stays in the session list', async () => {
  const repository = createMockWorkspaceRepository('empty')
  const song = await repository.addSong(upload(), signal())

  assert.match(song.id, /^[a-z0-9][a-z0-9-]{0,63}$/)
  assert.deepEqual(
    { ...song, id: 'id' },
    {
      id: 'id',
      name: 'new_take',
      fileName: 'new_take.mp3',
      inputKind: 'separated-guitar',
      durationSeconds: 96.4,
    },
  )
  const second = await repository.addSong(
    upload({ inputKind: 'original' }),
    signal(),
  )
  assert.notEqual(second.id, song.id)
  assert.equal(second.inputKind, 'original')

  // A song without tasks still belongs to the session, unlike fixture songs.
  const snapshot = await repository.loadWorkspace(signal())
  assert.deepEqual(
    snapshot.songs.map((item) => item.id),
    [song.id, second.id],
  )
  assert.deepEqual(snapshot.tasks, [])
  song.name = 'changed'
  const again = await repository.loadWorkspace(signal())
  assert.equal(again.songs[0].name, 'new_take')
  assert.equal(
    (await createMockWorkspaceRepository('empty').loadWorkspace(signal())).songs
      .length,
    0,
  )
})

test('adding a song honours cancellation and expiry without changing the list', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const adding = repository.addSong(upload(), controller.signal)
  controller.abort()
  await assert.rejects(adding, { name: 'AbortError' })
  assert.equal((await repository.loadWorkspace(signal())).songs.length, 3)

  await assert.rejects(
    createMockWorkspaceRepository('expired').addSong(upload(), signal()),
    { code: 'expired' },
  )
})

test('the mock refuses a song the upload policy rejects, like a server would', async () => {
  const repository = createMockWorkspaceRepository('empty')
  for (const input of [
    upload({ file: new File(['audio'], 'take.wav', { type: 'audio/wav' }) }),
    upload({ durationSeconds: 301 }),
    upload({ durationSeconds: Number.NaN }),
  ]) {
    await assert.rejects(repository.addSong(input, signal()), {
      code: 'add-song-failed',
    })
  }
  assert.equal((await repository.loadWorkspace(signal())).songs.length, 0)
})

const section = (overrides = {}) => ({
  songId: 'song-neon-harbor',
  sectionName: '벌스 2',
  part: 'lead',
  tuningId: SECTION_POLICY.tunings[0].id,
  rangeStartSeconds: 42.1,
  rangeEndSeconds: 65.8,
  ...overrides,
})

test('a created task waits in the queue and opens like any other task', async () => {
  const repository = createMockWorkspaceRepository()
  const task = await repository.createTask(section(), signal())

  assert.match(task.id, /^[a-z0-9][a-z0-9-]{0,63}$/)
  assert.deepEqual(
    { ...task, id: 'id' },
    {
      id: 'id',
      songId: 'song-neon-harbor',
      sectionName: '벌스 2',
      partLabel: '리드 기타',
      tuningLabel: SECTION_POLICY.tunings[0].label,
      rangeStartSeconds: 42.1,
      rangeEndSeconds: 65.8,
      processingStatus: 'queued',
      failureKind: null,
      progressPercent: null,
      hasSeparatedAudio: false,
      comparisonCount: 0,
      copyStatus: 'unreviewed',
      updatedAtLabel: '방금',
    },
  )
  const second = await repository.createTask(
    section({ sectionName: '솔로' }),
    signal(),
  )
  assert.notEqual(second.id, task.id)

  const snapshot = await repository.loadWorkspace(signal())
  assert.deepEqual(
    snapshot.tasks.slice(-2).map((item) => item.id),
    [task.id, second.id],
  )
  const detail = await repository.loadTask(task.id, signal())
  assert.equal(detail.song.id, 'song-neon-harbor')
  task.sectionName = 'changed'
  assert.equal(
    (await repository.loadTask(task.id, signal())).task.sectionName,
    '벌스 2',
  )
})

test('a task can be created for a song added in the same session', async () => {
  const repository = createMockWorkspaceRepository('empty')
  const song = await repository.addSong(upload(), signal())
  const task = await repository.createTask(
    section({ songId: song.id, rangeStartSeconds: 66, rangeEndSeconds: 96 }),
    signal(),
  )
  assert.equal(task.songId, song.id)
})

test('the mock refuses a section the policy rejects, like a server would', async () => {
  const repository = createMockWorkspaceRepository()
  const before = (await repository.loadWorkspace(signal())).tasks.length
  for (const input of [
    section({ songId: 'song-missing' }),
    section({ rangeEndSeconds: 72.2 }),
    section({ rangeStartSeconds: 65.8 }),
    section({ rangeStartSeconds: 240, rangeEndSeconds: 252.1 }),
    section({ part: 'bass' }),
    section({ tuningId: 'seven-string' }),
    section({ sectionName: '' }),
    section({ sectionName: '벌스 0' }),
    section({ sectionName: '<script>' }),
  ]) {
    await assert.rejects(repository.createTask(input, signal()), {
      code: 'create-task-failed',
    })
  }
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, before)
})

test('creating a task honours cancellation and expiry', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const creating = repository.createTask(section(), controller.signal)
  controller.abort()
  await assert.rejects(creating, { name: 'AbortError' })
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, 4)

  await assert.rejects(
    createMockWorkspaceRepository('expired').createTask(section(), signal()),
    { code: 'expired' },
  )
})

test('fixture songs play a synthesized demo as long as the song', async () => {
  const repository = createMockWorkspaceRepository()
  const audio = await repository.loadSongAudio('song-paper-moon', signal())
  const view = new DataView(await audio.arrayBuffer())

  assert.equal(audio.type, 'audio/wav')
  const sampleRate = view.getUint32(24, true)
  const seconds = view.getUint32(40, true) / 2 / sampleRate
  assert.ok(Math.abs(seconds - 96) < 0.001, `got ${seconds}s`)
  // A second request reuses the session's audio instead of synthesizing again.
  assert.equal(
    await repository.loadSongAudio('song-paper-moon', signal()),
    audio,
  )
})

test('an added song plays the file the user chose', async () => {
  const repository = createMockWorkspaceRepository('empty')
  const input = upload()
  const song = await repository.addSong(input, signal())
  assert.equal(await repository.loadSongAudio(song.id, signal()), input.file)
})

test('song audio honours cancellation, expiry and unknown songs', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const loading = repository.loadSongAudio(
    'song-neon-harbor',
    controller.signal,
  )
  controller.abort()
  await assert.rejects(loading, { name: 'AbortError' })

  await assert.rejects(repository.loadSongAudio('song-missing', signal()), {
    code: 'audio-unavailable',
  })
  await assert.rejects(
    createMockWorkspaceRepository('expired').loadSongAudio(
      'song-neon-harbor',
      signal(),
    ),
    { code: 'expired' },
  )
})

test('cancelling one audio request leaves the shared demo to the others', async () => {
  const repository = createMockWorkspaceRepository()
  const first = new AbortController()
  const cancelled = repository.loadSongAudio('song-neon-harbor', first.signal)
  const kept = repository.loadSongAudio('song-neon-harbor', signal())
  // Past the mock's 200ms wait, while the demo is still being synthesized.
  await new Promise((resolve) => setTimeout(resolve, 205))
  first.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal((await kept).type, 'audio/wav')
})

test('only supported demo query scenarios are enabled', () => {
  assert.equal(readDemoScenario('?demo=empty'), 'empty')
  assert.equal(readDemoScenario('?demo=unknown'), 'default')
  assert.equal(readDemoScenario(''), 'default')
})
