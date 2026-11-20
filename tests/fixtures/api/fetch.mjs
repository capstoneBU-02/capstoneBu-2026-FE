import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Shared ground for API tests.
//
// tests/fixtures/api/<domain>/<case>.json holds one whole response body as the
// backend sends it: the envelope, snake_case keys and nulls included. Adapter
// tests read `fixtureData(...)` and compare the adapter's screen model;
// HTTP tests answer a fake fetch with `fixtureResponse(...)`.

export function readFixture(path) {
  return JSON.parse(readFileSync(new URL(`./${path}`, import.meta.url), 'utf8'))
}

// The `data` of a success fixture, for adapter tests.
export function fixtureData(path) {
  const body = readFixture(path)
  assert.equal(body.success, true, `${path} is not a success envelope`)
  return body.data
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function fixtureResponse(status, path) {
  return jsonResponse(status, readFixture(path))
}

export function textResponse(status, text, contentType = 'text/html') {
  return new Response(text, {
    status,
    headers: { 'Content-Type': contentType },
  })
}

// A fetch that answers each call from `answer(url, init, index)` and keeps
// every call for assertions. `answer` may return a Response or a Promise.
export function fakeFetch(answer) {
  const calls = []
  async function fetch(url, init) {
    calls.push({ url, init })
    return answer(url, init, calls.length - 1)
  }
  return { fetch, calls }
}

// A fetch that settles only when its signal aborts, as a real request would.
export function pendingFetch() {
  return fakeFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(init.signal.reason),
          { once: true },
        )
      }),
  )
}
