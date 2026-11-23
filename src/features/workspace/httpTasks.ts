// The task half of the workspace http repository. A task is a segment
// (task id = segment_id); the server keeps its stem and tab apart, and this
// file shows them as one task (taskState.ts). Without a list API (B1) the
// page knows only the tasks it made (PageTasks).

import {
  apiErrorOf,
  isSessionRejected,
  type HttpClient,
} from '../../api/http.ts'
import type { RemoteFiles } from '../../api/remoteFile.ts'
import { scoreFromNotes } from '../tab/scoreFromNotes.ts'
import {
  canSendSectionEdit,
  sectionEditKind,
} from '../edit-section/sectionEdit.ts'
import type {
  FailureView,
  ProcessingStatusResponse,
  SegmentCreateRequest,
  SegmentUpdateRequest,
} from './apiTypes.ts'
import { failureOf } from './httpErrors.ts'
import { isTaskInProgress, serverTime, updatedAtLabel } from './format.ts'
import type { PageSongs } from './httpRepository.ts'
import type {
  NewTaskInput,
  ReviseTaskInput,
  TaskDetail,
  WorkspaceTask,
} from './model.ts'
import type { PageTask, PageTasks } from './pageTasks.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'
import {
  readCancel,
  readProcessingStatus,
  readRetry,
  readSegment,
  readStemCreated,
  readStemPlayback,
  readTabCreated,
  readTabResult,
  readWorkFailure,
  segmentNameValue,
  tabRequestFor,
  tabTranscriptionOf,
  toMilliseconds,
} from './taskAdapter.ts'
import { keptResult, newTaskLabels } from './taskLabels.ts'
import { isWorkReady, taskStateOf } from './taskState.ts'

const MESSAGES = {
  'task-unavailable': '작업을 찾을 수 없어요.',
  'load-failed': '작업을 불러오지 못했어요. 다시 시도해 주세요.',
  'create-task-failed': '작업을 만들지 못했어요.',
  'revise-task-failed': '타브를 다시 만들지 못했어요.',
  'retry-task-failed': '다시 시도하지 못했어요.',
  'cancel-task-failed': '작업을 멈추지 못했어요.',
  'audio-unavailable': '분리한 기타 음원을 불러오지 못했어요.',
  'tab-unavailable': '타브를 불러오지 못했어요.',
} as const

type TaskFailureCode = keyof typeof MESSAGES

const refused = (code: TaskFailureCode) =>
  new WorkspaceRepositoryError(code, MESSAGES[code])

const failed = (code: TaskFailureCode, error: unknown) =>
  failureOf(code, MESSAGES[code], error)

type Status = Pick<ProcessingStatusResponse, 'stem' | 'tab' | 'updated_at'>

// A new segment has neither; createTask passes this instead of reading it.
const NOTHING_REQUESTED: Status = { stem: null, tab: null, updated_at: null }

// Another tab or an earlier request already started the same work.
const ALREADY_RUNNING: ReadonlySet<string> = new Set([
  'STEM_IN_PROGRESS',
  'TAB_IN_PROGRESS',
])

const codeOf = (error: unknown) => apiErrorOf(error)?.code ?? ''

export type HttpTasks = Pick<
  WorkspaceRepository,
  | 'loadTask'
  | 'createTask'
  | 'reviseTask'
  | 'cancelTask'
  | 'retryTask'
  | 'loadSeparatedAudio'
  | 'loadTab'
> & {
  // The page's tasks for the list, reading those in progress again. Throws
  // only for a rejected session or a cancelled signal; a task that fails
  // to read keeps its last state.
  list(signal: AbortSignal): Promise<WorkspaceTask[]>
}

interface ReadResult {
  readonly record: PageTask
  readonly detail: TaskDetail
}

