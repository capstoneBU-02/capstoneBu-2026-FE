import {
  comparisonPanel,
  isComparisonRunning,
  withRegionChecked,
  type ComparisonPanel,
} from './comparisonView.ts'
import type {
  ComparisonPlayback,
  ComparisonRef,
  ComparisonResult,
  ComparisonStatus,
  SavedPerformance,
} from './model.ts'

export type ComparisonAction = 'requesting' | 'retrying'

export interface ComparisonSessionState {
  readonly listStatus: 'loading' | 'ready' | 'failed'
  // Newest first.
  readonly performances: readonly SavedPerformance[]
  readonly selectedId: string | null
  readonly status: ComparisonStatus | null
  // False while the status is only what the list knew about the comparison.
  readonly statusSettled: boolean
  readonly result: ComparisonResult | null
  readonly playback: ComparisonPlayback | null
  readonly resultFailed: boolean
  readonly pending: ComparisonAction | null
  readonly notice: string | null
  // Changes whenever the open comparison has to be read from the start.
  readonly follow: number
}

export type ComparisonSessionEvent =
  | { readonly type: 'list-loading' }
  | {
      readonly type: 'list-loaded'
      readonly performances: readonly SavedPerformance[]
    }
  | { readonly type: 'list-failed' }
  | { readonly type: 'select'; readonly performanceId: string }
  | { readonly type: 'saved'; readonly performance: SavedPerformance }
  | { readonly type: 'action-started'; readonly action: ComparisonAction }
  | { readonly type: 'action-failed'; readonly message: string }
  | {
      readonly type: 'comparison-started'
      readonly performanceId: string
      readonly comparison: ComparisonRef
    }
  | { readonly type: 'status-loaded'; readonly status: ComparisonStatus }
  | {
      readonly type: 'result-loaded'
      readonly result: ComparisonResult
      readonly playback: ComparisonPlayback | null
    }
  | { readonly type: 'result-failed'; readonly comparisonId: string }
  | { readonly type: 'reload-result' }
  | {
      readonly type: 'region-marked'
      readonly comparisonId: string
      readonly regionId: string
      readonly checked: boolean
    }

export const initialComparisonSession: ComparisonSessionState = {
  listStatus: 'loading',
  performances: [],
  selectedId: null,
  status: null,
  statusSettled: false,
  result: null,
  playback: null,
  resultFailed: false,
  pending: null,
  notice: null,
  follow: 0,
}

// The list only knows a comparison's state; the rest arrives with its status.
function statusFromRef(comparison: ComparisonRef): ComparisonStatus {
  return {
    id: comparison.id,
    state: comparison.state,
    currentStage: null,
    stages: [],
    notComparableReason: null,
    failure: null,
  }
}

function openTake(
  state: ComparisonSessionState,
  performance: SavedPerformance | null,
): ComparisonSessionState {
  const comparison = performance?.latestComparison ?? null
  return {
    ...state,
    selectedId: performance?.id ?? null,
    status: comparison && statusFromRef(comparison),
    statusSettled: false,
    result: null,
    playback: null,
    resultFailed: false,
    notice: null,
    follow: state.follow + 1,
  }
}

function withLatestComparison(
  performances: readonly SavedPerformance[],
  performanceId: string,
  comparison: ComparisonRef,
): readonly SavedPerformance[] {
  return performances.map((performance) =>
    performance.id === performanceId
      ? { ...performance, latestComparison: comparison }
      : performance,
  )
}

function afterListLoaded(
  state: ComparisonSessionState,
  performances: readonly SavedPerformance[],
): ComparisonSessionState {
  const listed = { ...state, listStatus: 'ready', performances } as const
  const kept = performances.find(({ id }) => id === state.selectedId)
  if (!kept) return openTake(listed, performances[0] ?? null)
  // A comparison the screen has not been following replaces what it shows.
  return (kept.latestComparison?.id ?? null) === (state.status?.id ?? null)
    ? listed
    : openTake(listed, kept)
}

