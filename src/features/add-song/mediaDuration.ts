// Reads a file's duration from media metadata without uploading it.
export type MediaDurationProbe = (
  file: Blob,
  signal: AbortSignal,
) => Promise<number>

export class MediaDurationError extends Error {
  readonly reason: 'unreadable' | 'timeout'

  constructor(reason: 'unreadable' | 'timeout') {
    super(
      reason === 'timeout'
        ? '파일 정보를 읽는 데 시간이 너무 오래 걸려요.'
        : '파일 정보를 읽을 수 없어요.',
    )
    this.name = 'MediaDurationError'
    this.reason = reason
  }
}

interface ProbeMedia extends EventTarget {
  preload: string
  src: string
  readonly duration: number
  removeAttribute(name: string): void
  load(): void
}

export interface ProbeEnvironment {
  createMedia(): ProbeMedia
  createObjectURL(file: Blob): string
  revokeObjectURL(url: string): void
}

// An <audio> element also reads MP4. Whether an MP4 has an audio track cannot
// be confirmed in every browser, so "plays" is the acceptance criterion.
const browserEnvironment: ProbeEnvironment = {
  createMedia: () => document.createElement('audio'),
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
}

function abortError() {
  return new DOMException('파일 확인이 취소되었습니다.', 'AbortError')
}

export function createMediaDurationProbe(
  timeoutMs: number,
  environment: ProbeEnvironment = browserEnvironment,
): MediaDurationProbe {
  return (file, signal) =>
    new Promise<number>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError())
        return
      }

      const url = environment.createObjectURL(file)
      const media = environment.createMedia()
      const timer = setTimeout(
        () => finish(() => reject(new MediaDurationError('timeout'))),
        timeoutMs,
      )

      // Every outcome detaches the file and revokes the URL exactly once.
      function finish(settle: () => void) {
        clearTimeout(timer)
        media.removeEventListener('loadedmetadata', loaded)
        media.removeEventListener('error', failed)
        signal.removeEventListener('abort', aborted)
        media.removeAttribute('src')
        media.load()
        environment.revokeObjectURL(url)
        settle()
      }
      function loaded() {
        // Detaching the source resets duration, so read it first.
        const seconds = media.duration
        finish(() => resolve(seconds))
      }
      function failed() {
        finish(() => reject(new MediaDurationError('unreadable')))
      }
      function aborted() {
        finish(() => reject(abortError()))
      }

      media.addEventListener('loadedmetadata', loaded)
      media.addEventListener('error', failed)
      signal.addEventListener('abort', aborted, { once: true })
      media.preload = 'metadata'
      media.src = url
      // Some mobile browsers ignore preload on an element outside the document.
      media.load()
    })
}
