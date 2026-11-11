import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeRefreshedList,
  upserted,
} from '../src/features/workspace/listMerge.ts'

// How a refreshed list meets the one on screen (#28).

const task = (id, processingStatus = 'completed') => ({
  id,
  songId: 'song-a',
  sectionName: id,
  processingStatus,
  progressPercent: null,
})
const song = (id, name = id) => ({ id, name })
const workspace = { id: 'workspace', name: '작업 공간', testerCode: 'CODE' }

function list({ tasks = [], songs = [song('song-a')], consentChoice } = {}) {
  return {
    workspace: { ...workspace },
    songs,
    tasks,
    consentChoice: consentChoice ?? 'accepted',
  }
}

const noChanges = { tasks: new Set(), songs: new Set() }

test('the loaded list replaces changed and removed tasks', () => {
  const shown = list({ tasks: [task('a'), task('b', 'queued'), task('c')] })
  const loaded = list({
    tasks: [task('a'), task('b', 'processing'), task('d', 'queued')],
  })

  const merged = mergeRefreshedList(shown, loaded, noChanges)

  assert.deepEqual(
    merged.tasks.map((item) => `${item.id}:${item.processingStatus}`),
    ['a:completed', 'b:processing', 'd:queued'],
  )
  // An unchanged task keeps its object, so its row does not re-render.
  assert.equal(merged.tasks[0], shown.tasks[0])
})

test('a list with nothing new comes back as the shown one', () => {
  const shown = list({ tasks: [task('a'), task('b', 'queued')] })
  const loaded = list({ tasks: [task('a'), task('b', 'queued')] })

  assert.equal(mergeRefreshedList(shown, loaded, noChanges), shown)
})

test('a task changed here while the list was loading keeps this copy', () => {
  const shown = list({ tasks: [task('a', 'queued'), task('b')] })
  const loaded = list({ tasks: [task('a', 'completed'), task('b')] })

  const merged = mergeRefreshedList(shown, loaded, {
    tasks: new Set(['a']),
    songs: new Set(),
  })

  assert.equal(merged, shown)
})

test('a task stopped here stays gone and one made here stays', () => {
  const shown = list({ tasks: [task('b'), task('new', 'queued')] })
  const loaded = list({ tasks: [task('a', 'processing'), task('b')] })

  const merged = mergeRefreshedList(shown, loaded, {
    tasks: new Set(['a', 'new']),
    songs: new Set(),
  })

  assert.deepEqual(
    merged.tasks.map((item) => item.id),
    ['b', 'new'],
  )
})

test('songs follow the same rules', () => {
  const shown = list({ songs: [song('song-a'), song('song-mine')] })
  const loaded = list({
    songs: [song('song-a', '새 이름'), song('song-other')],
  })

  const merged = mergeRefreshedList(shown, loaded, {
    tasks: new Set(),
    songs: new Set(['song-mine']),
  })

  assert.deepEqual(
    merged.songs.map((item) => `${item.id}:${item.name}`),
    ['song-a:새 이름', 'song-other:song-other', 'song-mine:song-mine'],
  )
})

test('consent stays as shown and the workspace takes the loaded name', () => {
  const shown = list({ consentChoice: 'declined' })
  const loaded = {
    ...list({ consentChoice: 'undecided' }),
    workspace: { ...workspace, name: '바뀐 이름' },
  }

  const merged = mergeRefreshedList(shown, loaded, noChanges)

  assert.equal(merged.consentChoice, 'declined')
  assert.equal(merged.workspace.name, '바뀐 이름')
})

test('upserted replaces an item a refresh brought in first', () => {
  const items = [task('a'), task('b', 'queued')]

  assert.deepEqual(
    upserted(items, task('b', 'processing')).map(
      (item) => `${item.id}:${item.processingStatus}`,
    ),
    ['a:completed', 'b:processing'],
  )
  assert.deepEqual(
    upserted(items, task('c')).map((item) => item.id),
    ['a', 'b', 'c'],
  )
})
