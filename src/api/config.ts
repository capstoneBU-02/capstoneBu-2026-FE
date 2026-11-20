// The one place that reads the build's API settings (.env.example lists
// them). Vite inlines import.meta.env; node --test has none, so unit tests
// always see the defaults: mock repositories and the proxied path.

export type ApiMode = 'mock' | 'http'

export interface ApiConfig {
  readonly mode: ApiMode
  // A same-origin path or an absolute http(s) URL, without a trailing slash.
  readonly baseUrl: string
  // The session cookie rides along on the same origin by default. An API on
  // another origin has to ask for it.
  readonly credentials: RequestCredentials
}

export const DEFAULT_API_BASE = '/api/v1'

type Env = Readonly<Record<string, unknown>>

export function readApiConfig(env: Env | undefined): ApiConfig {
  const baseUrl = readBase(env?.VITE_API_BASE)
  return {
    mode: readMode(env?.VITE_API_MODE),
    baseUrl,
    credentials: baseUrl.startsWith('/') ? 'same-origin' : 'include',
  }
}

let current: ApiConfig | undefined

// Read on first use, so a bad setting surfaces where startup can show it.
export function apiConfig(): ApiConfig {
  current ??= readApiConfig(import.meta.env)
  return current
}

function readMode(value: unknown): ApiMode {
  if (value === undefined || value === '') return 'mock'
  if (value === 'mock' || value === 'http') return value
  throw new Error(
    `VITE_API_MODE must be "mock" or "http", not ${JSON.stringify(value)}.`,
  )
}

function readBase(value: unknown): string {
  if (value === undefined || value === '') return DEFAULT_API_BASE
  const base = typeof value === 'string' ? value.replace(/\/+$/, '') : ''
  if (/^\/[^/]/.test(base) || isPlainHttpUrl(base)) return base
  throw new Error(
    `VITE_API_BASE must be a path like ${DEFAULT_API_BASE} or an http(s) URL without a query, not ${JSON.stringify(value)}.`,
  )
}

function isPlainHttpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.search &&
    !url.hash
  )
}
