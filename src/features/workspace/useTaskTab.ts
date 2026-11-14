import { useEffect, useEffectEvent, useState } from 'react'
import { parseTabScore } from '../tab/parseTabScore.ts'
import type { TabSource } from '../tab/TabPanel.tsx'
import { WorkspaceRepositoryError } from './repository.ts'

export interface TaskTabSource {
  loadTab(taskId: string, signal: AbortSignal): Promise<unknown>
  onExpired(): void
}

// What the request settled with; a failure gets its retry when shown.
type Answer =
  | Extract<TabSource, { readonly status: 'ready' }>
  | Omit<Extract<TabSource, { readonly status: 'failed' }>, 'retry'>

interface Request {
  readonly taskId: string
  readonly version: number
}

const LOADING: TabSource = { status: 'loading' }

// Loads a finished task's tab while its screen is open and checks it at the
// boundary. Leaving the task, or asking again, cancels the request.
export function useTaskTab(
  taskId: string,
  { loadTab, onExpired }: TaskTabSource,
): TabSource {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    request: Request
    answer: Answer
  } | null>(null)
  const load = useEffectEvent(loadTab)
  const reportExpired = useEffectEvent(onExpired)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const request = { taskId, version }
    load(taskId, signal).then(
      (input) => {
        if (signal.aborted) return
        const parsed = parseTabScore(input)
        setResult({
          request,
          answer: parsed.ok
            ? { status: 'ready', score: parsed.score }
            : { status: 'failed', reason: 'format' },
        })
      },
      (error: unknown) => {
        if (signal.aborted) return
        if (
          error instanceof WorkspaceRepositoryError &&
          error.code === 'expired'
        ) {
          reportExpired()
          return
        }
        setResult({ request, answer: { status: 'failed', reason: 'request' } })
      },
    )
    return () => controller.abort()
  }, [taskId, version])

  if (result?.request.taskId !== taskId || result.request.version !== version)
    return LOADING
  const { answer } = result
  if (answer.status !== 'failed') return answer
  return {
    ...answer,
    retry: () => setVersion((previous) => previous + 1),
  }
}
