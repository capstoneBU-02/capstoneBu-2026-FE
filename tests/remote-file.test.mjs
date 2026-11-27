import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteFiles, RemoteFileError } from '../src/api/remoteFile.ts'
import { fakeFetch, pendingFetch } from './fixtures/api/fetch.mjs'

const signal = () => new AbortController().signal
const URL_A = 'https://storage.example.com/a.wav?sig=1'
const URL_B = 'https://storage.example.com/a.wav?sig=2'
const T0 = Date.parse('2026-11-21T06:13:20Z')
const TEN_MINUTES = 10 * 60_000

function signer(...urls) {
  const signed = []
  return {
    signed,
    sign: async () => {
      const url = urls[Math.min(signed.length, urls.length - 1)]
      signed.push(url)
      return { url, expiresAt: T0 + TEN_MINUTES }
    },
  }
}

test('a file downloads from its signed URL without cookies', async () => {
  const { fetch, calls } = fakeFetch(() => new Response('bytes'))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const { sign, signed } = signer(URL_A)
  const blob = await files.fetch('a', signal(), sign)
  assert.equal(await blob.text(), 'bytes')
  assert.deepEqual(signed, [URL_A])
  assert.equal(calls[0].url, URL_A)
  assert.equal(calls[0].init.credentials, 'omit')
})

test('a signed URL is reused while more than the margin is left', async () => {
  let time = T0
  const { fetch, calls } = fakeFetch(() => new Response('bytes'))
  const files = createRemoteFiles({ fetch, now: () => time })
  const { sign, signed } = signer(URL_A, URL_B)
  await files.fetch('a', signal(), sign)
  time = T0 + TEN_MINUTES - 60_001
  await files.fetch('a', signal(), sign)
  assert.deepEqual(signed, [URL_A])
  time = T0 + TEN_MINUTES - 60_000
  await files.fetch('a', signal(), sign)
  assert.deepEqual(signed, [URL_A, URL_B])
  assert.deepEqual(
    calls.map(({ url }) => url),
    [URL_A, URL_A, URL_B],
  )
})

test('each key keeps its own URL', async () => {
  const { fetch } = fakeFetch(() => new Response('bytes'))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const first = signer(URL_A)
  const second = signer(URL_B)
  await files.fetch('a', signal(), first.sign)
  await files.fetch('b', signal(), second.sign)
  await files.fetch('a', signal(), first.sign)
  assert.deepEqual(first.signed, [URL_A])
  assert.deepEqual(second.signed, [URL_B])
})

test('a kept URL that is refused is signed again once', async () => {
  const { fetch, calls } = fakeFetch((url, _init, index) =>
    index === 1 ? new Response('', { status: 403 }) : new Response(url),
  )
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const { sign, signed } = signer(URL_A, URL_B)
  await files.fetch('a', signal(), sign)
  const blob = await files.fetch('a', signal(), sign)
  assert.equal(await blob.text(), URL_B)
  assert.deepEqual(signed, [URL_A, URL_B])
  assert.equal(calls.length, 3)
})

test('a fresh URL that is refused fails without signing again', async () => {
  const { fetch } = fakeFetch(() => new Response('', { status: 403 }))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const { sign, signed } = signer(URL_A, URL_B)
  await assert.rejects(files.fetch('a', signal(), sign), {
    name: 'RemoteFileError',
    status: 403,
  })
  assert.deepEqual(signed, [URL_A])
  // The refused URL is not kept.
  await assert.rejects(files.fetch('a', signal(), sign))
  assert.deepEqual(signed, [URL_A, URL_B])
})

test('storage that cannot be reached fails with status 0', async () => {
  const { fetch } = fakeFetch(() => Promise.reject(new TypeError('Failed')))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const error = await files.fetch('a', signal(), signer(URL_A).sign).then(
    () => assert.fail('expected a failure'),
    (failure) => failure,
  )
  assert.ok(error instanceof RemoteFileError)
  assert.equal(error.status, 0)
  assert.ok(error.cause instanceof TypeError)
})

test('a server error fails with its status', async () => {
  const { fetch } = fakeFetch(() => new Response('', { status: 500 }))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  await assert.rejects(files.fetch('a', signal(), signer(URL_A).sign), {
    status: 500,
  })
})

test('a failed signing is passed on as it is', async () => {
  const { fetch, calls } = fakeFetch(() => new Response('bytes'))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const refused = new Error('no URL')
  await assert.rejects(
    files.fetch('a', signal(), async () => {
      throw refused
    }),
    (error) => error === refused,
  )
  assert.equal(calls.length, 0)
})

test('a cancelled download stays an AbortError', async () => {
  const { fetch } = pendingFetch()
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const controller = new AbortController()
  const pending = files.fetch('a', controller.signal, signer(URL_A).sign)
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('a cancelled download keeps its URL for the next one', async () => {
  const { fetch, calls } = fakeFetch((_url, init, index) =>
    index === 1
      ? new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(init.signal.reason),
            { once: true },
          )
        })
      : new Response('bytes'),
  )
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const { sign, signed } = signer(URL_A, URL_B)
  await files.fetch('a', signal(), sign)
  const controller = new AbortController()
  const cancelled = files.fetch('a', controller.signal, sign)
  await Promise.resolve()
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })

  await files.fetch('a', signal(), sign)
  assert.deepEqual(signed, [URL_A])
  assert.deepEqual(
    calls.map(({ url }) => url),
    [URL_A, URL_A, URL_A],
  )
})

test('a download cancelled before signing sends nothing', async () => {
  const { fetch, calls } = fakeFetch(() => new Response('bytes'))
  const files = createRemoteFiles({ fetch, now: () => T0 })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    files.fetch('a', controller.signal, signer(URL_A).sign),
    { name: 'AbortError' },
  )
  assert.equal(calls.length, 0)
})
