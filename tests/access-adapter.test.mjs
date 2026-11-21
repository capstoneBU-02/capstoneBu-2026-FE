import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResponseShapeError } from '../src/api/guards.ts'
import {
  normalizeTesterCode,
  readTesterLogin,
  toWorkspaceInfo,
} from '../src/features/access/adapter.ts'
import { fixtureData } from './fixtures/api/fetch.mjs'

test('a tester code is sent without spaces and in upper case', () => {
  assert.equal(normalizeTesterCode('  tester-2026-a1b2 \n'), 'TESTER-2026-A1B2')
  assert.equal(normalizeTesterCode('TESTER- 2026-A1B2'), 'TESTER-2026-A1B2')
  assert.equal(normalizeTesterCode('TESTER-2026-A1B2'), 'TESTER-2026-A1B2')
})

test('a login reads only the workspace id', () => {
  assert.deepEqual(readTesterLogin(fixtureData('access/tester-login.json')), {
    workspace_id: 42,
  })
})

test('a login without an integer workspace id fails at that field', () => {
  for (const data of [{ workspace_id: '42' }, { workspace_id: 4.2 }, {}]) {
    assert.throws(() => readTesterLogin(data), {
      name: 'ResponseShapeError',
      path: 'data.workspace_id',
    })
  }
  assert.throws(() => readTesterLogin(null), ResponseShapeError)
})

test('the workspace shows the sent code under a fixed name', () => {
  assert.deepEqual(toWorkspaceInfo({ workspace_id: 42 }, 'TESTER-2026-A1B2'), {
    id: '42',
    name: '내 작업',
    testerCode: 'TESTER-2026-A1B2',
  })
})
