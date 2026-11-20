import { createDemoComparisonRepository } from '../../../src/features/comparison/demoComparison.ts'
import type {
  ComparisonOutcome,
  ComparisonTiming,
} from '../../../src/features/comparison/mockComparisonRun.ts'
import type { ComparisonRepository } from '../../../src/features/comparison/repository.ts'
import { createDemoSongAudio } from '../../../src/features/workspace/demoSongAudio.ts'
import { separatedAudio, songAudio } from './media.ts'
import { taskDetail } from './server.ts'

// comparison=1 turns on the 비교 view; other tests keep the task screen as it
// was without one.
//   comparison-outcome=<name>  how every take ends, from OUTCOMES below
//   comparison-seed=saved      opens with one take that was never compared
//   comparison-seed=compared   opens with one take already being compared
//   comparison-seed-count=<n>  the seed saves that many takes instead, each
//                              one compared under comparison-seed=compared
//   comparison-run=instant     every comparison has ended by the time it is
//                              first read
//   comparison-partial=1       the baseline sound cannot be played
//   comparison-take-seconds=<n> how long the seeded take and its sound last
//   comparison-take-audio=fails-once  the take's sound fails to load once
//   comparison-take-audio=fails-then-slow  and takes a while to load again
//   comparison-save=hangs      saving a take never finishes
//   comparison-seed-range=<start>,<end>  the seeded take was played on that
//                              range, so it opens as a take from an earlier
//                              section; its sound lasts as long as that range
const query = new URLSearchParams(window.location.search)
const takeSecondsAsked = query.get('comparison-take-seconds')
const takeAudioAsked = query.get('comparison-take-audio')
const saveHangs = query.get('comparison-save') === 'hangs'
const seedRange = query.get('comparison-seed-range')?.split(',').map(Number)
const seedCount = Number(query.get('comparison-seed-count') ?? 1)
const SLOW_RELOAD_MS = 1_500
const FAST_TIMING: ComparisonTiming = {
  queueMs: 20,
  stageQueueMs: 20,
  stageMs: { align: 40, transcription: 40, compare: 40 },
}
const INSTANT_TIMING: ComparisonTiming = {
  queueMs: 0,
  stageQueueMs: 0,
  stageMs: { align: 0, transcription: 0, compare: 0 },
}
let takeAudioFails =
  takeAudioAsked === 'fails-once' || takeAudioAsked === 'fails-then-slow'
let takeAudioFailed = false
// The task keeps the seeded range only while the seeded take is saved.
let seeding = false

type Ranged = { rangeStartSeconds: number; rangeEndSeconds: number }

function seededRange<T extends Ranged>(task: T): T {
  if (seedRange === undefined) return task
  const [rangeStartSeconds, rangeEndSeconds] = seedRange
  return { ...task, rangeStartSeconds, rangeEndSeconds }
}

function takeSeconds(sectionSeconds: number) {
  return takeSecondsAsked === null ? sectionSeconds : Number(takeSecondsAsked)
}

function openTaskSeconds() {
  const task = taskDetail(query.get('task') ?? '')?.task
  if (!task) return 1
  const { rangeStartSeconds, rangeEndSeconds } = seededRange(task)
  return rangeEndSeconds - rangeStartSeconds
}

const RETRYABLE: ComparisonOutcome = {
  kind: 'failed',
  stage: 'compare',
  code: 'COMPARISON_FAILED',
  retryable: true,
}

const OUTCOMES: Readonly<Record<string, readonly ComparisonOutcome[]>> = {
  'not-comparable': [
    { kind: 'not-comparable', stage: 'align', reason: 'RERECORD_TOO_SHORT' },
  ],
  failed: [RETRYABLE],
  'failed-then-success': [RETRYABLE, { kind: 'success' }],
  'failed-final': [
    {
      kind: 'failed',
      stage: 'align',
      code: 'PERFORMANCE_INVALID_AUDIO',
      retryable: false,
    },
  ],
}

// Takes added in a test hold bytes no browser decodes, so every take sounds
// like the same synthesized line.
function withTakeSound(repository: ComparisonRepository): ComparisonRepository {
  return {
    ...repository,
    savePerformance: saveHangs
      ? () => new Promise(() => {})
      : repository.savePerformance,
    async loadTrackAudio(comparisonId, kind, signal) {
      if (kind !== 'performance')
        return repository.loadTrackAudio(comparisonId, kind, signal)
      if (takeAudioFails) {
        takeAudioFails = false
        takeAudioFailed = true
        return new Blob(['not audio'], { type: 'audio/wav' })
      }
      if (takeAudioFailed && takeAudioAsked === 'fails-then-slow')
        await new Promise((resolve) => setTimeout(resolve, SLOW_RELOAD_MS))
      return createDemoSongAudio(
        'harness-take',
        takeSeconds(openTaskSeconds()),
        signal,
      )
    },
  }
}

function createHarnessRepository() {
  const outcomes = OUTCOMES[query.get('comparison-outcome') ?? '']
  const repository = createDemoComparisonRepository({
    audio: {
      loadSongAudio: songAudio,
      loadSeparatedAudio: separatedAudio,
    },
    findTask(taskId) {
      const detail = taskDetail(taskId)
      if (!detail) return undefined
      const task = seeding ? seededRange(detail.task) : detail.task
      return { task, song: detail.song }
    },
    timing:
      query.get('comparison-run') === 'instant' ? INSTANT_TIMING : FAST_TIMING,
    requestDelayMs: 0,
    outcomesFor: outcomes && (() => outcomes),
    unavailableTracks: query.has('comparison-partial') ? ['original'] : [],
  })
  return withTakeSound(repository)
}

async function seedTake(repository: ComparisonRepository) {
  const seed = query.get('comparison-seed')
  const detail = taskDetail(query.get('task') ?? '')
  if (seed === null || detail === null) return
  const { signal } = new AbortController()
  const task = seededRange(detail.task)
  for (let saved = 0; saved < seedCount; saved += 1) {
    const take = await repository.savePerformance(
      {
        taskId: task.id,
        source: 'upload',
        audio: new Blob([new Uint8Array(44)], { type: 'audio/wav' }),
        durationSeconds: takeSeconds(
          task.rangeEndSeconds - task.rangeStartSeconds,
        ),
      },
      signal,
    )
    if (seed === 'compared') await repository.requestComparison(take.id, signal)
  }
}

async function harnessRepository() {
  const repository = createHarnessRepository()
  seeding = true
  try {
    await seedTake(repository)
  } finally {
    seeding = false
  }
  return repository
}

export const comparisonRepository: ComparisonRepository | null = query.has(
  'comparison',
)
  ? await harnessRepository()
  : null
