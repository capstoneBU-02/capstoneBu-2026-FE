import {
  useContext,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from 'react'
import { WorkspaceActivityContext } from '../workspace/useWorkspaceActivity.ts'
import {
  startRefreshLoop,
  type RefreshLoop,
  type RefreshStep,
} from '../workspace/refreshLoop.ts'
import {
  comparedTakeCount,
  comparisonSessionReducer,
  initialComparisonSession,
  selectedPerformance,
  sessionNotice,
  sessionPanel,
  type ComparisonSessionState,
  type SessionPanel,
} from './comparisonSession.ts'
import { isComparisonRunning } from './comparisonView.ts'
import type { NewPerformanceInput, SavedPerformance } from './model.ts'
import {
  ComparisonRepositoryError,
  type ComparisonRepository,
} from './repository.ts'

// CMP asks for a status every two to three seconds.
const POLL_MS = 2_500

const SAVE_FAILED = '연주를 저장하지 못했어요. 다시 시도해 주세요.'
const REQUEST_FAILED = '비교를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'
const MARK_FAILED = '확인 표시를 저장하지 못했어요. 다시 시도해 주세요.'

export type NewTake = Omit<NewPerformanceInput, 'taskId'>

// A take that saved stays saved even when its comparison could not start.
export interface SubmitTakeOutcome {
  readonly saved: boolean
  readonly message: string | null
}

export interface ComparisonSession {
  readonly state: ComparisonSessionState
  readonly panel: SessionPanel
  readonly selected: SavedPerformance | null
  readonly comparedCount: number
  // Why the last action on the open take failed.
  readonly notice: string | null
  select(performanceId: string): void
  // `onProgress` hears whole percents of the file sent.
  submitTake(
    take: NewTake,
    onProgress?: (percent: number) => void,
  ): Promise<SubmitTakeOutcome>
  requestSelected(): void
  retry(): void
  markRegion(regionId: string, checked: boolean): void
  reloadList(): void
  reloadResult(): void
}

function hasCode(error: unknown, code: ComparisonRepositoryError['code']) {
  return error instanceof ComparisonRepositoryError && error.code === code
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ComparisonRepositoryError ? error.message : fallback
}

// The takes of one task and the comparison of the open take, while the task
// is open. Without a repository or a task it asks for nothing.
export function useComparisonSession({
  repository,
  taskId,
  sectionName = '작업',
  onExpired,
  pollMs = POLL_MS,
}: {
  repository: ComparisonRepository | null
  taskId: string | null
  sectionName?: string
  onExpired: () => void
  pollMs?: number
}): ComparisonSession {
  const activity = useContext(WorkspaceActivityContext)
  const [state, dispatch] = useReducer(
    comparisonSessionReducer,
    initialComparisonSession,
  )
  const [listAttempt, setListAttempt] = useState(0)
  const reportExpired = useEffectEvent(onExpired)
  // Requests the user started end with the screen, not with the next render.
  const lifetime = useRef<AbortController | null>(null)
  // The last mark sent for each place: only its failure may undo the checkbox.
  const latestMarks = useRef(new Map<string, number>())
  const comparisonId = state.status?.id ?? null

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (repository === null || taskId === null) return
    const controller = new AbortController()
    const { signal } = controller
    dispatch({ type: 'list-loading' })
    repository.listPerformances(taskId, signal).then(
      (performances) => {
        if (!signal.aborted) dispatch({ type: 'list-loaded', performances })
      },
      (error: unknown) => {
        if (signal.aborted) return
        if (hasCode(error, 'expired')) reportExpired()
        else dispatch({ type: 'list-failed' })
      },
    )
    return () => controller.abort()
  }, [repository, taskId, listAttempt])

  useEffect(() => {
    if (repository === null || comparisonId === null) return
    const id = comparisonId
    const source = repository

    async function loadFinished(signal: AbortSignal) {
      const result = await source.loadResult(id, signal)
      // The result still reads without its sounds (CMP-04).
      const playback =
        result.state === 'success'
          ? await source.loadPlayback(id, signal).catch((error: unknown) => {
              if (hasCode(error, 'expired')) throw error
              return null
            })
          : null
      if (!signal.aborted) dispatch({ type: 'result-loaded', result, playback })
    }

    async function check(signal: AbortSignal): Promise<RefreshStep> {
      let running = true
      try {
        const status = await source.loadStatus(id, signal)
        if (signal.aborted) return 'stop'
        dispatch({ type: 'status-loaded', status })
        running = isComparisonRunning(status.state)
        if (!running && status.state !== 'failed') await loadFinished(signal)
        return running ? 'continue' : 'stop'
      } catch (error) {
        if (signal.aborted) return 'stop'
        if (hasCode(error, 'expired')) {
          reportExpired()
          return 'stop'
        }
        // A status that failed to load is asked for again; a comparison that
        // is gone, or a finished one whose result failed, waits for the user.
        if (running && !hasCode(error, 'comparison-unavailable'))
          return 'continue'
        dispatch({
          type: 'result-failed',
          comparisonId: id,
          missing: hasCode(error, 'comparison-unavailable'),
        })
        return 'stop'
      }
    }

    const controller = new AbortController()
    let loop: RefreshLoop | null = null
    void check(controller.signal).then((step) => {
      if (step === 'continue' && !controller.signal.aborted)
        loop = startRefreshLoop({ delayMs: pollMs, run: check })
    })
    return () => {
      controller.abort()
      loop?.stop()
    }
  }, [repository, comparisonId, state.follow, pollMs])

  // The notice goes to the take the action was for, which may no longer be
  // the open one.
  function failAction(
    type: 'action-failed' | 'mark-failed',
    error: unknown,
    fallback: string,
    performanceId: string,
  ) {
    if (lifetime.current?.signal.aborted) return
    if (hasCode(error, 'expired')) onExpired()
    else dispatch({ type, performanceId, message: messageOf(error, fallback) })
  }

  async function requestComparison(performanceId: string, saved = false) {
    const screenSignal = lifetime.current?.signal
    const signal = saved ? (activity?.signal() ?? screenSignal) : screenSignal
    if (!repository || !signal) return
    dispatch({ type: 'action-started', action: 'requesting', performanceId })
    try {
      const comparison = await repository.requestComparison(
        performanceId,
        signal,
      )
      if (!signal.aborted && !screenSignal?.aborted)
        dispatch({ type: 'comparison-started', performanceId, comparison })
    } catch (error) {
      if (signal.aborted) return
      if (hasCode(error, 'expired')) {
        onExpired()
        return
      }
      if (saved && activity) {
        activity.notify(
          `${sectionName} 연주는 저장됐지만 비교를 시작하지 못했어요. 해당 작업의 비교 화면에서 다시 시도해 주세요.`,
        )
        if (!screenSignal?.aborted)
          dispatch({ type: 'action-finished', performanceId })
      } else failAction('action-failed', error, REQUEST_FAILED, performanceId)
    }
  }

  async function submitTake(
    take: NewTake,
    onProgress?: (percent: number) => void,
  ): Promise<SubmitTakeOutcome> {
    const signal = lifetime.current?.signal
    if (!repository || !taskId || !signal)
      return { saved: false, message: SAVE_FAILED }
    try {
      const performance = await repository.savePerformance(
        { ...take, taskId },
        signal,
        onProgress,
      )
      if (signal.aborted) return { saved: true, message: null }
      dispatch({ type: 'saved', performance })
      // The take is durable now. Its comparison can finish in this workspace
      // after the dialog closes or a pending navigation goes ahead.
      void requestComparison(performance.id, true)
      return { saved: true, message: null }
    } catch (error) {
      if (hasCode(error, 'expired')) onExpired()
      return { saved: false, message: messageOf(error, SAVE_FAILED) }
    }
  }

  async function retry() {
    const signal = lifetime.current?.signal
    const performanceId = state.selectedId
    if (!repository || !signal || !performanceId || !comparisonId) return
    dispatch({ type: 'action-started', action: 'retrying', performanceId })
    try {
      const comparison = await repository.retry(comparisonId, signal)
      if (!signal.aborted)
        dispatch({ type: 'comparison-started', performanceId, comparison })
    } catch (error) {
      failAction('action-failed', error, REQUEST_FAILED, performanceId)
    }
  }

  async function markRegion(regionId: string, checked: boolean) {
    const signal = lifetime.current?.signal
    const performanceId = state.selectedId
    if (!repository || !signal || !performanceId || !comparisonId) return
    const id = comparisonId
    const mark = (latestMarks.current.get(regionId) ?? 0) + 1
    latestMarks.current.set(regionId, mark)
    dispatch({ type: 'region-marked', comparisonId: id, regionId, checked })
    try {
      await repository.markRegion(id, regionId, checked, signal)
    } catch (error) {
      if (signal.aborted || latestMarks.current.get(regionId) !== mark) return
      dispatch({
        type: 'region-marked',
        comparisonId: id,
        regionId,
        checked: !checked,
      })
      failAction('mark-failed', error, MARK_FAILED, performanceId)
    }
  }

  return {
    state,
    panel: sessionPanel(state),
    selected: selectedPerformance(state),
    comparedCount: comparedTakeCount(state),
    notice: sessionNotice(state),
    select: (performanceId) => dispatch({ type: 'select', performanceId }),
    submitTake,
    requestSelected() {
      if (state.selectedId) void requestComparison(state.selectedId)
    },
    retry() {
      void retry()
    },
    markRegion(regionId, checked) {
      void markRegion(regionId, checked)
    },
    reloadList: () => setListAttempt((attempt) => attempt + 1),
    reloadResult: () => dispatch({ type: 'reload-result' }),
  }
}
