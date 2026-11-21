import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readObject } from '../src/api/guards.ts'
import { ApiError, createHttpClient } from '../src/api/http.ts'
import { uploadPercent } from '../src/api/upload.ts'
import { readFixture } from './fixtures/api/fetch.mjs'

// A stand-in for XMLHttpRequest that records what the client set up and lets
// each test play the browser's events in order.
class FakeXhr {
  method = ''
  url = ''
  headers = {}
  withCredentials = false
  upload = {}
  sent = undefined
  aborted = false
  status = 0
  responseText = ''

  open(method, url) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name, value) {
    this.headers[name] = value
  }

  send(body) {
    this.sent = body
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  progress(loaded, total, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable })
  }

  finishUpload() {
    this.upload.onload?.()
  }

  respond(status, body) {
    this.status = status
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }
}

const readTrackId = (data) => readObject(data).integer('track_id')

function setup(overrides = {}) {
  const xhrs = []
  const fetchCalls = []
  const client = createHttpClient({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
    fetch: async (...args) => {
      fetchCalls.push(args)
      throw new Error('fetch must not run for an upload with progress')
    },
    createXhr: () => {
      const xhr = new FakeXhr()
      xhrs.push(xhr)
      return xhr
    },
    createTraceId: () => 'trace-1',
    ...overrides,
  })
  return { client, xhrs, fetchCalls }
}

function upload(client, { signal = new AbortController().signal } = {}) {
  const progress = []
  const form = new FormData()
  form.append('file', new File(['abc'], 'song.mp3', { type: 'audio/mpeg' }))
  const pending = client.request('POST', '/tracks/upload', {
    signal,
    form,
    read: readTrackId,
    onUploadProgress: (percent) => progress.push(percent),
  })
  return { pending, progress, form }
}

test('an upload that reports progress goes over XMLHttpRequest with the same headers', async () => {
  const { client, xhrs, fetchCalls } = setup()
  const { pending, form } = upload(client)

  assert.equal(xhrs.length, 1)
  const [xhr] = xhrs
  assert.equal(xhr.method, 'POST')
  assert.equal(xhr.url, '/api/v1/tracks/upload')
  assert.deepEqual(xhr.headers, {
    Accept: 'application/json',
    'X-Trace-Id': 'trace-1',
  })
  assert.equal(xhr.withCredentials, false)
  assert.equal(xhr.sent, form)

  xhr.respond(201, { success: true, data: { track_id: 7 } })
  assert.deepEqual(await pending, { status: 201, data: 7 })
  assert.equal(fetchCalls.length, 0)
})

test('an API on another origin sends the session cookie with the upload', () => {
  const { client, xhrs } = setup({ credentials: 'include' })
  upload(client)
  assert.equal(xhrs[0].withCredentials, true)
})

test('progress arrives as whole percents that never go back', async () => {
  const { client, xhrs } = setup()
  const { pending, progress } = upload(client)
  const [xhr] = xhrs

  xhr.progress(0, 300)
  xhr.progress(100, 300)
  xhr.progress(50, 300)
  xhr.progress(10, 0, false)
  xhr.progress(299, 300)
  xhr.finishUpload()
  xhr.finishUpload()
  xhr.respond(201, { success: true, data: { track_id: 7 } })
  await pending

  assert.deepEqual(progress, [0, 33, 99, 100])
})

test('percents stay whole and inside 0 to 100', () => {
  assert.equal(uploadPercent(0, 10), 0)
  assert.equal(uploadPercent(1, 3), 33)
  assert.equal(uploadPercent(2, 3), 66)
  assert.equal(uploadPercent(10, 10), 100)
  assert.equal(uploadPercent(12, 10), 100)
  assert.equal(uploadPercent(-1, 10), 0)
})

test('an upload error answer becomes the same ApiError a fetch would give', async () => {
  const { client, xhrs } = setup()
  const { pending } = upload(client)
  xhrs[0].respond(413, readFixture('workspace/upload-file-too-large.json'))

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 413)
    assert.equal(error.code, 'FILE_TOO_LARGE')
    assert.equal(error.traceId, 'c1d2e3f4a5b6c7d8')
    return true
  })
})

test('a proxy that refuses the body without an envelope gives HTTP_413', async () => {
  const { client, xhrs } = setup()
  const { pending } = upload(client)
  xhrs[0].respond(413, '<html>Request Entity Too Large</html>')
  await assert.rejects(pending, { name: 'ApiError', code: 'HTTP_413' })
})

test('a dropped connection during the upload is a NETWORK failure', async () => {
  const { client, xhrs } = setup()
  const { pending } = upload(client)
  xhrs[0].fail()
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 0)
    assert.equal(error.code, 'NETWORK')
    assert.equal(error.traceId, 'trace-1')
    assert.ok(error.cause instanceof TypeError)
    return true
  })
})

test('cancelling stops the upload and ends as an AbortError', async () => {
  const { client, xhrs } = setup()
  const controller = new AbortController()
  const { pending, progress } = upload(client, { signal: controller.signal })
  xhrs[0].progress(10, 100)
  controller.abort()

  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(xhrs[0].aborted, true)
  assert.deepEqual(progress, [10])
})

test('an answer that lands after cancelling is ignored', async () => {
  const { client, xhrs } = setup()
  const controller = new AbortController()
  const { pending } = upload(client, { signal: controller.signal })
  // Some browsers have already queued the load event when abort() runs.
  xhrs[0].abort = () => {}
  controller.abort()
  xhrs[0].respond(201, { success: true, data: { track_id: 7 } })
  await assert.rejects(pending, { name: 'AbortError' })
})

test('an upload cancelled before it starts opens no request', async () => {
  const { client, xhrs } = setup()
  const controller = new AbortController()
  controller.abort()
  const { pending } = upload(client, { signal: controller.signal })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(xhrs.length, 0)
})

test('upload progress applies only to form bodies', async () => {
  const { client, xhrs } = setup()
  for (const options of [{}, { json: {} }]) {
    await assert.rejects(
      client.request('POST', '/tracks/upload', {
        signal: new AbortController().signal,
        read: readTrackId,
        onUploadProgress: () => {},
        ...options,
      }),
      { name: 'TypeError' },
    )
  }
  assert.equal(xhrs.length, 0)
})
