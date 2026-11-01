import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockWorkspaceRepository } from '../src/features/workspace/mockRepository.ts'
import { readDemoScenario } from '../src/app/demoConfig.ts'

const signal = () => new AbortController().signal

test('cancelled load preserves the failure and retry scenario in StrictMode', async () => {
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

test('only supported demo query scenarios are enabled', () => {
  assert.equal(readDemoScenario('?demo=empty'), 'empty')
  assert.equal(readDemoScenario('?demo=unknown'), 'default')
  assert.equal(readDemoScenario(''), 'default')
})
