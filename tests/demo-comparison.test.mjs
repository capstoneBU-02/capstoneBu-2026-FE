import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDemoComparisonRepository,
  demoComparisonSection,
} from '../src/features/comparison/demoComparison.ts'

const task = {
  id: 'task-1',
  songId: 'song-1',
  rangeStartSeconds: 10,
  rangeEndSeconds: 30,
  hasSeparatedAudio: true,
}
const originalSong = { id: 'song-1', inputKind: 'original' }
const guitarSong = { id: 'song-1', inputKind: 'separated-guitar' }

function audioSource() {
  const calls = []
  return {
    calls,
    loadSongAudio(songId) {
      calls.push(['song', songId])
      return Promise.resolve(new Blob(['song']))
    },
    loadSeparatedAudio(taskId) {
      calls.push(['separated', taskId])
      return Promise.resolve(new Blob(['separated']))
    },
  }
}

const instant = {
  queueMs: 0,
  stageQueueMs: 0,
  stageMs: { align: 0, transcription: 0, compare: 0 },
}

async function finishedComparison(song) {
  const audio = audioSource()
  const repository = createDemoComparisonRepository({
    audio,
    findTask: (taskId) => (taskId === task.id ? { task, song } : undefined),
    timing: instant,
    requestDelayMs: 0,
  })
  const { signal } = new AbortController()
  const performance = await repository.savePerformance(
    {
      taskId: task.id,
      source: 'upload',
      audio: new Blob(['take']),
      durationSeconds: 20,
    },
    signal,
  )
  const comparison = await repository.requestComparison(performance.id, signal)
  return { audio, repository, signal, comparison }
}

test('a section takes its range and input from the task and song', () => {
  assert.deepEqual(demoComparisonSection({ task, song: originalSong }), {
    rangeStartSeconds: 10,
    rangeEndSeconds: 30,
    hasSeparatedAudio: true,
    inputKind: 'original',
  })
})

test('an original song waits for its separated guitar', () => {
  const section = demoComparisonSection({
    task: { ...task, hasSeparatedAudio: false },
    song: originalSong,
  })
  assert.equal(section.hasSeparatedAudio, false)
})

test('an uploaded guitar is ready without separation', () => {
  const section = demoComparisonSection({
    task: { ...task, hasSeparatedAudio: false },
    song: guitarSong,
  })
  assert.equal(section.hasSeparatedAudio, true)
})

test('the original baseline plays the uploaded song', async () => {
  const { audio, repository, signal, comparison } =
    await finishedComparison(originalSong)
  await repository.loadTrackAudio(comparison.id, 'original', signal)
  assert.deepEqual(audio.calls, [['song', 'song-1']])
})

test('the separated guitar comes from the task', async () => {
  const { audio, repository, signal, comparison } =
    await finishedComparison(originalSong)
  await repository.loadTrackAudio(comparison.id, 'stem', signal)
  assert.deepEqual(audio.calls, [['separated', 'task-1']])
})

test('an uploaded guitar is its own baseline and starts at the section', async () => {
  const { audio, repository, signal, comparison } =
    await finishedComparison(guitarSong)
  await repository.loadTrackAudio(comparison.id, 'stem', signal)
  assert.deepEqual(audio.calls, [['song', 'song-1']])
  const { tracks } = await repository.loadPlayback(comparison.id, signal)
  assert.deepEqual(
    tracks.map(({ kind, offsetSeconds }) => [kind, offsetSeconds]),
    [
      ['stem', 10],
      ['performance', 0],
    ],
  )
})

test('a task that is gone cannot save a take', async () => {
  const repository = createDemoComparisonRepository({
    audio: audioSource(),
    findTask: () => undefined,
    timing: instant,
    requestDelayMs: 0,
  })
  await assert.rejects(
    repository.savePerformance(
      {
        taskId: 'gone',
        source: 'upload',
        audio: new Blob(['take']),
        durationSeconds: 20,
      },
      new AbortController().signal,
    ),
    { code: 'task-unavailable' },
  )
})
