import { createDemoSongAudio } from './demoSongAudio.ts'
import type { WorkspaceSong, WorkspaceTask } from './model.ts'
import { WorkspaceRepositoryError } from './repository.ts'

// Lets one caller stop waiting on shared work without cancelling it.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

function unavailable(): Promise<never> {
  return Promise.reject(
    new WorkspaceRepositoryError(
      'audio-unavailable',
      '음원을 불러오지 못했어요.',
    ),
  )
}

export interface MockAudio {
  // Added files live only in this session's memory for later playback (#16).
  keepFile(songId: string, file: File): void
  song(song: WorkspaceSong | undefined, signal: AbortSignal): Promise<Blob>
  // The guitar separated from the task's section, as long as the section.
  separated(task: WorkspaceTask | undefined, signal: AbortSignal): Promise<Blob>
}

// The audio one mock session serves. Fixture songs and separated guitars are
// synthesized once per session, like files the server keeps.
export function createMockAudio(): MockAudio {
  const files = new Map<string, File>()
  const demos = new Map<string, Promise<Blob>>()

  // Shared by every request for the same audio, so no caller cancels it.
  function demo(key: string, seconds: number, signal: AbortSignal) {
    let audio = demos.get(key)
    if (!audio) {
      audio = createDemoSongAudio(key, seconds, new AbortController().signal)
      demos.set(key, audio)
      audio.catch(() => demos.delete(key))
    }
    return untilAborted(audio, signal)
  }

  return {
    keepFile(songId, file) {
      files.set(songId, file)
    },
    song(song, signal) {
      if (!song) return unavailable()
      const file = files.get(song.id)
      return file
        ? Promise.resolve(file)
        : demo(song.id, song.durationSeconds, signal)
    },
    separated(task, signal) {
      if (!task?.hasSeparatedAudio) return unavailable()
      const { id, rangeStartSeconds: start, rangeEndSeconds: end } = task
      // A changed section is separated again, so it never reuses the old one.
      return demo(`${id}-guitar@${start}-${end}`, end - start, signal)
    },
  }
}
