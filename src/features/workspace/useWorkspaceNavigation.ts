import { useEffect, useRef, useState } from 'react'
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

  function navigate(requested: WorkspaceView) {
    const next = canonicalWorkspaceView(requested)
    if (workspaceViewKey(currentView.current) === workspaceViewKey(next)) return
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
