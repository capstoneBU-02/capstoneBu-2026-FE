import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockWorkspaceRepository } from '../src/features/workspace/mockRepository.ts'
import { SECTION_POLICY } from '../src/features/new-section/sectionPolicy.ts'
import { readAppMode, readDemoScenario } from '../src/app/demoConfig.ts'
import {
  clockedRepository,
  section,
  signal,
  stageStatuses,
} from './fixtures/workspace.mjs'

// 멈추기, 다시 시도 and 구간 다시 정하기 in the mock repository (#17).

const failedTab = {
  id: 'task-failed-tab',
  songId: 'song-neon-harbor',
  sectionName: '브리지',
  part: 'lead',
  partLabel: '리드 기타',
  tuningId: SECTION_POLICY.tunings[0].id,
  tuningLabel: SECTION_POLICY.tunings[0].label,
  rangeStartSeconds: 10,
  rangeEndSeconds: 30,
  processingStatus: 'failed',
  failureKind: 'transcription',
  progressPercent: null,
  hasSeparatedAudio: true,
  comparisonCount: 0,
  copyStatus: 'unreviewed',
  updatedAtLabel: '1시간 전',
}

test('a failed task reports the retries the server has left (JOB-05)', async () => {
  const repository = createMockWorkspaceRepository()
  const retryOf = async (taskId) =>
    (await repository.loadTask(taskId, signal())).retry

  assert.deepEqual(await retryOf('task-intro'), { left: 2, limit: 3 })
  // A song without guitar cannot be sent again; other states have nothing
  // to retry.
  assert.equal(await retryOf('task-chorus'), null)
  assert.equal(await retryOf('task-verse'), null)
  assert.equal(await retryOf('task-solo'), null)

  const exhausted = createMockWorkspaceRepository('default', {
    tasks: [failedTab],
    retriesUsed: { [failedTab.id]: 3 },
  })
  assert.deepEqual((await exhausted.loadTask(failedTab.id, signal())).retry, {
    left: 0,
    limit: 3,
  })
  await assert.rejects(exhausted.retryTask(failedTab.id, signal()), {
    code: 'retry-task-failed',
  })
})

test('a retry queues the task again and starts from the failed stage (JOB-04)', async () => {
  const clock = { now: 0 }
  const repository = createMockWorkspaceRepository('default', {
    tasks: [failedTab],
    now: () => clock.now,
    processingTiming: { queueMs: 100, separationMs: 400, transcriptionMs: 600 },
  })
  assert.deepEqual((await repository.loadTask(failedTab.id, signal())).retry, {
    left: 3,
    limit: 3,
  })

  const retried = await repository.retryTask(failedTab.id, signal())
  assert.equal(retried.processingStatus, 'queued')
  assert.equal(retried.failureKind, null)
  assert.equal(retried.hasSeparatedAudio, true)

  let detail = await repository.loadTask(failedTab.id, signal())
  assert.equal(detail.retry, null)
  assert.deepEqual(stageStatuses(detail), [
    'separation:done',
    'transcription:waiting',
  ])
  // A running task cannot be sent again.
  await assert.rejects(repository.retryTask(failedTab.id, signal()), {
    code: 'retry-task-failed',
  })

  clock.now = 100
  detail = await repository.loadTask(failedTab.id, signal())
  assert.equal(detail.task.processingStatus, 'processing')
  assert.equal(detail.task.hasSeparatedAudio, true)
  assert.deepEqual(stageStatuses(detail), [
    'separation:done',
    'transcription:running',
  ])
  clock.now = 700
  detail = await repository.loadTask(failedTab.id, signal())
  assert.equal(detail.task.processingStatus, 'completed')
})

test('a song without guitar and a finished task cannot be retried', async () => {
  const repository = createMockWorkspaceRepository()

  for (const taskId of ['task-chorus', 'task-verse'])
    await assert.rejects(repository.retryTask(taskId, signal()), {
      code: 'retry-task-failed',
    })
  await assert.rejects(repository.retryTask('task-unknown', signal()), {
    code: 'task-unavailable',
  })
  assert.equal(
    (await repository.loadTask('task-chorus', signal())).task.processingStatus,
    'failed',
  )
})

test('멈추기 removes the running task and frees the worker for the next', async () => {
  const { clock, repository } = clockedRepository()
  const first = await repository.createTask(section(), signal())
  const second = await repository.createTask(
    section({ sectionName: '솔로' }),
    signal(),
  )
  const third = await repository.createTask(
    section({ sectionName: '아웃트로' }),
    signal(),
  )

  // first runs from 100; third stops while it waits.
  clock.now = 50
  await repository.cancelTask(third.id, signal())
  clock.now = 200
  await repository.cancelTask(first.id, signal())

  await assert.rejects(repository.loadTask(first.id, signal()), {
    code: 'task-unavailable',
  })
  const listed = (await repository.loadWorkspace(signal())).tasks.map(
    (task) => task.id,
  )
  assert.ok(!listed.includes(first.id))
  assert.ok(!listed.includes(third.id))
  assert.ok(listed.includes(second.id))
  // The song stays for a new section.
  assert.ok(
    (await repository.loadWorkspace(signal())).songs.some(
      (song) => song.id === 'song-neon-harbor',
    ),
  )
  const next = await repository.loadTask(second.id, signal())
  assert.equal(next.task.processingStatus, 'processing')
  assert.equal(next.queueAhead, null)
})

