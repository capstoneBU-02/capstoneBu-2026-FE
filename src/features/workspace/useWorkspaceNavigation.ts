import { useCallback, useEffect, useRef, useState } from 'react'
import {
  canonicalWorkspaceView,
  hasWorkspaceScope,
  readWorkspaceView,
  scopedWorkspaceView,
  workspaceUrl,
  workspaceViewKey,
  WORKSPACE_SCOPE_KEY,
  type WorkspaceView,
} from './navigation.ts'

function createWorkspaceScope(): string {
  // This opaque history marker is not an auth token. getRandomValues also
  // works on LAN HTTP, where the secure-context-only randomUUID is absent.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function useWorkspaceNavigation() {
  const [entry] = useState(() => {
    const view: WorkspaceView = hasWorkspaceScope(window.history.state)
      ? { name: 'home' }
      : readWorkspaceView(window.location.search)
    return {
      scope: createWorkspaceScope(),
      pathname: window.location.pathname,
      // Freeze this session's selector. A popped URL may belong to an old
      // preview; carrying its selector forward could change the app on reload.
      selectorSearch: workspaceUrl('', window.location.search, {
        name: 'home',
      }),
      view,
    }
  })
  const [view, setView] = useState<WorkspaceView>(entry.view)
  const currentView = useRef<WorkspaceView>(entry.view)
  // The last push, while its entry is still the current one. Moving through
  // history or replacing the entry forgets it.
  const lastPush = useRef<{ from: string; to: string } | null>(null)
  // Set while the screen holds something that leaving it would lose.
  const leaveBlocked = useRef(false)
  const leaveOpenerRef = useRef<HTMLElement | null>(null)
  // Back or Forward asked to leave, so going ahead retraces that step.
  const leaveByHistory = useRef(false)
  const [pendingLeave, setPendingLeave] = useState<WorkspaceView | null>(null)
  // The same request, for blockLeaving, which outlives the render showing it.
  const pendingLeaveRef = useRef<WorkspaceView | null>(null)
  const askToLeave = useCallback((next: WorkspaceView | null) => {
    pendingLeaveRef.current = next
    setPendingLeave(next)
  }, [])

  useEffect(() => {
    function replace(next: WorkspaceView) {
      window.history.replaceState(
        { [WORKSPACE_SCOPE_KEY]: entry.scope },
        '',
        workspaceUrl(entry.pathname, entry.selectorSearch, next),
      )
    }
    replace(entry.view)
    function popstate(event: PopStateEvent) {
      const next = scopedWorkspaceView(
        event.state,
        window.location.search,
        entry.scope,
      )
      const moved =
        workspaceViewKey(next) !== workspaceViewKey(currentView.current)
      if (leaveBlocked.current && moved) {
        // The browser has already moved, so step back onto this screen.
        window.history.pushState(
          { [WORKSPACE_SCOPE_KEY]: entry.scope },
          '',
          workspaceUrl(
            entry.pathname,
            entry.selectorSearch,
            currentView.current,
          ),
        )
        lastPush.current = null
        leaveOpenerRef.current = document.activeElement as HTMLElement | null
        leaveByHistory.current = true
        askToLeave(next)
        return
      }
      replace(next)
      lastPush.current = null
      currentView.current = next
      setView(next)
    }
    window.addEventListener('popstate', popstate)
    return () => window.removeEventListener('popstate', popstate)
  }, [entry, askToLeave])

  // Stable, so blockLeaving can be too.
  const navigate = useCallback(
    (requested: WorkspaceView) => {
      const next = canonicalWorkspaceView(requested)
      const from = workspaceViewKey(currentView.current)
      const to = workspaceViewKey(next)
      if (from === to) return
      if (leaveBlocked.current) {
        leaveOpenerRef.current = document.activeElement as HTMLElement | null
        leaveByHistory.current = false
        askToLeave(next)
        return
      }
      window.history.pushState(
        { [WORKSPACE_SCOPE_KEY]: entry.scope },
        '',
        workspaceUrl(entry.pathname, entry.selectorSearch, next),
      )
      lastPush.current = { from, to }
      currentView.current = next
      setView(next)
    },
    [entry, askToLeave],
  )

  // Once nothing would be lost, a leave still being asked about goes ahead:
  // a take that finished saving or lost its microphone leaves the question
  // with nothing to protect.
  const blockLeaving = useCallback(
    (blocked: boolean) => {
      leaveBlocked.current = blocked
      if (blocked) return
      const next = pendingLeaveRef.current
      askToLeave(null)
      if (!next) return
      // This screen's entry was pushed right after the one asked for.
      if (leaveByHistory.current) window.history.back()
      else navigate(next)
    },
    [askToLeave, navigate],
  )

  // Closes a screen such as 구간 수정 without leaving it in history: Back
  // then skips it. Opened from the requested view, the screen's entry is
  // popped; otherwise it is replaced.
  function leave(requested: WorkspaceView) {
    const next = canonicalWorkspaceView(requested)
    const from = workspaceViewKey(currentView.current)
    const to = workspaceViewKey(next)
    if (from === to) return
    const push = lastPush.current
    lastPush.current = null
    // The view changes now; the popstate that follows finds it in place.
    currentView.current = next
    setView(next)
    if (push && push.from === to && push.to === from) {
      window.history.back()
      return
    }
    window.history.replaceState(
      { [WORKSPACE_SCOPE_KEY]: entry.scope },
      '',
      workspaceUrl(entry.pathname, entry.selectorSearch, next),
    )
  }

  return {
    view,
    navigate,
    leave,
    blockLeaving,
    leaveAsked: pendingLeave !== null,
    leaveOpenerRef,
    confirmLeave: () => blockLeaving(false),
    cancelLeave: () => askToLeave(null),
  }
}
