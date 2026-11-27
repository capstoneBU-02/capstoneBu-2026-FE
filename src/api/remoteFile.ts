// Files the backend hands over as short-lived signed storage URLs (stem
// playback). The URL goes to the storage, not the API, so no cookie is sent
// and the API envelope does not apply. Each key keeps its URL while it has
// time left; the bytes are not kept, so a long session does not pile up
// audio in memory (F13).

export interface SignedFile {
  readonly url: string
  // Epoch milliseconds; 0 when unknown, which never counts as time left.
  readonly expiresAt: number
}

// status 0: the storage gave no response, or its body broke off. The signed
// URL stays out of the message, as it grants access while it lasts.
export class RemoteFileError extends Error {
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RemoteFileError'
    this.status = status
  }
}

export interface RemoteFiles {
  // `sign` asks the API for a fresh URL; its failure is passed on as it is.
  fetch(
    key: string,
    signal: AbortSignal,
    sign: () => Promise<SignedFile>,
  ): Promise<Blob>
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export function createRemoteFiles({
  fetch = (input, init) => globalThis.fetch(input, init),
  now = Date.now,
  // A minute before expiry, so a download that starts late still finishes.
  marginMs = 60_000,
}: {
  fetch?: Fetch
  now?: () => number
  marginMs?: number
} = {}): RemoteFiles {
  const signedUrls = new Map<string, SignedFile>()

  async function download(url: string, signal: AbortSignal): Promise<Blob> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        signal,
      })
    } catch (error) {
      signal.throwIfAborted()
      throw new RemoteFileError(0, 'The storage gave no response.', {
        cause: error,
      })
    }
    if (!response.ok)
      throw new RemoteFileError(
        response.status,
        `The storage answered ${response.status}.`,
      )
    try {
      const blob = await response.blob()
      signal.throwIfAborted()
      return blob
    } catch (error) {
      signal.throwIfAborted()
      throw new RemoteFileError(0, 'The storage response broke off.', {
        cause: error,
      })
    }
  }

  async function signed(key: string, sign: () => Promise<SignedFile>) {
    signedUrls.delete(key)
    const file = await sign()
    signedUrls.set(key, file)
    return file
  }

  return {
    async fetch(key, signal, sign) {
      signal.throwIfAborted()
      const kept = signedUrls.get(key)
      const reusable = kept !== undefined && kept.expiresAt - now() > marginMs
      const file = reusable ? kept : await signed(key, sign)
      signal.throwIfAborted()
      try {
        return await download(file.url, signal)
      } catch (error) {
        // A download stopped by the page says nothing about its URL.
        if (signal.aborted) throw error
        signedUrls.delete(key)
        // A kept URL can be refused before its time (a clock apart, a key
        // revoked); signing once more tells that from a file that is gone.
        const refusedEarly =
          reusable && error instanceof RemoteFileError && error.status === 403
        if (!refusedEarly) throw error
      }
      const fresh = await signed(key, sign)
      signal.throwIfAborted()
      try {
        return await download(fresh.url, signal)
      } catch (error) {
        if (!signal.aborted) signedUrls.delete(key)
        throw error
      }
    },
  }
}
