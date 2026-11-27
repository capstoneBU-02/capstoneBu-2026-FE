// The server's work behind a task: its processing status, the stem or tab
// the page asks for (B4), the failed side's failure, and stopping its stem.
// A stem request is kept until the server answers it, so a stop waits for
// it and takes its stem too.

import {
  apiErrorOf,
  isSessionRejected,
  type HttpClient,
} from '../../api/http.ts'
import type { FailureView, ProcessingStatusResponse } from './apiTypes.ts'
import type { WorkspaceTask } from './model.ts'
import {
  readCancel,
  readProcessingStatus,
  readStemCreated,
  readTabCreated,
  readWorkFailure,
  tabRequestFor,
} from './taskAdapter.ts'
import { isWorkReady } from './taskState.ts'
import { untilAborted } from '../../shared/concurrency.ts'

export type Status = Pick<
  ProcessingStatusResponse,
  'stem' | 'tab' | 'updated_at'
>

// A new segment has neither; createTask passes this instead of reading it.
export const NOTHING_REQUESTED: Status = {
  stem: null,
  tab: null,
  updated_at: null,
}

// The same input's work is already on its way, as when another browser tab
// asked first: a stem for the same range, or a tab for the same guitar and
// condition. The status names it.
export const ALREADY_RUNNING: ReadonlySet<string> = new Set([
  'STEM_IN_PROGRESS',
  'TAB_IN_PROGRESS',
])

export const codeOf = (error: unknown) => apiErrorOf(error)?.code ?? ''

export interface TaskWork {
  // Null for a segment the server does not have in this session.
  getStatus(taskId: string, signal: AbortSignal): Promise<Status | null>
  // Null once the server no longer has the segment, as a status read again
  // after a 409 can find.
  requestMissing(
    task: WorkspaceTask,
    status: Status,
    signal: AbortSignal,
  ): Promise<Status | null>
  failureFor(status: Status, signal: AbortSignal): Promise<FailureView | null>
  // The retry for the failed side, or null when it cannot be sent again.
  retryPathOf(status: Status): string | null
  // Stops the task's stem if it has one. From the start of the stop the task
  // asks for nothing more, unless the stop fails.
  stop(taskId: string, signal: AbortSignal): Promise<void>
}

export function createTaskWork(client: HttpClient): TaskWork {
  const stemRequests = new Map<string, Set<Promise<unknown>>>()
  // The server goes on with a request the page stops waiting for, so a stem
  // request is sent without the read's signal.
  const untilAnswered = new AbortController().signal
  // Tasks being stopped or stopped; a stopped one does not come back
  // (PageTasks.markGone).
  const halted = new Set<string>()

  async function getStatus(taskId: string, signal: AbortSignal) {
    try {
      const { data } = await client.request(
        'GET',
        `/segments/${taskId}/processing-status`,
        { signal, read: readProcessingStatus },
      )
      return data
    } catch (error) {
      if (codeOf(error) === 'SEGMENT_NOT_FOUND') return null
      throw error
    }
  }

  function keepUntilAnswered(taskId: string, request: Promise<unknown>) {
    const pending = stemRequests.get(taskId) ?? new Set<Promise<unknown>>()
    pending.add(request)
    stemRequests.set(taskId, pending)
    const forget = () => {
      pending.delete(request)
      if (pending.size === 0 && stemRequests.get(taskId) === pending)
        stemRequests.delete(taskId)
    }
    request.then(forget, forget)
  }

  async function requestStem(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const request = client.request('POST', `/segments/${taskId}/stems`, {
      signal: untilAnswered,
      read: readStemCreated,
    })
    keepUntilAnswered(taskId, request)
    return (await untilAborted(request, signal)).data
  }

  // The status once more, to take the work already on its way, or null when
  // the segment is gone. One that cannot be read leaves the status as it was
  // for the next read.
  async function readAgain(
    taskId: string,
    status: Status,
    signal: AbortSignal,
  ): Promise<Status | null> {
    try {
      return await getStatus(taskId, signal)
    } catch (error) {
      if (signal.aborted || isSessionRejected(error)) throw error
      return status
    }
  }

  // The server makes a stem or a tab only when asked (B4): the stem once the
  // segment exists, the tab once the guitar is ready. A request that fails
  // leaves the status as it was, and the next read asks again. Of the
  // refusals only UNSUPPORTED_CONDITION would last, and the page asks only
  // for the condition GET /tabs/conditions answers. STEM_NOT_READY means the
  // range moved, which the next read follows.
  async function requestMissing(
    task: WorkspaceTask,
    status: Status,
    signal: AbortSignal,
  ): Promise<Status | null> {
    if (halted.has(task.id)) return status
    const tabRequest = tabRequestFor(task.tuningId)
    try {
      if (status.stem === null) {
        const data = await requestStem(task.id, signal)
        const stem = {
          stem_id: data.stem_id,
          status: data.status,
          current_stage: null,
          playable: false,
          retryable: false,
        }
        return { ...status, stem }
      }
      if (
        isWorkReady(status.stem.status) &&
        status.tab === null &&
        tabRequest
      ) {
        const { data } = await client.request(
          'POST',
          `/segments/${task.id}/tabs`,
          { signal, json: tabRequest, read: readTabCreated },
        )
        const tab = {
          tab_id: data.tab_id,
          status: data.status,
          current_stage: null,
          retryable: false,
        }
        return { ...status, tab }
      }
    } catch (error) {
      if (signal.aborted || isSessionRejected(error)) throw error
      if (ALREADY_RUNNING.has(codeOf(error)))
        return readAgain(task.id, status, signal)
    }
    return status
  }

  // The failed side's failure: the stem's, or the tab's after a ready stem.
  async function failureFor({ stem, tab }: Status, signal: AbortSignal) {
    const path =
      stem?.status === 'failed'
        ? `/stems/${stem.stem_id}`
        : stem && isWorkReady(stem.status) && tab?.status === 'failed'
          ? `/tabs/${tab.tab_id}`
          : null
    if (!path) return null
    const { data } = await client.request('GET', path, {
      signal,
      read: readWorkFailure,
    })
    return data.failure
  }

  function retryPathOf({ stem, tab }: Status): string | null {
    if (stem?.status === 'failed')
      return stem.retryable ? `/stems/${stem.stem_id}/retry` : null
    const tabFailed =
      stem && isWorkReady(stem.status) && tab?.status === 'failed'
    return tabFailed && tab.retryable ? `/tabs/${tab.tab_id}/retry` : null
  }

  // The stem requests sent before the stop are waited for, so the status
  // read next names their stem and the stop takes it too.
  async function stop(taskId: string, signal: AbortSignal) {
    halted.add(taskId)
    try {
      const pending = [...(stemRequests.get(taskId) ?? [])]
      await untilAborted(Promise.allSettled(pending), signal)
      const stem = (await getStatus(taskId, signal))?.stem
      if (stem && stem.status !== 'canceled')
        await client.request('POST', `/stems/${stem.stem_id}/cancel`, {
          signal,
          read: readCancel,
        })
    } catch (error) {
      halted.delete(taskId)
      throw error
    }
  }

  return { getStatus, requestMissing, failureFor, retryPathOf, stop }
}
