import {
  createContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

interface WorkspaceActivity {
  signal(): AbortSignal | null
  notify(message: string): void
}

export const WorkspaceActivityContext = createContext<WorkspaceActivity | null>(
  null,
)

// Saved takes may start comparing after their task screen closes. Their
// requests and notices belong to this workspace, never the next login.
export function useWorkspaceActivity(scope: string | null) {
  const lifetime = useRef<{
    scope: string
    controller: AbortController
  } | null>(null)
  const sequence = useRef(0)
  const [notices, setNotices] = useState<
    readonly { id: number; scope: string; message: string }[]
  >([])
  const [noticeScope, setNoticeScope] = useState(scope)
  if (noticeScope !== scope) {
    setNoticeScope(scope)
    setNotices([])
  }
  useLayoutEffect(() => {
    if (scope === null) return
    const controller = new AbortController()
    lifetime.current = { scope, controller }
    return () => controller.abort()
  }, [scope])
  const context = useMemo<WorkspaceActivity>(() => {
    const signal = () => {
      const current = lifetime.current
      return current?.scope === scope && !current.controller.signal.aborted
        ? current.controller.signal
        : null
    }
    return {
      signal,
      notify(message) {
        if (scope === null || signal() === null) return
        const id = ++sequence.current
        setNotices((previous) => [
          ...previous.filter((notice) => notice.scope === scope),
          { id, scope, message },
        ])
      },
    }
  }, [scope])
  return {
    context,
    notices: notices.filter((notice) => notice.scope === scope),
    dismiss: (id: number) =>
      setNotices((previous) => previous.filter((notice) => notice.id !== id)),
  }
}
