import { isSessionRejected, type HttpClient } from '../../api/http.ts'
import { readWorkspaceMe } from './adapter.ts'
import type {
  ConsentChoice,
  SavedConsentChoice,
  WorkspaceInfo,
} from './model.ts'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from './repository.ts'

type FailureCode = WorkspaceRepositoryError['code']

// Consent has no API yet. The access repository keeps it for this page, and
// onboarding and the settings dialog both change the same record.
export interface LocalConsent {
  read(): ConsentChoice
  save(choice: SavedConsentChoice): void
}

const EXPIRED_MESSAGE = '작업 공간 이용 기간이 끝났어요.'
const LOAD_FAILED_MESSAGE = '작업 목록을 불러오지 못했어요. 다시 시도해 주세요.'

// The workspace API so far: the session check. Songs, tasks, audio and tabs
// fail with each method's own code until their APIs are connected.
export function createHttpWorkspaceRepository({
  client,
  workspace,
  consent,
}: {
  client: HttpClient
  workspace: WorkspaceInfo
  consent: LocalConsent
}): WorkspaceRepository {
  return {
    async loadWorkspace(signal) {
      let workspaceId: number
      try {
        const { data } = await client.request('GET', '/workspaces/me', {
          signal,
          read: readWorkspaceMe,
        })
        workspaceId = data.workspace_id
      } catch (error) {
        if (signal.aborted) throw error
        throw isSessionRejected(error)
          ? new WorkspaceRepositoryError('expired', EXPIRED_MESSAGE, {
              cause: error,
            })
          : new WorkspaceRepositoryError('load-failed', LOAD_FAILED_MESSAGE, {
              cause: error,
            })
      }
      // Entering another code in another tab replaces the session cookie, so
      // this page would act on a different workspace.
      if (String(workspaceId) !== workspace.id)
        throw new WorkspaceRepositoryError('expired', EXPIRED_MESSAGE)
      // Without a list API every load starts empty.
      return {
        workspace: { ...workspace },
        songs: [],
        tasks: [],
        consentChoice: consent.read(),
      }
    },
    async saveConsent(choice, signal) {
      signal.throwIfAborted()
      consent.save(choice)
      return choice
    },
    loadTask: () => notConnected('task-unavailable'),
    addSong: () => notConnected('add-song-failed'),
    createTask: () => notConnected('create-task-failed'),
    reviseTask: () => notConnected('revise-task-failed'),
    cancelTask: () => notConnected('cancel-task-failed'),
    retryTask: () => notConnected('retry-task-failed'),
    loadSongAudio: () => notConnected('audio-unavailable'),
    loadSeparatedAudio: () => notConnected('audio-unavailable'),
    loadTab: () => notConnected('tab-unavailable'),
    saveCopyStatus: () => notConnected('copy-status-failed'),
  }
}

async function notConnected(code: FailureCode): Promise<never> {
  throw new WorkspaceRepositoryError(
    code,
    '아직 API에 연결하지 않은 기능이에요.',
  )
}
