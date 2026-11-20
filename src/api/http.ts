import { isRecord } from './guards.ts'

// The backend wraps every answer: { success: true, data, meta? } or
// { success: false, error: { code, message, details? }, meta: { trace_id } }.
// request() unwraps it and turns every failure into an ApiError, except
// cancellation, which stays the AbortError the screens already expect.
// It does not retry, time out, rename keys or redirect on 401; repositories
// map ApiError codes to their own errors.

export type HttpMethod = 'GET' | 'POST' | 'PATCH'

// Codes made here rather than by the server:
// NETWORK           no response at all (status 0)
// HTTP_<status>     an error status without the backend envelope (proxy, 404)
// INVALID_RESPONSE  a 2xx body that is not an envelope or fails `read`
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  // The server's trace id, or the one this request sent; the backend uses
  // the sent one, so both point at the same server log.
  readonly traceId: string

  constructor({
    status,
    code,
    message,
    details,
    traceId,
    cause,
  }: {
    status: number
    code: string
    message: string
    details?: unknown
    traceId: string
    cause?: unknown
  }) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.traceId = traceId
  }
}

export interface RequestOptions<T> {
  readonly signal: AbortSignal
  readonly json?: unknown
  readonly form?: FormData
  // Checks `data` before any adapter sees it; throwing marks the response
  // invalid.
  readonly read: (data: unknown) => T
}

export interface ApiResponse<T> {
  // Kept because some endpoints answer 200 for reused work and 202 for new.
  readonly status: number
  readonly data: T
}

export interface HttpClient {
  request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions<T>,
  ): Promise<ApiResponse<T>>
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export function createHttpClient({
  baseUrl,
  credentials,
  // Looked up per call, so tests and the browser can swap it.
  fetch = (input, init) => globalThis.fetch(input, init),
  createTraceId: nextTraceId = createTraceId,
}: {
  baseUrl: string
  credentials: RequestCredentials
  fetch?: Fetch
  createTraceId?: () => string
}): HttpClient {
  return {
    async request(method, path, { signal, json, form, read }) {
      if (!path.startsWith('/'))
        throw new TypeError(`API path must start with "/": ${path}`)
      if (json !== undefined && form !== undefined)
        throw new TypeError('Send either json or form, not both.')

      const traceId = nextTraceId()
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Trace-Id': traceId,
      }
      let body: string | FormData | undefined = form
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(json)
      }

      let status: number
      let text: string
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body,
          credentials,
          signal,
        })
        status = response.status
        text = await response.text()
      } catch (error) {
        // Whatever broke, a cancelled request ends as its abort reason.
        signal.throwIfAborted()
        throw new ApiError({
          status: 0,
          code: 'NETWORK',
          message: `${method} ${path} got no response.`,
          traceId,
          cause: error,
        })
      }
      // A late answer must not reach a screen that already moved on.
      signal.throwIfAborted()
      return unwrap(status, text, traceId, read)
    },
  }
}

function unwrap<T>(
  status: number,
  text: string,
  sentTraceId: string,
  read: (data: unknown) => T,
): ApiResponse<T> {
  const envelope = parseJson(text)
  const meta = isRecord(envelope) ? envelope.meta : undefined
  const traceId =
    isRecord(meta) && typeof meta.trace_id === 'string'
      ? meta.trace_id
      : sentTraceId
  const ok = status >= 200 && status < 300

  if (isRecord(envelope) && envelope.success === false) {
    const error = envelope.error
    if (isRecord(error) && typeof error.code === 'string') {
      throw new ApiError({
        status,
        code: error.code,
        message: typeof error.message === 'string' ? error.message : error.code,
        details: error.details,
        traceId,
      })
    }
  }
  if (!ok) {
    throw new ApiError({
      status,
      code: `HTTP_${status}`,
      message: `The server answered ${status} without a usable error.`,
      traceId,
    })
  }
  if (!isRecord(envelope) || envelope.success !== true) {
    throw new ApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: 'The response is not an API envelope.',
      traceId,
    })
  }
  try {
    return { status, data: read(envelope.data) }
  } catch (error) {
    throw new ApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: error instanceof Error ? error.message : 'Unreadable data.',
      traceId,
      cause: error,
    })
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// 16 hex digits like the backend's own ids. getRandomValues also works on a
// plain-http LAN address, where crypto.randomUUID is missing.
export function createTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

// The server failure behind a repository error, for logs and bug reports.
export function apiErrorOf(error: unknown): ApiError | null {
  const seen = new Set<unknown>()
  let current = error
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof ApiError) return current
    seen.add(current)
    current = current.cause
  }
  return null
}