export function createHttpTasks({
  client,
  songs,
  tasks,
  files,
  clock,
}: {
  client: HttpClient
  songs: PageSongs
  tasks: PageTasks
  files: RemoteFiles
  clock: () => Date
}): HttpTasks {
  const songOf = (songId: string) =>
    songs.list().find((song) => song.id === songId)

  async function getStatus(
    taskId: string,
    signal: AbortSignal,
  ): Promise<Status | null> {
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

  // The server makes a stem or a tab only when asked (B4): the stem once the
  // segment exists, the tab once the guitar is ready. A request that fails
  // leaves the status as it was, and the next read asks again.
  async function requestMissing(
    task: WorkspaceTask,
    status: Status,
    signal: AbortSignal,
  ): Promise<Status> {
    const tabRequest = tabRequestFor(task.tuningId)
    try {
      if (status.stem === null) {
        const { data } = await client.request(
          'POST',
          `/segments/${task.id}/stems`,
          { signal, read: readStemCreated },
        )
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
    }
    return status
  }

  // The failed side's failure: the stem's, or the tab's after a ready stem.
  async function failureFor(
    { stem, tab }: Status,
    signal: AbortSignal,
  ): Promise<FailureView | null> {
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

  // The task as the server has it now, or null once it is gone: deleted,
  // cancelled, or its song no longer on this page.
  async function read(
    record: PageTask,
    signal: AbortSignal,
    known?: Status,
  ): Promise<ReadResult | null> {
    const song = songOf(record.task.songId)
    if (!song) return null
    const fetched = known ?? (await getStatus(record.task.id, signal))
    if (!fetched || fetched.stem?.status === 'canceled') return null
    const status = await requestMissing(record.task, fetched, signal)
    const failure = await failureFor(status, signal)
    const updatedAt = status.updated_at ?? record.updatedAt
    const state = taskStateOf({
      task: record.task,
      status,
      failure,
      inputKind: song.inputKind,
      updatedAtLabel: updatedAtLabel(updatedAt, clock()),
    })
    const next: PageTask = {
      ...record,
      task: state.task,
      stemId: status.stem?.stem_id ?? null,
      tabId: status.tab?.tab_id ?? null,
      updatedAt,
    }
    return {
      record: next,
      detail: {
        task: { ...state.task },
        song: { ...song },
        previousResults: next.previousResults.map((result) => ({ ...result })),
        stages: state.stages,
        queueAhead: null,
        retry: state.retry,
      },
    }
  }

  // A read that ends after the task changed or left must not bring back
  // the record it started from.
  function keep(before: PageTask, after: PageTask) {
    if (tasks.get(before.task.id) === before) tasks.put(after)
  }

  function drop(before: PageTask) {
    if (tasks.get(before.task.id) === before) tasks.remove(before.task.id)
  }

  // The server took the change, so a read that fails cannot undo it: the
  // task comes back as sent, and the next read shows the rest.
  async function afterChange(
    record: PageTask,
    signal: AbortSignal,
    known?: Status,
  ): Promise<WorkspaceTask> {
    tasks.put(record)
    try {
      const result = await read(record, signal, known)
      if (result) {
        keep(record, result.record)
        return result.detail.task
      }
    } catch (error) {
      if (signal.aborted) throw error
      if (isSessionRejected(error)) throw failed('load-failed', error)
    }
    return { ...record.task }
  }

  function retryPathOf({ stem, tab }: Status): string | null {
    if (stem?.status === 'failed')
      return stem.retryable ? `/stems/${stem.stem_id}/retry` : null
    const tabFailed =
      stem && isWorkReady(stem.status) && tab?.status === 'failed'
    return tabFailed && tab.retryable ? `/tabs/${tab.tab_id}/retry` : null
  }

  async function loadTask(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    if (!record) throw refused('task-unavailable')
    try {
      const result = await read(record, signal)
      if (!result) {
        drop(record)
        throw refused('task-unavailable')
      }
      keep(record, result.record)
      return result.detail
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('load-failed', error)
    }
  }

  async function createTask(input: NewTaskInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const labels = newTaskLabels(input, songOf(input.songId))
    if (!labels || !tabRequestFor(input.tuningId))
      throw refused('create-task-failed')
    const name = segmentNameValue(input.sectionName)
    const body: SegmentCreateRequest = {
      start_ms: toMilliseconds(input.rangeStartSeconds),
      end_ms: toMilliseconds(input.rangeEndSeconds),
      ...(name && { name }),
    }
    let segment
    try {
      ;({ data: segment } = await client.request(
        'POST',
        `/tracks/${input.songId}/segments`,
        { signal, json: body, read: readSegment },
      ))
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('create-task-failed', error)
    }
    const task: WorkspaceTask = {
      id: String(segment.segment_id),
      songId: input.songId,
      sectionName: input.sectionName,
      part: input.part,
      tuningId: input.tuningId,
      ...labels,
      rangeStartSeconds: segment.start_ms / 1000,
      rangeEndSeconds: segment.end_ms / 1000,
      processingStatus: 'queued',
      failureKind: null,
      progressPercent: null,
      hasSeparatedAudio: false,
      comparisonCount: 0,
      copyStatus: 'unreviewed',
      updatedAtLabel: updatedAtLabel(segment.updated_at, clock()),
    }
    // Once the segment exists the task does. Failing the create after it
    // would have the screen make a second segment for the same section.
    const record: PageTask = {
      task,
      previousResults: [],
      stemId: null,
      tabId: null,
      updatedAt: segment.updated_at,
    }
    return afterChange(record, signal, NOTHING_REQUESTED)
  }

  async function reviseTask(
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    if (!record) throw refused('task-unavailable')
    const { task } = record
    const labels = newTaskLabels(
      { ...input, songId: task.songId },
      songOf(task.songId),
    )
    const kind = sectionEditKind(task)
    const tabRequest = tabRequestFor(input.tuningId)
    if (!labels || !kind || !tabRequest || !canSendSectionEdit(task, input))
      throw refused('revise-task-failed')

    const startMs = toMilliseconds(input.rangeStartSeconds)
    const endMs = toMilliseconds(input.rangeEndSeconds)
    const moved =
      startMs !== toMilliseconds(task.rangeStartSeconds) ||
      endMs !== toMilliseconds(task.rangeEndSeconds)
    // The server cannot clear a name or hold a number, so a name it lacks
    // or the same name with another number stays on the screen alone.
    const name = segmentNameValue(input.sectionName)
    const renamed =
      name !== undefined && name !== segmentNameValue(task.sectionName)
    const body: SegmentUpdateRequest = {
      ...(moved && { start_ms: startMs, end_ms: endMs }),
      ...(renamed && { name }),
    }

    let range = { start: task.rangeStartSeconds, end: task.rangeEndSeconds }
    let reusedTab = false
    try {
      if (moved || renamed) {
        const { data } = await client.request('PATCH', `/segments/${taskId}`, {
          signal,
          json: body,
          read: readSegment,
        })
        range = { start: data.start_ms / 1000, end: data.end_ms / 1000 }
      }
      // A moved range gets a new stem on the next read; the same range
      // makes its tab again from the guitar it has.
      if (!moved) {
        const { data } = await client.request(
          'POST',
          `/segments/${taskId}/tabs`,
          { signal, json: tabRequest, read: readTabCreated },
        )
        reusedTab = data.is_reused && data.tab_id === record.tabId
      }
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('revise-task-failed', error)
    }

    // The finished result becomes a previous result (D10), unless the
    // server handed back the same tab: the part is not sent, so a new part
    // alone makes the same tab. A section without guitar had none.
    const keepsResult = kind === 'revise' && !reusedTab
    const revised: PageTask = {
      ...record,
      task: {
        ...task,
        sectionName: input.sectionName,
        part: input.part,
        tuningId: input.tuningId,
        ...labels,
        rangeStartSeconds: range.start,
        rangeEndSeconds: range.end,
        processingStatus: 'queued',
        failureKind: null,
        progressPercent: null,
        hasSeparatedAudio: !moved && task.hasSeparatedAudio,
        comparisonCount: keepsResult ? 0 : task.comparisonCount,
        copyStatus: keepsResult ? 'unreviewed' : task.copyStatus,
      },
      previousResults: keepsResult
        ? [
            keptResult(
              task,
              `kept-${taskId}-${record.previousResults.length + 1}`,
            ),
            ...record.previousResults,
          ]
        : record.previousResults,
      stemId: moved ? null : record.stemId,
      tabId: moved ? null : record.tabId,
    }
    return afterChange(revised, signal)
  }

  async function retryTask(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    if (!record) throw refused('task-unavailable')
    try {
      const status = await getStatus(taskId, signal)
      if (!status || status.stem?.status === 'canceled') {
        drop(record)
        throw refused('task-unavailable')
      }
      const path = retryPathOf(status)
      if (!path) throw refused('retry-task-failed')
      try {
        await client.request('POST', path, { signal, read: readRetry })
      } catch (error) {
        if (!ALREADY_RUNNING.has(codeOf(error))) throw error
      }
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('retry-task-failed', error)
    }
    const current = tasks.get(taskId) ?? record
    return afterChange(
      {
        ...current,
        task: {
          ...current.task,
          processingStatus: 'queued',
          failureKind: null,
        },
      },
      signal,
    )
  }

  // The server stops a stem only while it waits in the queue (T10). A task
  // with no stem, or none left, just leaves the page.
  async function cancelTask(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    if (!tasks.get(taskId)) throw refused('task-unavailable')
    try {
      const stem = (await getStatus(taskId, signal))?.stem
      if (stem && stem.status !== 'canceled')
        await client.request('POST', `/stems/${stem.stem_id}/cancel`, {
          signal,
          read: readCancel,
        })
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('cancel-task-failed', error)
    }
    tasks.remove(taskId)
  }

  // The storage needs CORS for the page's origin before this plays in a
  // browser (B2).
  async function loadSeparatedAudio(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    const stemId = record?.stemId
    if (!record?.task.hasSeparatedAudio || stemId == null)
      throw refused('audio-unavailable')
    try {
      return await files.fetch(`stem-${stemId}-guitar`, signal, async () => {
        const { data } = await client.request(
          'GET',
          `/stems/${stemId}/playback`,
          { signal, read: readStemPlayback },
        )
        const guitar = data.tracks.find(
          (track) => track.type === 'guitar' && track.available,
        )
        if (!guitar?.url) throw refused('audio-unavailable')
        return { url: guitar.url, expiresAt: serverTime(data.expires_at) || 0 }
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('audio-unavailable', error)
    }
  }

  // The result's notes turned into bars. A result with nothing to draw
  // resolves null, which the screen's check reports as a tab it cannot show.
  async function loadTab(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    const tabId = record?.tabId
    if (record?.task.processingStatus !== 'completed' || tabId == null)
      throw refused('tab-unavailable')
    try {
      const { data } = await client.request('GET', `/tabs/${tabId}/result`, {
        signal,
        read: readTabResult,
      })
      return scoreFromNotes(tabTranscriptionOf(data))
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('tab-unavailable', error)
    }
  }

  async function refresh(
    record: PageTask,
    signal: AbortSignal,
  ): Promise<WorkspaceTask | null> {
    if (!isTaskInProgress(record.task)) return record.task
    try {
      const result = await read(record, signal)
      if (!result) {
        drop(record)
        return null
      }
      keep(record, result.record)
      return result.record.task
    } catch (error) {
      if (signal.aborted || isSessionRejected(error)) throw error
      return record.task
    }
  }

  return {
    loadTask,
    createTask,
    reviseTask,
    retryTask,
    cancelTask,
    loadSeparatedAudio,
    loadTab,
    async list(signal) {
      const listed = await Promise.all(
        tasks.list().map((record) => refresh(record, signal)),
      )
      return listed
        .filter((task): task is WorkspaceTask => task !== null)
        .map((task) => ({ ...task }))
    },
  }
}
