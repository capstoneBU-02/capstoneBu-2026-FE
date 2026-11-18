// How the mock moves a comparison through its stages on the session clock. It
// follows the CMP state machine, including the wait between two stages.

import type { TaskStageStatus } from '../workspace/model.ts'
import type {
  ComparisonStage,
  ComparisonStageId,
  ComparisonState,
} from './model.ts'

const STAGE_ORDER: readonly ComparisonStageId[] = [
  'align',
  'transcription',
  'compare',
]

export interface ComparisonTiming {
  // The wait before the first stage.
  readonly queueMs: number
  // The wait for the next stage after one finishes.
  readonly stageQueueMs: number
  readonly stageMs: Readonly<Record<ComparisonStageId, number>>
}

export const DEMO_COMPARISON_TIMING: ComparisonTiming = {
  queueMs: 1_000,
  stageQueueMs: 500,
  stageMs: { align: 2_500, transcription: 3_000, compare: 2_000 },
}

export type ComparisonOutcome =
  | { readonly kind: 'success' }
  | {
      readonly kind: 'not-comparable'
      readonly stage: ComparisonStageId
      readonly reason: string
    }
  | {
      readonly kind: 'failed'
      readonly stage: ComparisonStageId
      readonly code: string
      readonly retryable: boolean
    }

export interface ComparisonRun {
  readonly enqueuedAt: number
  // A retry starts from the stage that failed.
  readonly startStage: ComparisonStageId
  readonly outcome: ComparisonOutcome
}

export interface ComparisonRunState {
  readonly state: ComparisonState
  readonly currentStage: ComparisonStageId | null
  readonly stages: readonly ComparisonStage[]
}

// A restarted run cannot end before the stage it restarted from.
export function outcomeFromStage(
  outcome: ComparisonOutcome,
  startStage: ComparisonStageId,
): ComparisonOutcome {
  if (outcome.kind === 'success') return outcome
  const index = Math.max(
    STAGE_ORDER.indexOf(outcome.stage),
    STAGE_ORDER.indexOf(startStage),
  )
  return { ...outcome, stage: STAGE_ORDER[index] }
}

function stagesBy(
  statusAt: (index: number) => TaskStageStatus,
): readonly ComparisonStage[] {
  return STAGE_ORDER.map((id, index) => ({ id, status: statusAt(index) }))
}

function waitingAfter(finished: number): ComparisonRunState {
  return {
    state: 'queued',
    currentStage: STAGE_ORDER[finished] ?? null,
    stages: stagesBy((index) => (index <= finished ? 'done' : 'waiting')),
  }
}

function runningAt(running: number): ComparisonRunState {
  return {
    state: 'processing',
    currentStage: STAGE_ORDER[running],
    stages: stagesBy((index) => {
      if (index < running) return 'done'
      return index === running ? 'running' : 'waiting'
    }),
  }
}

function finishedAt(
  outcome: ComparisonOutcome,
  last: number,
): ComparisonRunState {
  const currentStage = STAGE_ORDER[last]
  if (outcome.kind === 'failed') {
    return {
      state: 'failed',
      currentStage,
      stages: stagesBy((index) => {
        if (index < last) return 'done'
        return index === last ? 'failed' : 'waiting'
      }),
    }
  }
  return {
    state: outcome.kind,
    currentStage,
    stages: stagesBy((index) => (index <= last ? 'done' : 'skipped')),
  }
}

export function comparisonRunState(
  run: ComparisonRun,
  now: number,
  timing: ComparisonTiming,
): ComparisonRunState {
  const first = STAGE_ORDER.indexOf(run.startStage)
  const last =
    run.outcome.kind === 'success'
      ? STAGE_ORDER.length - 1
      : STAGE_ORDER.indexOf(run.outcome.stage)

  let stageStart = run.enqueuedAt + timing.queueMs
  if (now < stageStart) return waitingAfter(first - 1)

  for (let index = first; index <= last; index += 1) {
    const stageEnd = stageStart + timing.stageMs[STAGE_ORDER[index]]
    if (now < stageEnd) return runningAt(index)
    if (index === last) break
    stageStart = stageEnd + timing.stageQueueMs
    if (now < stageStart) return waitingAfter(index)
  }
  return finishedAt(run.outcome, last)
}