test('멈추기 refuses a task that is no longer running', async () => {
  const repository = createMockWorkspaceRepository()

  for (const taskId of ['task-verse', 'task-intro'])
    await assert.rejects(repository.cancelTask(taskId, signal()), {
      code: 'cancel-task-failed',
    })
  await assert.rejects(repository.cancelTask('task-unknown', signal()), {
    code: 'task-unavailable',
  })
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, 4)
  // The fixture's running task can be stopped.
  await repository.cancelTask('task-solo', signal())
  assert.equal((await repository.loadWorkspace(signal())).tasks.length, 3)
})

test('멈추기 and 다시 시도 honour cancellation and expiry', async () => {
  const repository = createMockWorkspaceRepository()
  const controller = new AbortController()
  const stopping = repository.cancelTask('task-solo', controller.signal)
  const retrying = repository.retryTask('task-intro', controller.signal)
  controller.abort()

  await assert.rejects(stopping, { name: 'AbortError' })
  await assert.rejects(retrying, { name: 'AbortError' })
  assert.equal(
    (await repository.loadTask('task-solo', signal())).task.processingStatus,
    'processing',
  )
  assert.deepEqual((await repository.loadTask('task-intro', signal())).retry, {
    left: 2,
    limit: 3,
  })

  const expired = createMockWorkspaceRepository('expired')
  await assert.rejects(expired.cancelTask('task-solo', signal()), {
    code: 'expired',
  })
  await assert.rejects(expired.retryTask('task-intro', signal()), {
    code: 'expired',
  })
})

// 코러스 2 found no guitar between 03:10 and 03:31 (SEPARATION_NO_GUITAR).
const movedChorus = (overrides = {}) => ({
  sectionName: '코러스 2',
  part: 'rhythm',
  tuningId: 'e-standard',
  rangeStartSeconds: 150,
  rangeEndSeconds: 170,
  ...overrides,
})

test('구간 다시 정하기 moves a section without guitar and starts from separation', async () => {
  const { clock, repository } = clockedRepository()
  const moved = await repository.reviseTask(
    'task-chorus',
    movedChorus(),
    signal(),
  )
  assert.equal(moved.id, 'task-chorus')
  assert.equal(moved.processingStatus, 'queued')
  assert.equal(moved.failureKind, null)
  assert.equal(moved.rangeStartSeconds, 150)
  assert.equal(moved.rangeEndSeconds, 170)

  let detail = await repository.loadTask('task-chorus', signal())
  // It had no tab, so nothing is kept as a previous result (D10).
  assert.deepEqual(detail.previousResults, [])
  assert.equal(detail.retry, null)
  assert.deepEqual(stageStatuses(detail), [
    'separation:waiting',
    'transcription:waiting',
  ])
  clock.now = 100
  detail = await repository.loadTask('task-chorus', signal())
  assert.deepEqual(stageStatuses(detail), [
    'separation:running',
    'transcription:waiting',
  ])
})

test('the mock refuses a section move a server would refuse', async () => {
  const repository = createMockWorkspaceRepository()
  // The same range finds no guitar again, whatever else changes.
  await assert.rejects(
    repository.reviseTask(
      'task-chorus',
      movedChorus({
        rangeStartSeconds: 190,
        rangeEndSeconds: 211,
        tuningId: 'drop-d',
      }),
      signal(),
    ),
    { code: 'revise-task-failed' },
  )
  // A tab failure is sent again instead of moved.
  await assert.rejects(
    repository.reviseTask(
      'task-intro',
      movedChorus({ sectionName: '인트로', rangeStartSeconds: 2 }),
      signal(),
    ),
    { code: 'revise-task-failed' },
  )
  const chorus = await repository.loadTask('task-chorus', signal())
  assert.equal(chorus.task.failureKind, 'no-guitar')
  assert.equal(chorus.task.rangeStartSeconds, 190)
})

test('?demo=task-states previews every state #17 shows', async () => {
  assert.equal(readDemoScenario('?demo=task-states'), 'task-states')
  assert.deepEqual(readAppMode('?demo=task-states'), {
    kind: 'workspace',
    scenario: 'task-states',
  })
  const clock = { now: 0 }
  const repository = createMockWorkspaceRepository('task-states', {
    now: () => clock.now,
  })
  const state = async (taskId) => {
    const detail = await repository.loadTask(taskId, signal())
    return {
      status: detail.task.processingStatus,
      stages: stageStatuses(detail),
      retry: detail.retry,
    }
  }
  const expected = {
    'task-verse': ['completed', 'done', 'done', null],
    'task-solo': ['processing', 'done', 'running', null],
    'task-bridge': ['queued', 'waiting', 'waiting', null],
    'task-intro': ['failed', 'skipped', 'failed', { left: 2, limit: 3 }],
    'task-outro': ['failed', 'skipped', 'failed', { left: 0, limit: 3 }],
    'task-verse-2': ['failed', 'failed', 'waiting', { left: 1, limit: 3 }],
    'task-chorus': ['failed', 'failed', 'waiting', null],
  }
  const { tasks } = await repository.loadWorkspace(signal())
  assert.deepEqual(
    tasks.map((task) => task.id).sort(),
    Object.keys(expected).sort(),
  )
  for (const [
    taskId,
    [status, separation, transcription, retry],
  ] of Object.entries(expected))
    assert.deepEqual(
      await state(taskId),
      {
        status,
        stages: [`separation:${separation}`, `transcription:${transcription}`],
        retry,
      },
      taskId,
    )
  assert.equal(
    (await repository.loadTask('task-chorus', signal())).task.failureKind,
    'no-guitar',
  )
  // Fixture tasks hold their state for the preview.
  clock.now = 60_000
  assert.equal((await state('task-bridge')).status, 'queued')
})
