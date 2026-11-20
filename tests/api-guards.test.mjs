import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRecord,
  readArray,
  readBoolean,
  readInteger,
  readNullable,
  readNumber,
  readObject,
  readOneOf,
  readString,
  ResponseShapeError,
} from '../src/api/guards.ts'

function shapeError(path) {
  return (error) =>
    error instanceof ResponseShapeError &&
    error.name === 'ResponseShapeError' &&
    error.path === path
}

test('isRecord accepts plain objects only', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord({ a: 1 }), true)
  for (const value of [null, undefined, [], 'x', 1, true]) {
    assert.equal(isRecord(value), false, String(value))
  }
})

test('scalar readers return the value or name the path that broke', () => {
  assert.equal(readString('a', 'data.name'), 'a')
  assert.equal(readString('', 'data.name'), '')
  assert.throws(() => readString(1, 'data.name'), shapeError('data.name'))
  assert.throws(() => readString(null, 'data.name'), shapeError('data.name'))

  assert.equal(readNumber(1.5, 'data.n'), 1.5)
  for (const value of [Number.NaN, Infinity, '1', null]) {
    assert.throws(() => readNumber(value, 'data.n'), shapeError('data.n'))
  }

  assert.equal(readInteger(3, 'data.ms'), 3)
  assert.throws(() => readInteger(3.2, 'data.ms'), shapeError('data.ms'))

  assert.equal(readBoolean(false, 'data.ok'), false)
  assert.throws(() => readBoolean(0, 'data.ok'), shapeError('data.ok'))

  assert.equal(readOneOf('done', ['pending', 'done'], 'data.s'), 'done')
  assert.throws(
    () => readOneOf('lost', ['pending', 'done'], 'data.s'),
    (error) =>
      shapeError('data.s')(error) && /pending, done/.test(error.message),
  )
})

test('missing and null both read as null where the server may omit a value', () => {
  assert.equal(readNullable(undefined, 'data.x', readString), null)
  assert.equal(readNullable(null, 'data.x', readString), null)
  assert.equal(readNullable('a', 'data.x', readString), 'a')
  assert.throws(
    () => readNullable(1, 'data.x', readString),
    shapeError('data.x'),
  )
})

test('arrays check every item and report its index', () => {
  assert.deepEqual(readArray([1, 2], 'data.ids', readInteger), [1, 2])
  assert.deepEqual(readArray([], 'data.ids', readInteger), [])
  assert.throws(
    () => readArray([1, 'x'], 'data.ids', readInteger),
    shapeError('data.ids[1]'),
  )
  assert.throws(
    () => readArray({ 0: 1 }, 'data.ids', readInteger),
    shapeError('data.ids'),
  )
})

test('an object reader walks nested fields with full paths', () => {
  const body = readObject({
    track_id: 'trk-1',
    duration_ms: 182000,
    is_separated_stem: false,
    status: 'queued',
    expires_at: null,
    segment: { start_ms: 0, label: undefined },
    tags: ['a', 'b'],
    extra: { kept: true },
  })
  assert.equal(body.path, 'data')
  assert.equal(body.string('track_id'), 'trk-1')
  assert.equal(body.integer('duration_ms'), 182000)
  assert.equal(body.number('duration_ms'), 182000)
  assert.equal(body.boolean('is_separated_stem'), false)
  assert.equal(body.oneOf('status', ['queued', 'running']), 'queued')
  assert.equal(body.nullable('expires_at', readString), null)
  assert.equal(body.nullable('missing', readString), null)
  assert.deepEqual(body.array('tags', readString), ['a', 'b'])
  assert.deepEqual(body.raw('extra'), { kept: true })

  const segment = body.object('segment')
  assert.equal(segment.path, 'data.segment')
  assert.equal(segment.integer('start_ms'), 0)
  assert.equal(segment.nullable('label', readString), null)
  assert.throws(() => segment.string('label'), shapeError('data.segment.label'))

  assert.equal(body.nullableObject('expires_at'), null)
  assert.equal(body.nullableObject('segment')?.path, 'data.segment')
  assert.throws(() => body.object('tags'), shapeError('data.tags'))
  assert.throws(() => body.string('nope'), shapeError('data.nope'))
})

test('array items are objects read with their own paths', () => {
  assert.deepEqual(
    readObject({ items: [{ id: 'a' }, { id: 'b' }] }).array(
      'items',
      (item, path) => readObject(item, path).string('id'),
    ),
    ['a', 'b'],
  )
  assert.throws(
    () =>
      readObject({ items: [{ id: 'a' }, { id: 2 }] }).array(
        'items',
        (item, path) => readObject(item, path).string('id'),
      ),
    shapeError('data.items[1].id'),
  )
})

test('a non-object root names the root path', () => {
  assert.throws(() => readObject(null), shapeError('data'))
  assert.throws(() => readObject([], 'data.list'), shapeError('data.list'))
})
