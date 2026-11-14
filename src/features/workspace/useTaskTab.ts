import { useEffect, useEffectEvent, useState } from 'react'
import { parseTabScore } from '../tab/parseTabScore.ts'
import type { TabSource } from '../tab/TabPanel.tsx'
import type { WorkspaceTask } from './model.ts'
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
  readonly madeFrom: string
  readonly version: number
}

type TabTask = Pick<
  WorkspaceTask,
  | 'id'
  | 'processingStatus'
  | 'part'
  | 'tuningId'
  | 'rangeStartSeconds'
  | 'rangeEndSeconds'
>

const LOADING: TabSource = { status: 'loading' }

// What a finished task's tab is made from. A section changed elsewhere, as
// from another browser tab, can finish again before this screen sees it
// processing; the tab loads again all the same.
export function tabMadeFrom(task: TabTask): string {
  return [
    task.id,
    task.part,
    task.tuningId,
    task.rangeStartSeconds,
    task.rangeEndSeconds,
  ].join(':')
}

// Loads a finished task's tab while its screen is open and checks it at the
// boundary. Leaving the task, asking again, or a change to what the tab is
// made from cancels the request; a task that runs again drops its tab.
export function useTaskTab(
  task: TabTask,
  { loadTab, onExpired }: TaskTabSource,
): TabSource {
  const taskId = task.id
  const madeFrom =
    task.processingStatus === 'completed' ? tabMadeFrom(task) : null
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    request: Request
    answer: Answer
  } | null>(null)
  if (madeFrom === null && result !== null) setResult(null)
  const load = useEffectEvent(loadTab)
  const reportExpired = useEffectEvent(onExpired)

  useEffect(() => {
    if (madeFrom === null) return
    const controller = new AbortController()
    const { signal } = controller
    const request = { madeFrom, version }
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
  }, [taskId, madeFrom, version])

  if (
    madeFrom === null ||
    result?.request.madeFrom !== madeFrom ||
    result.request.version !== version
  )
    return LOADING
  const { answer } = result
  if (answer.status !== 'failed') return answer
  return {
    ...answer,
    retry: () => setVersion((previous) => previous + 1),
  }
}
