import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'
import { createMockWorkspaceRepository } from '../src/features/workspace/mockRepository.ts'
import {
  clockedRepository,
  revision,
  section,
  signal,
} from './fixtures/workspace.mjs'

// The mock processing pace in clockedRepository finishes a task by 1100 ms.
const FINISHED_AT = 1100

function scoreOf(input) {
  const result = parseTabScore(input)
  assert.equal(result.ok, true, result.error)
  return result.score
}

async function finishedTask(overrides) {
  const { clock, repository } = clockedRepository()
  const task = await repository.createTask(section(overrides), signal())
  clock.now = FINISHED_AT
  return { clock, repository, task }
}

test('a finished task loads a demo tab that covers its section', async () => {
  const repository = createMockWorkspaceRepository()
  const { task } = await repository.loadTask('task-verse', signal())
  const length = task.rangeEndSeconds - task.rangeStartSeconds
  const score = scoreOf(await repository.loadTab(task.id, signal()))

  assert.deepEqual(score.tuning, ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'])
  assert.equal(score.bars[0].startSeconds, 0)
  assert.deepEqual(
    score.bars.map((bar) => bar.number),
    score.bars.map((_, index) => index + 1),
  )
  assert.ok(score.bars.at(-1).startSeconds < length)
  assert.ok(score.endSeconds >= length)
  assert.ok(score.endSeconds - score.bars.at(-1).startSeconds <= 2)
})

test('each load returns a fresh copy of the tab', async () => {
  const repository = createMockWorkspaceRepository()
  const first = await repository.loadTab('task-verse', signal())
  const second = await repository.loadTab('task-verse', signal())

  assert.notEqual(first, second)
  assert.deepEqual(first, second)
})

test('a tab follows the tuning of its task', async () => {
  for (const [tuningId, lowest] of [
    ['drop-d', 'D2'],
    ['e-flat', 'Eb2'],
  ]) {
    const { repository, task } = await finishedTask({ tuningId })
    const score = scoreOf(await repository.loadTab(task.id, signal()))
    assert.equal(score.tuning.at(-1), lowest, tuningId)
  }
})

test('a task without a finished tab has none to load', async () => {
  const repository = createMockWorkspaceRepository()

  for (const taskId of ['task-solo', 'task-intro', 'task-chorus'])
    await assert.rejects(repository.loadTab(taskId, signal()), {
      code: 'tab-unavailable',
    })
  await assert.rejects(repository.loadTab('task-missing', signal()), {
    code: 'task-unavailable',
  })
})

test('a section change takes the tab away until the new one is made', async () => {
  const { clock, repository, task } = await finishedTask()
  await repository.loadTab(task.id, signal())

  await repository.reviseTask(
    task.id,
    revision({ rangeEndSeconds: 50 }),
    signal(),
  )
  await assert.rejects(repository.loadTab(task.id, signal()), {
    code: 'tab-unavailable',
  })

  clock.now = FINISHED_AT * 3
  const score = scoreOf(await repository.loadTab(task.id, signal()))
  assert.ok(score.endSeconds >= 50 - 42.1)
  assert.ok(score.endSeconds < 50 - 42.1 + 2)
})

test('loading a tab honours cancellation and expiry', async () => {
  const controller = new AbortController()
  const loading = createMockWorkspaceRepository().loadTab(
    'task-verse',
    controller.signal,
  )
  controller.abort()

  await assert.rejects(loading, { name: 'AbortError' })
  await assert.rejects(
    createMockWorkspaceRepository('expired').loadTab('task-verse', signal()),
    { code: 'expired' },
  )
})

test('the copy status is saved apart from processing (COPY-04)', async () => {
  const repository = createMockWorkspaceRepository()

  const cleared = await repository.saveCopyStatus('task-verse', false, signal())
  assert.equal(cleared.copyStatus, 'unreviewed')
  assert.equal(cleared.processingStatus, 'completed')
  assert.equal(cleared.comparisonCount, 2)

  const listed = (await repository.loadWorkspace(signal())).tasks.find(
    (task) => task.id === 'task-verse',
  )
  assert.deepEqual(listed, cleared)
  assert.deepEqual((await repository.loadTask('task-verse', signal())).task, {
    ...cleared,
  })

  const marked = await repository.saveCopyStatus('task-verse', true, signal())
  assert.equal(marked.copyStatus, 'confirmed')
  assert.equal(marked.processingStatus, 'completed')
})

test('a finished tab does not mark the copy done', async () => {
  const { repository, task } = await finishedTask()
  const { task: finished } = await repository.loadTask(task.id, signal())

  assert.equal(finished.processingStatus, 'completed')
  assert.equal(finished.copyStatus, 'unreviewed')
})

test('only a finished task takes a copy status', async () => {
  const repository = createMockWorkspaceRepository()

  for (const taskId of ['task-solo', 'task-intro', 'task-chorus'])
    await assert.rejects(repository.saveCopyStatus(taskId, true, signal()), {
      code: 'copy-status-failed',
    })
  await assert.rejects(
    repository.saveCopyStatus('task-missing', true, signal()),
    { code: 'task-unavailable' },
  )
  const intro = (await repository.loadWorkspace(signal())).tasks.find(
    (task) => task.id === 'task-intro',
  )
  assert.equal(intro.copyStatus, 'needs-review')
})

test('a section change leaves the copy status with the kept result', async () => {
  const { repository, task } = await finishedTask()
  await repository.saveCopyStatus(task.id, true, signal())

  const revised = await repository.reviseTask(
    task.id,
    revision({ rangeEndSeconds: 50 }),
    signal(),
  )
  assert.equal(revised.copyStatus, 'unreviewed')
  await assert.rejects(repository.saveCopyStatus(task.id, true, signal()), {
    code: 'copy-status-failed',
  })
  const detail = await repository.loadTask(task.id, signal())
  assert.equal(detail.previousResults[0].copyStatus, 'confirmed')
})

test('saving a copy status honours cancellation and expiry', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const saving = repository.saveCopyStatus(
    'task-verse',
    false,
    controller.signal,
  )
  controller.abort()

  await assert.rejects(saving, { name: 'AbortError' })
  const { task } = await repository.loadTask('task-verse', signal())
  assert.equal(task.copyStatus, 'confirmed')
  await assert.rejects(
    createMockWorkspaceRepository('expired').saveCopyStatus(
      'task-verse',
      false,
      signal(),
    ),
    { code: 'expired' },
  )
})
