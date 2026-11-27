// The task half of the workspace http repository. A task is a segment
// (task id = segment_id); the server keeps its stem and tab apart, and this
// file shows them as one task (taskState.ts). The server lists the segments;
// the page keeps what the server does not, such as the part (PageTasks).

import { isSessionRejected, type HttpClient } from '../../api/http.ts'
import type { RemoteFiles } from '../../api/remoteFile.ts'
import { mapConcurrently, REQUESTS_AT_ONCE } from '../../shared/concurrency.ts'
import { scoreFromNotes } from '../tab/scoreFromNotes.ts'
import {
  canSendSectionEdit,
  sectionEditKind,
} from '../edit-section/sectionEdit.ts'
import { parseSectionName } from '../new-section/sectionForm.ts'
import type {
  SegmentCreateRequest,
  SegmentResponse,
  SegmentUpdateRequest,
} from './apiTypes.ts'
import { failureOf } from './httpErrors.ts'
import {
  ALREADY_RUNNING,
  codeOf,
  createTaskWork,
  NOTHING_REQUESTED,
  type Status,
} from './httpTaskWork.ts'
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
  readRetry,
  readSegment,
  readStemPlayback,
  readTabCreated,
  readTabResult,
  sectionNameOf,
  segmentNameValue,
  tabRequestFor,
  tabTranscriptionOf,
  toMilliseconds,
} from './taskAdapter.ts'
import {
  keptResult,
  newTaskLabels,
  RESTORED_TASK_LABELS,
} from './taskLabels.ts'
import { taskStateOf } from './taskState.ts'

const MESSAGES = {
  'task-unavailable': '작업을 찾을 수 없어요.',
  'load-failed': '작업을 불러오지 못했어요. 다시 시도해 주세요.',
  'create-task-failed': '작업을 만들지 못했어요.',
  'revise-task-failed': '타브를 다시 만들지 못했어요.',
  'retry-task-failed': '다시 시도하지 못했어요.',
  'cancel-task-failed': '작업을 멈추지 못했어요.',
  'audio-unavailable': '분리한 기타 음원을 불러오지 못했어요.',
  'tab-unavailable': '타브를 불러오지 못했어요.',
  'tab-missing': '타브를 찾을 수 없어요.',
} as const

type TaskFailureCode = keyof typeof MESSAGES

const refused = (code: TaskFailureCode) =>
  new WorkspaceRepositoryError(code, MESSAGES[code])

const failed = (code: TaskFailureCode, error: unknown) =>
  failureOf(code, MESSAGES[code], error)

// A segment from its track's list, with the song it belongs to.
export interface ListedSegment {
  readonly songId: string
  readonly segment: SegmentResponse
}

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
  // The listed segments and the page's tasks the list missed, in the order
  // they were made, without those stopped before it ends. A known task is
  // read again only while in progress or once its segment changed, and one
  // that fails to read keeps its last state. A segment the page has no
  // record of has none to keep, so its failed read fails the list, as do a
  // rejected session and a cancelled signal.
  list(
    listed: readonly ListedSegment[],
    signal: AbortSignal,
  ): Promise<WorkspaceTask[]>
}

interface ReadResult {
  readonly record: PageTask
  readonly detail: TaskDetail
}

// Why a read found no task. The server still lists a stopped segment, so
// the page leaves it out for good; one the server or the page does not
// have now may come back, as after another code's session took the cookie.
type Absence = 'stopped' | 'missing'

type SegmentTaskValues = Pick<
  WorkspaceTask,
  'songId' | 'sectionName' | 'part' | 'tuningId' | 'partLabel' | 'tuningLabel'
>

const keptResultId = (record: PageTask) =>
  `kept-${record.task.id}-${record.previousResults.length + 1}`

const byCreation = (a: WorkspaceTask, b: WorkspaceTask) =>
  Number(a.id) - Number(b.id)

