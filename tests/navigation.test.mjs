import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalWorkspaceView,
  isSongId,
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
const songNotFound = { name: 'song-not-found' }

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

test('the new-section view carries only an allowlisted song id', () => {
  assert.deepEqual(readWorkspaceView('?view=new-section&song=song-upload-1'), {
    name: 'new-section',
    songId: 'song-upload-1',
  })
  assert.deepEqual(readWorkspaceView('?view=song-not-found'), songNotFound)
  for (const search of [
    '?view=new-section',
    '?view=new-section&song=',
    '?view=new-section&song=../task',
    '?view=new-section&song=Song_Upload',
    '?view=new-section&task=task-verse',
  ]) {
    assert.deepEqual(readWorkspaceView(search), songNotFound, search)
  }
  assert.equal(isSongId('song-neon-harbor'), true)
  assert.equal(isSongId('Song'), false)

  const section = { name: 'new-section', songId: 'song-neon-harbor' }
  assert.equal(canonicalWorkspaceView(section), section)
  assert.deepEqual(
    canonicalWorkspaceView({ name: 'new-section', songId: 'Song_Upload' }),
    songNotFound,
  )
  assert.notEqual(
    workspaceViewKey(section),
    workspaceViewKey({ name: 'new-section', songId: 'song-paper-moon' }),
  )
  assert.notEqual(
    workspaceViewKey({ name: 'task', taskId: 'same-id' }),
    workspaceViewKey({ name: 'new-section', songId: 'same-id' }),
  )
  assert.equal(
    workspaceUrl('/', '?demo=workspace&task=old&view=task', section),
    '/?demo=workspace&view=new-section&song=song-neon-harbor',
  )
  assert.equal(
    workspaceUrl('/', '', { name: 'new-section', songId: '../private' }),
    '/?view=song-not-found',
  )
})

test('the edit-section view carries only an allowlisted task id', () => {
  const edit = { name: 'edit-section', taskId: 'task-verse' }
  assert.deepEqual(
    readWorkspaceView('?view=edit-section&task=task-verse'),
    edit,
  )
  for (const search of [
    '?view=edit-section',
    '?view=edit-section&task=',
    '?view=edit-section&task=../settings',
    '?view=edit-section&task=Task_Verse',
    '?view=edit-section&song=song-neon-harbor',
  ]) {
    assert.deepEqual(readWorkspaceView(search), notFound, search)
  }

  assert.equal(canonicalWorkspaceView(edit), edit)
  assert.deepEqual(
    canonicalWorkspaceView({ name: 'edit-section', taskId: 'Task_Verse' }),
    notFound,
  )
  // Opening the editor is a different entry from viewing the same task.
  assert.notEqual(
    workspaceViewKey(edit),
    workspaceViewKey({ name: 'task', taskId: 'task-verse' }),
  )
  assert.notEqual(
    workspaceViewKey(edit),
    workspaceViewKey({ name: 'edit-section', taskId: 'task-solo' }),
  )
  assert.equal(
    workspaceUrl('/', '?demo=workspace&song=old&view=task', edit),
    '/?demo=workspace&view=edit-section&task=task-verse',
  )
  assert.equal(
    workspaceUrl('/', '', { name: 'edit-section', taskId: '../private' }),
    '/?view=task-not-found',
  )
})
