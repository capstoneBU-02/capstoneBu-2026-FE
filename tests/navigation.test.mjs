import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalWorkspaceView,
  isTaskId,
  readWorkspaceView,
  scopedWorkspaceView,
  workspaceUrl,
  workspaceViewKey,
  maskTesterCode,
  WORKSPACE_SCOPE_KEY,
} from '../src/features/workspace/navigation.ts'

const home = { name: 'home' }
const settings = { name: 'settings' }
const notFound = { name: 'task-not-found' }

test('workspace navigation is allowlisted and never derives a workspace from arbitrary input', () => {
  for (const name of ['settings', 'task-not-found', 'task-inaccessible']) {
    assert.deepEqual(readWorkspaceView(`?view=${name}`), { name })
  }
  assert.deepEqual(readWorkspaceView('?view=other-workspace&code=secret'), home)
  assert.deepEqual(readWorkspaceView('?view=https://example.com'), home)
  assert.deepEqual(readWorkspaceView(''), home)
})

test('a task view carries only an allowlisted task id', () => {
  assert.deepEqual(readWorkspaceView('?view=task&task=task-verse'), {
    name: 'task',
    taskId: 'task-verse',
  })
  // The id selects the task only together with the task view.
  assert.deepEqual(readWorkspaceView('?task=task-verse'), home)
  for (const search of [
    '?view=task',
    '?view=task&task=',
    '?view=task&task=../settings',
    '?view=task&task=task%20verse',
    '?view=task&task=%3Cscript%3E',
    '?view=task&task=TASK-VERSE',
    `?view=task&task=${'a'.repeat(65)}`,
    '?view=task&task=-leading-dash',
  ]) {
    assert.deepEqual(readWorkspaceView(search), notFound, search)
  }
  assert.equal(isTaskId('3f2b8c1e-9a4d-4e21-b7a0-5c6d7e8f9a0b'), true)
  assert.equal(isTaskId('a'.repeat(64)), true)
  assert.equal(isTaskId(42), false)
})

test('a view pushed by the app uses the same id rule as a view read from the URL', () => {
  const verse = { name: 'task', taskId: 'task-verse' }
  assert.equal(canonicalWorkspaceView(verse), verse)
  assert.equal(canonicalWorkspaceView(settings), settings)
  for (const taskId of ['Task_Verse', '', 'a'.repeat(65), '../task']) {
    assert.deepEqual(
      canonicalWorkspaceView({ name: 'task', taskId }),
      notFound,
      taskId,
    )
  }
})

test('view keys distinguish tasks so navigation can skip only identical views', () => {
  assert.equal(workspaceViewKey(home), 'home')
  assert.equal(workspaceViewKey(settings), 'settings')
  assert.notEqual(
    workspaceViewKey({ name: 'task', taskId: 'task-verse' }),
    workspaceViewKey({ name: 'task', taskId: 'task-solo' }),
  )
})

test('history entries from an old session cannot restore their view in a new session', () => {
  assert.deepEqual(
    scopedWorkspaceView(
      { [WORKSPACE_SCOPE_KEY]: 'current' },
      '?view=settings',
      'current',
    ),
    settings,
  )
  assert.deepEqual(
    scopedWorkspaceView(
      { [WORKSPACE_SCOPE_KEY]: 'current' },
      '?view=task&task=task-solo',
      'current',
    ),
    { name: 'task', taskId: 'task-solo' },
  )
  for (const state of [null, {}, 'current', { [WORKSPACE_SCOPE_KEY]: 'old' }]) {
    assert.deepEqual(
      scopedWorkspaceView(state, '?view=task&task=task-solo', 'current'),
      home,
    )
    assert.deepEqual(
      scopedWorkspaceView(state, '?view=task-inaccessible', 'current'),
      home,
    )
  }
})

test('navigation URLs retain only known demo selectors and view; codes are display-masked', () => {
  assert.equal(
    workspaceUrl('/', '?demo=workspace&code=secret&choice=accepted', settings),
    '/?demo=workspace&view=settings',
  )
  assert.equal(
    workspaceUrl('/', '?demo=unknown&code=secret&session=old', home),
    '/',
  )
  assert.equal(
    workspaceUrl('/', '?access=network&code=secret', settings),
    '/?access=network&view=settings',
  )
  assert.equal(maskTesterCode('EM-7K2P-9Q4M'), 'EM-••••-9Q4M')
  assert.equal(maskTesterCode('short'), '••••')
})

test('task URLs serialize the id after the view and never echo an invalid id', () => {
  assert.equal(
    workspaceUrl('/', '?demo=workspace&task=old-task&view=settings', {
      name: 'task',
      taskId: 'task-verse',
    }),
    '/?demo=workspace&view=task&task=task-verse',
  )
  assert.equal(
    workspaceUrl('/', '?demo=workspace&task=old-task', home),
    '/?demo=workspace',
  )
  assert.equal(
    workspaceUrl('/', '', { name: 'task', taskId: '../private' }),
    '/?view=task-not-found',
  )
  assert.equal(
    workspaceUrl('/', '?view=task&task=someone-elses-task', notFound),
    '/?view=task-not-found',
  )
})

test('URL normalization preserves allowed selectors when URLSearchParams.size is unavailable', () => {
  const size = Object.getOwnPropertyDescriptor(
    URLSearchParams.prototype,
    'size',
  )
  delete URLSearchParams.prototype.size
  try {
    assert.equal(
      workspaceUrl('/', '?demo=workspace&code=secret&session=old', settings),
      '/?demo=workspace&view=settings',
    )
    assert.equal(
      workspaceUrl('/', '?access=network&code=secret&view=unknown', home),
      '/?access=network',
    )
    assert.equal(
      workspaceUrl('/', '?demo=unknown&access=unknown&code=secret', home),
      '/',
    )
    assert.equal(workspaceUrl('/', '', settings), '/?view=settings')
    assert.equal(workspaceUrl('/', '', home), '/')
  } finally {
    if (size) Object.defineProperty(URLSearchParams.prototype, 'size', size)
  }
})
