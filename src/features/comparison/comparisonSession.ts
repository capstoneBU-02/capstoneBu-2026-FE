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
  // Why the last action on a take failed, kept with that take.
  readonly notices: ReadonlyMap<string, string>
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
  | {
      readonly type: 'action-started'
      readonly action: ComparisonAction
      readonly performanceId: string
    }
  | {
      readonly type: 'action-failed'
      readonly performanceId: string
      readonly message: string
    }
  // A mark runs beside a request or retry and leaves it pending.
  | {
      readonly type: 'mark-failed'
      readonly performanceId: string
      readonly message: string
    }
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
  notices: new Map(),
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
    follow: state.follow + 1,
  }
}

function withNotice(
  notices: ReadonlyMap<string, string>,
  performanceId: string,
  message: string,
): ReadonlyMap<string, string> {
  return new Map([...notices, [performanceId, message]])
}

function withoutNotice(
  notices: ReadonlyMap<string, string>,
  performanceId: string | null,
): ReadonlyMap<string, string> {
  if (performanceId === null || !notices.has(performanceId)) return notices
  return new Map([...notices].filter(([id]) => id !== performanceId))
}

// The open take's notice has been seen once the user moves on from it; a
// failure that arrives after that stays for their return.
function leavingTake(state: ComparisonSessionState): ComparisonSessionState {
  return { ...state, notices: withoutNotice(state.notices, state.selectedId) }
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
      return openTake(leavingTake(state), performance)
    }
    case 'saved':
      return openTake(
        {
          ...leavingTake(state),
          performances: [event.performance, ...state.performances],
        },
        event.performance,
      )
    case 'action-started':
      return {
        ...state,
        pending: event.action,
        notices: withoutNotice(state.notices, event.performanceId),
      }
    case 'action-failed':
      return {
        ...state,
        pending: null,
        notices: withNotice(state.notices, event.performanceId, event.message),
      }
    case 'mark-failed':
      return {
        ...state,
        notices: withNotice(state.notices, event.performanceId, event.message),
      }
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
      // A new mark makes the failure of the last one old news.
      return {
        ...state,
        result: withRegionChecked(state.result, event.regionId, event.checked),
        notices: withoutNotice(state.notices, state.selectedId),
      }
  }
}

export function selectedPerformance(
  state: ComparisonSessionState,
): SavedPerformance | null {
  return state.performances.find(({ id }) => id === state.selectedId) ?? null
}

// Only the open take's notice is shown; another take keeps its own.
export function sessionNotice(state: ComparisonSessionState): string | null {
  if (state.selectedId === null) return null
  return state.notices.get(state.selectedId) ?? null
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
  // A comparison that could not be read, even one still running or not yet
  // settled, waits for the user to ask again.
  if (state.resultFailed && result === null) return 'result-failed'
  // The list cannot say whether a failure may be retried.
  if (status.state === 'failed' && !state.statusSettled) return 'loading-result'
  const panel = comparisonPanel(status, result)
  if (panel !== 'not-comparable' && panel !== 'loading-result') return panel
  // Even a take that could not be compared needs its result to name the
  // baseline it was held against.
  return result !== null ? panel : 'loading-result'
}
