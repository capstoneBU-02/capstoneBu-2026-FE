import { apiErrorOf, type HttpClient } from '../../api/http.ts'
import { createRemoteFiles, type RemoteFiles } from '../../api/remoteFile.ts'
import { mapConcurrently, REQUESTS_AT_ONCE } from '../../shared/concurrency.ts'
import { songUploadFile } from '../add-song/songFile.ts'
import {
  readTrackList,
  readTrackUpload,
  readWorkspaceMe,
  toWorkspaceSong,
} from './adapter.ts'
import { expiredError, failureOf } from './httpErrors.ts'
import { createHttpTasks, type ListedSegment } from './httpTasks.ts'
import { readSegmentList } from './taskAdapter.ts'
import type {
  ConsentChoice,
  SavedConsentChoice,
  WorkspaceInfo,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'
import { createPageTasks, type PageTasks } from './pageTasks.ts'
import {
  WorkspaceRepositoryError,
  type AddSongFailureCode,
  type WorkspaceRepository,
} from './repository.ts'

type FailureCode = WorkspaceRepositoryError['code']

// Consent has no API yet. The access repository keeps it for this page, and
// onboarding and the settings dialog both change the same record.
export interface LocalConsent {
  read(): ConsentChoice
  save(choice: SavedConsentChoice): void
}

// The workspace's songs as the server last listed them, with the files of
// those uploaded from this page. Without an audio API the chosen file stands
// in for the song's audio, so only those play. The access repository keeps
// one per workspace, so entering the same code again keeps the files until
// the page reloads.
export interface PageSongs {
  list(): readonly WorkspaceSong[]
  add(song: WorkspaceSong, file: File): void
  // Takes the server's songs. One uploaded while the list was on its way is
  // not in it yet and stays; the page cannot delete a song.
  sync(listed: readonly WorkspaceSong[]): void
  fileOf(songId: string): File | undefined
}

// Track ids grow, so this is the order the songs were added in.
const byAdded = (a: WorkspaceSong, b: WorkspaceSong) =>
  Number(a.id) - Number(b.id)

export function createPageSongs(): PageSongs {
  let songs: readonly WorkspaceSong[] = []
  const files = new Map<string, File>()
  return {
    list: () => songs,
    add(song, file) {
      songs = [...songs.filter((item) => item.id !== song.id), song]
      files.set(song.id, file)
    },
    sync(listed) {
      const listedIds = new Set(listed.map((song) => song.id))
      songs = [
        ...listed,
        ...songs.filter((song) => !listedIds.has(song.id)),
      ].sort(byAdded)
    },
    fileOf: (songId) => files.get(songId),
  }
}

const LOAD_FAILED_MESSAGE = '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.'

// The server's reasons for refusing an upload. HTTP_413 is a proxy's own
// body limit, which arrives without the backend envelope.
const UPLOAD_REFUSALS: Readonly<Record<string, AddSongFailureCode>> = {
  UNSUPPORTED_FORMAT: 'song-unsupported',
  DURATION_EXCEEDED: 'song-too-long',
  FILE_TOO_LARGE: 'song-too-large',
  HTTP_413: 'song-too-large',
  STORAGE_LIMIT_EXCEEDED: 'storage-full',
}

const ADD_SONG_MESSAGES: Readonly<Record<AddSongFailureCode, string>> = {
  'song-unsupported': '서버가 처리할 수 없는 파일이에요.',
  'song-too-long': '허용 길이를 넘는 파일이에요.',
  'song-too-large': '허용 용량을 넘는 파일이에요.',
  'storage-full': '작업 공간의 저장 한도를 모두 사용했어요.',
  'add-song-failed': '곡을 추가하지 못했어요.',
}

function addSongError(error: unknown): WorkspaceRepositoryError {
  const code =
    UPLOAD_REFUSALS[apiErrorOf(error)?.code ?? ''] ?? 'add-song-failed'
  return failureOf(code, ADD_SONG_MESSAGES[code], error)
}

// The workspace API so far: the session check, the song and section lists,
// song upload, tasks with their separated guitar and tab. The copy status
// fails with its own code until its API is connected.
export function createHttpWorkspaceRepository({
  client,
  workspace,
  consent,
  songs,
  tasks = createPageTasks(),
  files = createRemoteFiles(),
  clock = () => new Date(),
}: {
  client: HttpClient
  workspace: WorkspaceInfo
  consent: LocalConsent
  songs: PageSongs
  tasks?: PageTasks
  files?: RemoteFiles
  clock?: () => Date
}): WorkspaceRepository {
  const work = createHttpTasks({ client, songs, tasks, files, clock })

  // The sections of each song that has any.
  async function listSegments(signal: AbortSignal): Promise<ListedSegment[]> {
    const { data } = await client.request('GET', '/tracks', {
      signal,
      read: readTrackList,
    })
    songs.sync(data.items.map(toWorkspaceSong))
    const lists = await mapConcurrently(
      data.items.filter((track) => track.segment_count > 0),
      REQUESTS_AT_ONCE,
      async ({ track_id }) => {
        const { data: segments } = await client.request(
          'GET',
          `/tracks/${track_id}/segments`,
          { signal, read: readSegmentList },
        )
        return segments.items.map((segment) => ({
          songId: String(track_id),
          segment,
        }))
      },
    )
    return lists.flat()
  }

  return {
    async loadWorkspace(signal) {
      let listed: WorkspaceTask[]
      try {
        const { data } = await client.request('GET', '/workspaces/me', {
          signal,
          read: readWorkspaceMe,
        })
        // Entering another code in another tab replaces the session cookie,
        // so this page would act on a different workspace.
        if (String(data.workspace_id) !== workspace.id) throw expiredError()
        listed = await work.list(await listSegments(signal), signal)
      } catch (error) {
        if (signal.aborted) throw error
        throw failureOf('load-failed', LOAD_FAILED_MESSAGE, error)
      }
      return {
        workspace: { ...workspace },
        songs: songs.list().map((song) => ({ ...song })),
        tasks: listed,
        consentChoice: consent.read(),
      }
    },
    async saveConsent(choice, signal) {
      signal.throwIfAborted()
      consent.save(choice)
      return choice
    },
    async addSong(input, signal, onProgress) {
      const form = new FormData()
      form.append('file', songUploadFile(input.file))
      form.append(
        'is_separated_stem',
        String(input.inputKind === 'separated-guitar'),
      )
      let song: WorkspaceSong
      try {
        const { data } = await client.request('POST', '/tracks/upload', {
          signal,
          form,
          read: readTrackUpload,
          onUploadProgress: onProgress,
        })
        song = toWorkspaceSong(data)
      } catch (error) {
        if (signal.aborted) throw error
        throw addSongError(error)
      }
      songs.add(song, input.file)
      return { ...song }
    },
    async loadSongAudio(songId, signal) {
      signal.throwIfAborted()
      const file = songs.fileOf(songId)
      if (!file)
        throw new WorkspaceRepositoryError(
          'audio-unavailable',
          '이 페이지에서 올린 곡만 들을 수 있어요.',
        )
      return file
    },
    loadTask: work.loadTask,
    createTask: work.createTask,
    reviseTask: work.reviseTask,
    cancelTask: work.cancelTask,
    retryTask: work.retryTask,
    loadSeparatedAudio: work.loadSeparatedAudio,
    loadTab: work.loadTab,
    saveCopyStatus: () => notConnected('copy-status-failed'),
  }
}

async function notConnected(code: FailureCode): Promise<never> {
  throw new WorkspaceRepositoryError(
    code,
    '아직 API에 연결하지 않은 기능이에요.',
  )
}
