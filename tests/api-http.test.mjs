import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readObject, ResponseShapeError } from '../src/api/guards.ts'
import {
  ApiError,
  apiErrorOf,
  createHttpClient,
  createTraceId,
} from '../src/api/http.ts'
import {
  fakeFetch,
  fixtureResponse,
  jsonResponse,
  pendingFetch,
  textResponse,
} from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const readStatus = (data) => readObject(data).string('status')

function client(fetch, overrides = {}) {
  let next = 0
  return createHttpClient({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
    fetch,
    createTraceId: () => `trace-${++next}`,
    ...overrides,
  })
}

function apiError(expected) {
  return (error) => {
    assert.ok(error instanceof ApiError, `not an ApiError: ${error}`)
    assert.equal(error.name, 'ApiError')
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(error[key], value, key)
    }
    return true
  }
}

test('a success envelope hands only its data to the reader, with the status', async () => {
  const { fetch, calls } = fakeFetch(() =>
    fixtureResponse(200, 'common/health.json'),
  )
  const controller = new AbortController()
  const response = await client(fetch).request('GET', '/health', {
    signal: controller.signal,
    read: readStatus,
  })
  assert.deepEqual(response, { status: 200, data: 'ok' })
  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url, '/api/v1/health')
  assert.equal(init.method, 'GET')
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.signal, controller.signal)
  assert.equal(init.body, undefined)
  assert.deepEqual(init.headers, {
    Accept: 'application/json',
    'X-Trace-Id': 'trace-1',
  })
})

test('the status tells a reused result (200) from new work (202)', async () => {
  const { fetch } = fakeFetch(() =>
    jsonResponse(202, { success: true, data: { status: 'queued' } }),
  )
  const response = await client(fetch).request('POST', '/segments/s-1/tabs', {
    signal: signal(),
    json: {},
    read: readStatus,
  })
  assert.deepEqual(response, { status: 202, data: 'queued' })
})

test('json bodies are serialized as is; form bodies keep their own boundary', async () => {
  const { fetch, calls } = fakeFetch(() =>
    jsonResponse(200, { success: true, data: { status: 'ok' } }),
  )
  const http = client(fetch)
  await http.request('PATCH', '/segments/s-1', {
    signal: signal(),
    json: { start_ms: 1000, name: null },
    read: readStatus,
  })
  const form = new FormData()
  form.set('is_separated_stem', 'false')
  await http.request('POST', '/tracks/upload', {
    signal: signal(),
    form,
    read: readStatus,
  })
  assert.equal(calls[0].init.method, 'PATCH')
  assert.equal(calls[0].init.body, '{"start_ms":1000,"name":null}')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[1].init.body, form)
  assert.equal(calls[1].init.headers['Content-Type'], undefined)
  assert.deepEqual(
    calls.map(({ init }) => init.headers['X-Trace-Id']),
    ['trace-1', 'trace-2'],
    'every request carries its own trace id',
  )
})

test('a caller mistake fails before anything is sent', async () => {
  const { fetch, calls } = fakeFetch(() => assert.fail('sent'))
  const http = client(fetch)
  await assert.rejects(
    http.request('GET', 'health', { signal: signal(), read: readStatus }),
    TypeError,
  )
  await assert.rejects(
    http.request('POST', '/x', {
      signal: signal(),
      json: {},
      form: new FormData(),
      read: readStatus,
    }),
    TypeError,
  )
  assert.equal(calls.length, 0)
})

test('a server error keeps its code, message, details and trace id', async () => {
  const answers = [
    fixtureResponse(401, 'common/unauthorized-session.json'),
    fixtureResponse(400, 'common/invalid-input.json'),
    fixtureResponse(500, 'common/internal-error-no-trace.json'),
  ]
  const { fetch } = fakeFetch((_url, _init, index) => answers[index])
  const http = client(fetch)
  const call = () =>
    http.request('GET', '/workspaces/me', {
      signal: signal(),
      read: readStatus,
    })

  await assert.rejects(
    call(),
    apiError({
      status: 401,
      code: 'UNAUTHORIZED_SESSION',
      message: '워크스페이스 세션이 없거나 만료되었습니다.',
      details: undefined,
      traceId: '5f0c2a9e41b7d3c8',
    }),
  )
  await assert.rejects(
    call(),
    apiError({
      status: 400,
      code: 'INVALID_INPUT',
      details: [
        { field: 'name', message: 'String should have at most 50 characters' },
      ],
      traceId: 'a41e07d29c35b816',
    }),
  )
  await assert.rejects(
    call(),
    apiError({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      // Without meta the server reused the id this client sent.
      traceId: 'trace-3',
    }),
  )
})

test('a non-envelope failure, like a proxy HTML 502, becomes HTTP_<status>', async () => {
  const answers = [
    textResponse(502, '<html><body>Bad Gateway</body></html>'),
    // /health/ready answers 503 with a success envelope when a check fails.
    fixtureResponse(503, 'common/ready-degraded.json'),
    jsonResponse(404, { detail: 'Not Found' }),
  ]
  const { fetch } = fakeFetch((_url, _init, index) => answers[index])
  const http = client(fetch)
  const call = () =>
    http.request('GET', '/health/ready', { signal: signal(), read: readStatus })
  await assert.rejects(
    call(),
    apiError({ status: 502, code: 'HTTP_502', traceId: 'trace-1' }),
  )
  await assert.rejects(call(), apiError({ status: 503, code: 'HTTP_503' }))
  await assert.rejects(call(), apiError({ status: 404, code: 'HTTP_404' }))
})