// A segment changed since the page took it: a higher version for a new
// range, or the same one with a later time for a new name alone.
const isNewer = (segment: SegmentResponse, record: PageTask) =>
  segment.version > record.segmentVersion ||
  (segment.version === record.segmentVersion &&
    serverTime(segment.updated_at) > serverTime(record.segmentUpdatedAt))

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

  // A segment as a task waiting for its stem, before its status is read.
  function queuedRecord(
    segment: SegmentResponse,
    values: SegmentTaskValues,
  ): PageTask {
    return {
      task: {
        id: String(segment.segment_id),
        ...values,
        rangeStartSeconds: segment.start_ms / 1000,
        rangeEndSeconds: segment.end_ms / 1000,
        processingStatus: 'queued',
        failureKind: null,
        progressPercent: null,
        hasSeparatedAudio: false,
        comparisonCount: 0,
        copyStatus: 'unreviewed',
        updatedAtLabel: updatedAtLabel(segment.updated_at, clock()),
      },
      previousResults: [],
      stemId: null,
      tabId: null,
      updatedAt: segment.updated_at,
      segmentVersion: segment.version,
      segmentUpdatedAt: segment.updated_at,
    }
  }

  // A segment this page has no record of, as after entering the code again.
  // It shows the name without its number, and no part.
  function restoredRecord({ songId, segment }: ListedSegment): PageTask {
    return queuedRecord(segment, {
      songId,
      sectionName: sectionNameOf(segment.name),
      ...RESTORED_TASK_LABELS,
    })
  }

  // A segment changed since the page took it, as from another tab. The
  // range and name come from the server; the name keeps its number while
  // the server's name stands for the same section. A moved range starts
  // over as a revise on this page does, keeping the finished result (D10).
  function changedRecord(record: PageTask, segment: SegmentResponse): PageTask {
    const { task } = record
    const listedName = sectionNameOf(segment.name)
    const sameSection =
      parseSectionName(task.sectionName)?.baseName === listedName
    const moved =
      segment.start_ms !== toMilliseconds(task.rangeStartSeconds) ||
      segment.end_ms !== toMilliseconds(task.rangeEndSeconds)
    const renamed: PageTask = {
      ...record,
      task: {
        ...task,
        sectionName: sameSection ? task.sectionName : listedName,
        rangeStartSeconds: segment.start_ms / 1000,
        rangeEndSeconds: segment.end_ms / 1000,
      },
      updatedAt: segment.updated_at,
      segmentVersion: segment.version,
      segmentUpdatedAt: segment.updated_at,
    }
    if (!moved) return renamed
    const keepsResult = sectionEditKind(task) === 'revise'
    return {
      ...renamed,
      task: {
        ...renamed.task,
        processingStatus: 'queued',
        failureKind: null,
        progressPercent: null,
        hasSeparatedAudio: false,
        comparisonCount: keepsResult ? 0 : task.comparisonCount,
        copyStatus: keepsResult ? 'unreviewed' : task.copyStatus,
      },
      previousResults: keepsResult
        ? [keptResult(task, keptResultId(record)), ...record.previousResults]
        : record.previousResults,
      stemId: null,
      tabId: null,
    }
  }

  const work = createTaskWork(client)

  const isStopped = (taskId: string, status: Status) =>
    status.stem?.status === 'canceled' || tasks.isGone(taskId)

  // The task as the server has it now, or why it is gone: stopped, or
  // deleted, out of this session or its song no longer on this page. A
  // task stopped here while its status was on the way, as during a list,
  // asks for nothing more.
  async function read(
    record: PageTask,
    signal: AbortSignal,
    known?: Status,
  ): Promise<ReadResult | Absence> {
    const song = songOf(record.task.songId)
    if (!song) return 'missing'
    const fetched = known ?? (await work.getStatus(record.task.id, signal))
    if (!fetched) return 'missing'
    if (isStopped(record.task.id, fetched)) return 'stopped'
    const status = await work.requestMissing(record.task, fetched, signal)
    if (!status) return 'missing'
    // Also stopped while the request was on its way.
    if (isStopped(record.task.id, status)) return 'stopped'
    const failure = await work.failureFor(status, signal)
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
        // Also while a refused tab request waits for the next read.
        tabWaitsForPage: status.tab === null,
      },
    }
  }

  // A read that ends after the task changed or left must not bring back
  // the record it started from.
  function keep(before: PageTask, after: PageTask) {
    if (tasks.get(before.task.id) === before) tasks.put(after)
  }

  function drop(before: PageTask, absence: Absence) {
    if (tasks.get(before.task.id) !== before) return
    if (absence === 'stopped') tasks.markGone(before.task.id)
    else tasks.remove(before.task.id)
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
      if (typeof result !== 'string') {
        keep(record, result.record)
        return result.detail.task
      }
    } catch (error) {
      if (signal.aborted) throw error
      if (isSessionRejected(error)) throw failed('load-failed', error)
    }
    return { ...record.task }
  }

  async function loadTask(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    if (!record) throw refused('task-unavailable')
    try {
      const result = await read(record, signal)
      if (typeof result === 'string') {
        drop(record, result)
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
    // Once the segment exists the task does. Failing the create after it
    // would have the screen make a second segment for the same section.
    const record = queuedRecord(segment, {
      songId: input.songId,
      sectionName: input.sectionName,
      part: input.part,
      tuningId: input.tuningId,
      ...labels,
    })
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
    let { segmentVersion, segmentUpdatedAt } = record
    let reusedTab = false
    try {
      if (moved || renamed) {
        const { data } = await client.request('PATCH', `/segments/${taskId}`, {
          signal,
          json: body,
          read: readSegment,
        })
        range = { start: data.start_ms / 1000, end: data.end_ms / 1000 }
        segmentVersion = data.version
        segmentUpdatedAt = data.updated_at
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
        ? [keptResult(task, keptResultId(record)), ...record.previousResults]
        : record.previousResults,
      stemId: moved ? null : record.stemId,
      tabId: moved ? null : record.tabId,
      segmentVersion,
      segmentUpdatedAt,
    }
    return afterChange(revised, signal)
  }

  async function retryTask(taskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = tasks.get(taskId)
    if (!record) throw refused('task-unavailable')
    try {
      const status = await work.getStatus(taskId, signal)
      if (!status || status.stem?.status === 'canceled') {
        drop(record, status ? 'stopped' : 'missing')
        throw refused('task-unavailable')
      }
      const path = work.retryPathOf(status)
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
      await work.stop(taskId, signal)
    } catch (error) {
      if (signal.aborted) throw error
      throw failed('cancel-task-failed', error)
    }
    tasks.markGone(taskId)
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
  // resolves null, which the screen's check reports as a tab it cannot show;
  // a tab the server no longer has is one no retry brings back.
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
      throw failed(
        codeOf(error) === 'TAB_NOT_FOUND' ? 'tab-missing' : 'tab-unavailable',
        error,
      )
    }
  }

  async function refresh(
    record: PageTask,
    signal: AbortSignal,
  ): Promise<WorkspaceTask | null> {
    // A task no longer in progress is not read again, and one that cannot
    // be read keeps its last state; only their time label moves on.
    const relabeled = () => ({
      ...record.task,
      updatedAtLabel: updatedAtLabel(record.updatedAt, clock()),
    })
    if (!isTaskInProgress(record.task)) return relabeled()
    try {
      const result = await read(record, signal)
      if (typeof result === 'string') {
        drop(record, result)
        return null
      }
      keep(record, result.record)
      return result.record.task
    } catch (error) {
      if (signal.aborted || isSessionRejected(error)) throw error
      return relabeled()
    }
  }

  // Without a last state to show, a segment the page has no record of fails
  // the list when it cannot be read. One stopped stays gone; one deleted or
  // out of this session is left out of this list only.
  async function restore(
    listed: ListedSegment,
    signal: AbortSignal,
  ): Promise<WorkspaceTask | null> {
    const record = restoredRecord(listed)
    const taskId = record.task.id
    const result = await read(record, signal)
    if (typeof result === 'string') {
      if (result === 'stopped') tasks.markGone(taskId)
      return null
    }
    // Another list may have restored it meanwhile.
    if (!tasks.get(taskId) && !tasks.isGone(taskId)) tasks.put(result.record)
    return result.record.task
  }

  // A list sent before a change on this page holds an older segment and
  // leaves the task as the page has it.
  async function sync(
    listed: ListedSegment,
    signal: AbortSignal,
  ): Promise<WorkspaceTask | null> {
    const record = tasks.get(String(listed.segment.segment_id))
    if (!record) return restore(listed, signal)
    if (!isNewer(listed.segment, record)) return refresh(record, signal)
    const changed = changedRecord(record, listed.segment)
    try {
      const result = await read(changed, signal)
      if (typeof result === 'string') {
        drop(record, result)
        return null
      }
      keep(record, result.record)
      return result.record.task
    } catch (error) {
      if (signal.aborted || isSessionRejected(error)) throw error
      // The server has the change, so it shows as sent.
      keep(record, changed)
      return changed.task
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
    async list(listed, signal) {
      const listedIds = new Set(
        listed.map(({ segment }) => String(segment.segment_id)),
      )
      const jobs = [
        ...listed
          .filter(({ segment }) => !tasks.isGone(String(segment.segment_id)))
          .map((item) => () => sync(item, signal)),
        // Made on this page after the list was sent.
        ...tasks
          .list()
          .filter((record) => !listedIds.has(record.task.id))
          .map((record) => () => refresh(record, signal)),
      ]
      const synced = await mapConcurrently(jobs, REQUESTS_AT_ONCE, (job) =>
        job(),
      )
      // A task stopped on this page while the list was read.
      return synced
        .filter(
          (task): task is WorkspaceTask =>
            task !== null && !tasks.isGone(task.id),
        )
        .sort(byCreation)
        .map((task) => ({ ...task }))
    },
  }
}
