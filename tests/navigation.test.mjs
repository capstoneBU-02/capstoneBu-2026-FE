import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readWorkspaceView,
  scopedWorkspaceView,
  workspaceUrl,
  maskTesterCode,
  WORKSPACE_SCOPE_KEY,
} from '../src/features/workspace/navigation.ts'

test('workspace navigation is allowlisted and never derives a workspace from arbitrary input', () => {
  for (const view of ['settings', 'task-not-found', 'task-inaccessible']) {
    assert.equal(readWorkspaceView(`?view=${view}`), view)
  }
  assert.equal(readWorkspaceView('?view=other-workspace&code=secret'), 'home')
  assert.equal(readWorkspaceView('?view=https://example.com'), 'home')
})

test('history entries from an old session cannot restore their view in a new session', () => {
  assert.equal(
    scopedWorkspaceView(
      { [WORKSPACE_SCOPE_KEY]: 'current' },
      '?view=settings',
      'current',
    ),
    'settings',
  )
  for (const state of [null, {}, 'current', { [WORKSPACE_SCOPE_KEY]: 'old' }]) {
    assert.equal(
      scopedWorkspaceView(state, '?view=task-inaccessible', 'current'),
      'home',
    )
  }
})

test('navigation URLs retain only known demo selectors and view; codes are display-masked', () => {
  assert.equal(
    workspaceUrl(
      '/',
      '?demo=workspace&code=secret&choice=accepted',
      'settings',
    ),
    '/?demo=workspace&view=settings',
  )
  assert.equal(
    workspaceUrl('/', '?demo=unknown&code=secret&session=old', 'home'),
    '/',
  )
  assert.equal(
    workspaceUrl('/', '?access=network&code=secret', 'settings'),
    '/?access=network&view=settings',
  )
  assert.equal(maskTesterCode('EM-7K2P-9Q4M'), 'EM-••••-9Q4M')
  assert.equal(maskTesterCode('short'), '••••')
})