test('a 2xx body that is not the expected envelope is an invalid response', async () => {
  const answers = [
    textResponse(200, 'ok', 'text/plain'),
    jsonResponse(200, { status: 'ok' }),
    jsonResponse(200, { success: false }),
    new Response(null, { status: 204 }),
  ]
  const { fetch } = fakeFetch((_url, _init, index) => answers[index])
  const http = client(fetch)
  for (const status of [200, 200, 200, 204]) {
    await assert.rejects(
      http.request('GET', '/health', { signal: signal(), read: readStatus }),
      apiError({ status, code: 'INVALID_RESPONSE' }),
    )
  }
})

test('data the reader rejects never reaches the caller', async () => {
  const { fetch } = fakeFetch(() =>
    jsonResponse(200, { success: true, data: { status: 7 } }),
  )
  await assert.rejects(
    client(fetch).request('GET', '/health', {
      signal: signal(),
      read: readStatus,
    }),
    (error) => {
      apiError({ status: 200, code: 'INVALID_RESPONSE', traceId: 'trace-1' })(
        error,
      )
      assert.ok(error.cause instanceof ResponseShapeError)
      assert.equal(error.cause.path, 'data.status')
      return true
    },
  )
})

test('a failed connection is NETWORK with status 0', async () => {
  const failure = new TypeError('Failed to fetch')
  const { fetch } = fakeFetch(() => Promise.reject(failure))
  await assert.rejects(
    client(fetch).request('GET', '/health', {
      signal: signal(),
      read: readStatus,
    }),
    (error) => {
      apiError({ status: 0, code: 'NETWORK', traceId: 'trace-1' })(error)
      assert.equal(error.cause, failure)
      return true
    },
  )
})

test('cancellation stays an AbortError, never an ApiError', async () => {
  const pending = pendingFetch()
  const controller = new AbortController()
  const request = client(pending.fetch).request('GET', '/health', {
    signal: controller.signal,
    read: readStatus,
  })
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })

  const aborted = new AbortController()
  aborted.abort()
  const early = fakeFetch((_url, init) => Promise.reject(init.signal.reason))
  await assert.rejects(
    client(early.fetch).request('GET', '/health', {
      signal: aborted.signal,
      read: readStatus,
    }),
    { name: 'AbortError' },
  )
})

test('a connection that fails after cancellation still ends as AbortError', async () => {
  const controller = new AbortController()
  const { fetch } = fakeFetch(() => {
    controller.abort()
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  await assert.rejects(
    client(fetch).request('GET', '/health', {
      signal: controller.signal,
      read: readStatus,
    }),
    { name: 'AbortError' },
  )
})

test('a request cancelled while its body arrives does not resolve', async () => {
  const duringBody = new AbortController()
  const breaking = fakeFetch(() => {
    duringBody.abort()
    return {
      ok: true,
      status: 200,
      text: () =>
        Promise.reject(new DOMException('The user aborted.', 'AbortError')),
    }
  })
  await assert.rejects(
    client(breaking.fetch).request('GET', '/health', {
      signal: duringBody.signal,
      read: readStatus,
    }),
    { name: 'AbortError' },
  )

  const afterBody = new AbortController()
  const late = fakeFetch(() => {
    afterBody.abort()
    return fixtureResponse(200, 'common/health.json')
  })
  await assert.rejects(
    client(late.fetch).request('GET', '/health', {
      signal: afterBody.signal,
      read: readStatus,
    }),
    { name: 'AbortError' },
  )
})

test('an API on another origin gets the session cookie', async () => {
  const { fetch, calls } = fakeFetch(() =>
    fixtureResponse(200, 'common/health.json'),
  )
  await client(fetch, {
    baseUrl: 'https://api.example.test/api/v1',
    credentials: 'include',
  }).request('GET', '/health', { signal: signal(), read: readStatus })
  assert.equal(calls[0].url, 'https://api.example.test/api/v1/health')
  assert.equal(calls[0].init.credentials, 'include')
})

test('the default client reads the global fetch when it sends', async () => {
  const original = globalThis.fetch
  const { fetch, calls } = fakeFetch(() =>
    fixtureResponse(200, 'common/health.json'),
  )
  const http = createHttpClient({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
  })
  globalThis.fetch = fetch
  try {
    await http.request('GET', '/health', { signal: signal(), read: readStatus })
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls.length, 1)
  assert.match(calls[0].init.headers['X-Trace-Id'], /^[0-9a-f]{16}$/)
})

test('trace ids match the server format and do not repeat', () => {
  const ids = new Set(Array.from({ length: 50 }, createTraceId))
  assert.equal(ids.size, 50)
  for (const id of ids) assert.match(id, /^[0-9a-f]{16}$/)
})

test('apiErrorOf finds the server failure behind a repository error', () => {
  const failure = new ApiError({
    status: 401,
    code: 'UNAUTHORIZED_SESSION',
    message: 'expired',
    traceId: 'trace-1',
  })
  const wrapped = new Error('expired', {
    cause: new Error('x', { cause: failure }),
  })
  assert.equal(apiErrorOf(failure), failure)
  assert.equal(apiErrorOf(wrapped), failure)
  assert.equal(apiErrorOf(new Error('plain')), null)
  assert.equal(apiErrorOf('text'), null)
  const loop = new Error('loop')
  loop.cause = loop
  assert.equal(apiErrorOf(loop), null)
})
