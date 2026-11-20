import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_ACCESS_CODES, readAppMode } from '../src/app/demoConfig.ts'
import { createMockRepositories } from '../src/app/mockRepositories.ts'
import { loadAppRepositories } from '../src/app/repositories.ts'

const signal = () => new AbortController().signal

test('mock mode starts at code entry with a working mock access repository', async () => {
  const repositories = await loadAppRepositories({ mode: 'mock' }, '')
  assert.equal(repositories.entryNotice, null)
  assert.equal(repositories.entrySearch, '')
  assert.equal(repositories.preview, null)
  const entered = await repositories.access.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    signal(),
  )
  assert.equal(entered.onboardingCompleted, false)
})

test('access selectors keep their scenario for the next entry', async () => {
  const expired = createMockRepositories('?access=session-expired')
  assert.equal(expired.entryNotice, 'expired')
  assert.equal(expired.entrySearch, '?access=session-expired')

  const network = createMockRepositories('?access=network&code=secret')
  assert.equal(network.entryNotice, null)
  assert.equal(network.entrySearch, '?access=network')
  await assert.rejects(
    network.access.enter(DEMO_ACCESS_CODES.newWorkspace, signal()),
    { code: 'network' },
  )
})

test('a demo selector opens the workspace preview directly', async () => {
  const repositories = createMockRepositories('?demo=task-states')
  assert.equal(repositories.preview?.scenario, 'task-states')
  assert.equal(repositories.entrySearch, '')
  const snapshot = await repositories.preview.repository.loadWorkspace(signal())
  assert.ok(snapshot.tasks.length > 0)
  assert.equal(
    createMockRepositories('?demo=workspace').preview?.scenario,
    'default',
  )
})

test('each load builds fresh repositories', () => {
  const first = createMockRepositories('?demo=workspace')
  const second = createMockRepositories('?demo=workspace')
  assert.notEqual(first.access, second.access)
  assert.notEqual(first.preview.repository, second.preview.repository)
})

test('http mode ignores demo and access selectors', () => {
  const entry = { kind: 'access', scenario: 'default' }
  for (const search of [
    '?demo=workspace',
    '?demo=task-states',
    '?access=session-expired',
    '?access=network',
  ]) {
    assert.deepEqual(readAppMode(search, 'http'), entry, search)
    assert.notDeepEqual(readAppMode(search, 'mock'), entry, search)
  }
  // node --test has no build settings, so the default is mock.
  assert.deepEqual(readAppMode('?demo=workspace'), {
    kind: 'workspace',
    scenario: 'default',
  })
})

test('http mode has no repositories until the access API is connected', async () => {
  await assert.rejects(
    loadAppRepositories({ mode: 'http' }, '?demo=workspace'),
    /VITE_API_MODE=http/,
  )
})
