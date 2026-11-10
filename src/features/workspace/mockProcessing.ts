// How the mock moves a task through the queue, separation and the tab. It
// stands in for the server's queue so the demo can show the states change.

import type { WorkspaceTask } from './model.ts'

export interface ProcessingTiming {
  // The shortest wait before a run can start.
  readonly queueMs: number
  readonly separationMs: number
  readonly transcriptionMs: number
}

export interface ProcessingRun {
  readonly taskId: string
  readonly enqueuedAt: number
  readonly skipsSeparation: boolean
}

export type RunState =
  | { readonly status: 'queued'; readonly ahead: number }
  | {
      readonly status: 'processing'
      readonly separated: boolean
      readonly percent: number
    }
  | { readonly status: 'completed' }

interface Scheduled {
  readonly run: ProcessingRun
  readonly startsAt: number
  readonly endsAt: number
}

function schedule(
  runs: readonly ProcessingRun[],
  timing: ProcessingTiming,
): readonly Scheduled[] {
  let workerFreeAt = -Infinity
  return runs.map((run) => {
    const startsAt = Math.max(run.enqueuedAt + timing.queueMs, workerFreeAt)
    const separationMs = run.skipsSeparation ? 0 : timing.separationMs
    const endsAt = startsAt + separationMs + timing.transcriptionMs
    workerFreeAt = endsAt
    return { run, startsAt, endsAt }
  })
}

function stateAt(
  scheduled: Scheduled,
  ahead: number,
  now: number,
  timing: ProcessingTiming,
): RunState {
  if (now < scheduled.startsAt) return { status: 'queued', ahead }
  if (now >= scheduled.endsAt) return { status: 'completed' }
  const elapsed = now - scheduled.startsAt
  const separationMs = scheduled.run.skipsSeparation ? 0 : timing.separationMs
  return {
    status: 'processing',
    separated: elapsed >= separationMs,
    percent: Math.floor(
      (elapsed / (scheduled.endsAt - scheduled.startsAt)) * 100,
    ),
  }
}

// One worker takes runs in the order they were queued. Runs are never
// removed, so a task queued again keeps the others' timing; its latest run
// decides its state.
export function runStates(
  runs: readonly ProcessingRun[],
  now: number,
  timing: ProcessingTiming,
): ReadonlyMap<string, RunState> {
  const scheduled = schedule(runs, timing)
  const states = new Map<string, RunState>()
  scheduled.forEach((entry, index) => {
    const ahead = scheduled
      .slice(0, index)
      .filter((earlier) => earlier.endsAt > now).length
    states.set(entry.run.taskId, stateAt(entry, ahead, now, timing))
  })
  return states
}

// A task created in the demo finishes in about half a minute.
export const DEMO_PROCESSING_TIMING: ProcessingTiming = {
  queueMs: 5_000,
  separationMs: 8_000,
  transcriptionMs: 12_000,
}

// Fixture tasks keep their state; queued tasks move with the session clock.
export function progressedTask(
  task: WorkspaceTask,
  state: RunState | undefined,
): WorkspaceTask {
  if (!state) return { ...task }
  if (state.status === 'queued')
    return {
      ...task,
      processingStatus: 'queued',
      progressPercent: null,
      hasSeparatedAudio: false,
    }
  if (state.status === 'processing')
    return {
      ...task,
      processingStatus: 'processing',
      progressPercent: state.percent,
      hasSeparatedAudio: state.separated,
    }
  return {
    ...task,
    processingStatus: 'completed',
    progressPercent: null,
    hasSeparatedAudio: true,
  }
}
