import { useEffect, useRef, useState } from 'react'
import type { WorkspaceTask } from './model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

export type CopySaveResult = 'saved' | 'failed' | 'expired' | 'cancelled'

export interface CopyStatus {
  // The value each task's 카피 완료 is being saved as, until the server
  // answers.
  readonly saving: ReadonlyMap<string, boolean>
  // Tasks whose last save failed, kept until the task saves again, so a task
  // left while saving still says so once it is opened again.
  readonly failed: ReadonlySet<string>
  // Leaving the task does not cancel the save: the server acts on it anyway,
  // so the list takes its result. Another workspace or expiry cancels it. A
  // task still saving refuses another save with 'cancelled'.
  save(taskId: string, confirmed: boolean): Promise<CopySaveResult>
}

export interface CopyStatusOptions {
  // The workspace has closed, so nothing more is saved.
  readonly expired: boolean
  // The server's copy of a saved task, for the list and the open task.
  readonly onSaved: (task: WorkspaceTask) => void
  readonly onExpired: () => void
}

const NOTHING_SAVING: ReadonlyMap<string, boolean> = new Map()
const NOTHING_FAILED: ReadonlySet<string> = new Set()

function without(
  saving: ReadonlyMap<string, boolean>,
  taskId: string,
): ReadonlyMap<string, boolean> {
  const next = new Map(saving)
  next.delete(taskId)
  return next
}

function settled(
  failed: ReadonlySet<string>,
  taskId: string,
  failedAgain: boolean,
): ReadonlySet<string> {
  if (failed.has(taskId) === failedAgain) return failed
  const next = new Set(failed)
  if (failedAgain) next.add(taskId)
  else next.delete(taskId)
  return next
}

// 카피 완료 for every task of the workspace, kept apart from processing
// (COPY-04): only the user marks or unmarks it.
export function useCopyStatus(
  repository: Pick<WorkspaceRepository, 'saveCopyStatus'>,
  { expired, onSaved, onExpired }: CopyStatusOptions,
): CopyStatus {
  const [saving, setSaving] = useState(NOTHING_SAVING)
  const [failed, setFailed] = useState(NOTHING_FAILED)
  const requests = useRef(new Map<string, AbortController>())

  useEffect(() => {
    if (expired) return
    const running = requests.current
    return () => {
      running.forEach((controller) => controller.abort())
      running.clear()
      setSaving(NOTHING_SAVING)
      setFailed(NOTHING_FAILED)
    }
  }, [repository, expired])

  async function save(
    taskId: string,
    confirmed: boolean,
  ): Promise<CopySaveResult> {
    if (expired || requests.current.has(taskId)) return 'cancelled'
    const controller = new AbortController()
    const { signal } = controller
    requests.current.set(taskId, controller)
    setSaving((previous) => new Map(previous).set(taskId, confirmed))
    setFailed((previous) => settled(previous, taskId, false))
    try {
      const saved = await repository.saveCopyStatus(taskId, confirmed, signal)
      if (signal.aborted) return 'cancelled'
      onSaved(saved)
      return 'saved'
    } catch (error) {
      if (signal.aborted) return 'cancelled'
      if (
        error instanceof WorkspaceRepositoryError &&
        error.code === 'expired'
      ) {
        onExpired()
        return 'expired'
      }
      setFailed((previous) => settled(previous, taskId, true))
      return 'failed'
    } finally {
      if (requests.current.get(taskId) === controller) {
        requests.current.delete(taskId)
        setSaving((previous) => without(previous, taskId))
      }
    }
  }

  return { saving, failed, save }
}
