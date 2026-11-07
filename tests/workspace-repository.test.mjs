import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockWorkspaceRepository } from '../src/features/workspace/mockRepository.ts'
import { readDemoScenario } from '../src/app/demoConfig.ts'

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

test('only supported demo query scenarios are enabled', () => {
  assert.equal(readDemoScenario('?demo=empty'), 'empty')
  assert.equal(readDemoScenario('?demo=unknown'), 'default')
  assert.equal(readDemoScenario(''), 'default')
})