function afterStatusLoaded(
  state: ComparisonSessionState,
  status: ComparisonStatus,
): ComparisonSessionState {
  if (state.status?.id !== status.id) return state
  const running = isComparisonRunning(status.state)
  return {
    ...state,
    status,
    statusSettled: true,
    result: running ? null : state.result,
    playback: running ? null : state.playback,
    performances: state.selectedId
      ? withLatestComparison(state.performances, state.selectedId, {
          id: status.id,
          state: status.state,
        })
      : state.performances,
  }
}

function afterComparisonStarted(
  state: ComparisonSessionState,
  performanceId: string,
  comparison: ComparisonRef,
): ComparisonSessionState {
  const performances = withLatestComparison(
    state.performances,
    performanceId,
    comparison,
  )
  const updated = { ...state, performances, pending: null }
  if (state.selectedId !== performanceId) return updated
  return {
    ...updated,
    status: statusFromRef(comparison),
    statusSettled: false,
    result: null,
    playback: null,
    resultFailed: false,
    notice: null,
    follow: state.follow + 1,
  }
}

export function comparisonSessionReducer(
  state: ComparisonSessionState,
  event: ComparisonSessionEvent,
): ComparisonSessionState {
  switch (event.type) {
    case 'list-loading':
      return { ...state, listStatus: 'loading' }
    case 'list-loaded':
      return afterListLoaded(state, event.performances)
    case 'list-failed':
      return { ...state, listStatus: 'failed' }
    case 'select': {
      const performance = state.performances.find(
        ({ id }) => id === event.performanceId,
      )
      if (!performance || performance.id === state.selectedId) return state
      return openTake(state, performance)
    }
    case 'saved':
      return openTake(
        {
          ...state,
          performances: [event.performance, ...state.performances],
        },
        event.performance,
      )
    case 'action-started':
      return { ...state, pending: event.action, notice: null }
    case 'action-failed':
      return { ...state, pending: null, notice: event.message }
    case 'comparison-started':
      return afterComparisonStarted(
        state,
        event.performanceId,
        event.comparison,
      )
    case 'status-loaded':
      return afterStatusLoaded(state, event.status)
    case 'result-loaded':
      if (state.status?.id !== event.result.comparisonId) return state
      return {
        ...state,
        result: event.result,
        playback: event.playback,
        resultFailed: false,
      }
    case 'result-failed':
      if (state.status?.id !== event.comparisonId) return state
      return { ...state, resultFailed: true }
    case 'reload-result':
      return { ...state, resultFailed: false, follow: state.follow + 1 }
    case 'region-marked':
      if (state.result?.comparisonId !== event.comparisonId) return state
      return {
        ...state,
        result: withRegionChecked(state.result, event.regionId, event.checked),
      }
  }
}

export function selectedPerformance(
  state: ComparisonSessionState,
): SavedPerformance | null {
  return state.performances.find(({ id }) => id === state.selectedId) ?? null
}

export function comparedTakeCount(state: ComparisonSessionState): number {
  return state.performances.filter(
    (performance) => performance.latestComparison !== null,
  ).length
}

export type SessionPanel =
  | ComparisonPanel
  | 'loading'
  | 'list-failed'
  | 'not-requested'
  | 'result-failed'

export function sessionPanel(state: ComparisonSessionState): SessionPanel {
  if (state.selectedId === null) {
    if (state.listStatus === 'loading') return 'loading'
    return state.listStatus === 'failed' ? 'list-failed' : 'empty'
  }
  const { status, result } = state
  if (status === null) return 'not-requested'
  // The list cannot say whether a failure may be retried.
  if (status.state === 'failed' && !state.statusSettled) return 'loading-result'
  const panel = comparisonPanel(status, result)
  if (panel !== 'not-comparable' && panel !== 'loading-result') return panel
  // Even a take that could not be compared needs its result to name the
  // baseline it was held against.
  if (result !== null) return panel
  return state.resultFailed ? 'result-failed' : 'loading-result'
}
