// XMLHttpRequest for a request whose upload progress a screen shows: fetch
// reports none. request() picks it when given onUploadProgress, and both
// paths end in the same unwrap, so callers see the same ApiError either way.

export type CreateXhr = () => XMLHttpRequest

export interface XhrRequest {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: FormData
  readonly credentials: RequestCredentials
  readonly signal: AbortSignal
  readonly onProgress: (percent: number) => void
}

export interface RawResponse {
  readonly status: number
  readonly text: string
}

// Rejects with the signal's reason when cancelled and with a TypeError, as
// fetch does, when no answer came back.
export function sendXhr(
  createXhr: CreateXhr,
  { method, url, headers, body, credentials, signal, onProgress }: XhrRequest,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const xhr = createXhr()
    let reported = -1
    let settled = false
    const report = (percent: number) => {
      if (settled || percent <= reported) return
      reported = percent
      onProgress(percent)
    }
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      finish()
    }
    const cancel = () => {
      settle(() => reject(signal.reason))
      xhr.abort()
    }

    xhr.open(method, url)
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value)
    }
    // The cookie rides along on the same origin regardless; another origin
    // has to ask for it, as fetch's credentials: 'include' does.
    xhr.withCredentials = credentials === 'include'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        report(uploadPercent(event.loaded, event.total))
    }
    // The last progress event may not carry a length, so the end of the
    // upload says 100 on its own.
    xhr.upload.onload = () => report(100)
    xhr.onload = () =>
      settle(() => resolve({ status: xhr.status, text: xhr.responseText }))
    xhr.onerror = () =>
      settle(() => reject(new TypeError(`${method} ${url} failed.`)))
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => settle(() => reject(signal.reason))
    signal.addEventListener('abort', cancel, { once: true })
    xhr.send(body)
  })
}

export function uploadPercent(loaded: number, total: number): number {
  return Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)))
}
