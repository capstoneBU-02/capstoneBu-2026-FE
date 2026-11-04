import { useEffect, useRef, useState } from 'react'
import {
  hasWorkspaceScope,
  readWorkspaceView,
  scopedWorkspaceView,
  workspaceUrl,
  WORKSPACE_SCOPE_KEY,
  type WorkspaceView,
} from './navigation.ts'

export function useWorkspaceNavigation() {
  const [entry] = useState(() => ({
    scope: crypto.randomUUID(),
    pathname: window.location.pathname,
    // Freeze this session's selector. A popped URL may belong to an old
    // preview; carrying its selector forward could change the app on reload.
    selectorSearch: workspaceUrl('', window.location.search, 'home'),
    view: hasWorkspaceScope(window.history.state)
      ? ('home' as const)
      : readWorkspaceView(window.location.search),
  }))
  const [view, setView] = useState<WorkspaceView>(entry.view)
  const currentView = useRef<WorkspaceView>(entry.view)

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
      replace(next)
      currentView.current = next
      setView(next)
    }
    window.addEventListener('popstate', popstate)
    return () => window.removeEventListener('popstate', popstate)
  }, [entry])

  function navigate(next: WorkspaceView) {
    if (currentView.current === next) return
    window.history.pushState(
      { [WORKSPACE_SCOPE_KEY]: entry.scope },
      '',
      workspaceUrl(entry.pathname, entry.selectorSearch, next),
    )
    currentView.current = next
    setView(next)
  }

  return { view, navigate }
}
