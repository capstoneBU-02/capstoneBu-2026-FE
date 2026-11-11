import { useEffect, useEffectEvent, useRef } from 'react'
import { isTaskInProgress } from './format.ts'
import {
  startRefreshLoop,
  type RefreshLoop,
  type RefreshStep,
} from './refreshLoop.ts'
import type { UseWorkspaceResult } from './useWorkspace.ts'

// The list follows changes made outside this screen (#28): it loads again
// when the tab is shown or the window gets focus, and every refreshMs while
// a listed task is queued or processing. null turns this off. The interval
// and the stop rules are the open task's (#17).
export function useListRefresh(
  workspace: UseWorkspaceResult,
  refreshMs: number | null,
) {
  const listed =
    workspace.loadState === 'success' || workspace.loadState === 'empty'
  const delayMs =
    listed && workspace.tasks.some(isTaskInProgress) ? refreshMs : null
  const loop = useRef<RefreshLoop | null>(null)
  const refresh = useEffectEvent(
    async (signal: AbortSignal): Promise<RefreshStep> =>
      (await workspace.refreshList(signal)) === 'expired' ? 'stop' : 'continue',
  )
  const currentDelay = useEffectEvent(() => delayMs)

  // One loop while the list is shown. The last running task finishing only
  // changes its delay, so a refresh on its way still brings what other tabs
  // changed.
  useEffect(() => {
    if (!listed || refreshMs === null) return
    const started = startRefreshLoop({
      delayMs: currentDelay(),
      run: (signal) => refresh(signal),
    })
    loop.current = started
    return () => {
      started.stop()
      loop.current = null
    }
  }, [listed, refreshMs])

  useEffect(() => {
    loop.current?.setDelay(delayMs)
  }, [delayMs])
}
