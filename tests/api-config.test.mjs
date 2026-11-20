import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  apiConfig,
  DEFAULT_API_BASE,
  readApiConfig,
} from '../src/api/config.ts'

test('without settings the app runs on mock repositories and the proxied path', () => {
  const expected = {
    mode: 'mock',
    baseUrl: DEFAULT_API_BASE,
    credentials: 'same-origin',
  }
  assert.equal(DEFAULT_API_BASE, '/api/v1')
  assert.deepEqual(readApiConfig(undefined), expected)
  assert.deepEqual(readApiConfig({}), expected)
  assert.deepEqual(
    readApiConfig({ VITE_API_MODE: '', VITE_API_BASE: '' }),
    expected,
  )
  // node --test has no import.meta.env, so unit tests always see mock.
  assert.deepEqual(apiConfig(), expected)
  assert.equal(apiConfig(), apiConfig())
})

test('http mode keeps a same-origin base and drops trailing slashes', () => {
  assert.deepEqual(
    readApiConfig({ VITE_API_MODE: 'http', VITE_API_BASE: '/api/v1/' }),
    { mode: 'http', baseUrl: '/api/v1', credentials: 'same-origin' },
  )
  assert.equal(
    readApiConfig({ VITE_API_MODE: 'mock' }).mode,
    'mock',
    'mock can be named explicitly',
  )
})

test('an API on another origin must send the session cookie explicitly', () => {
  assert.deepEqual(
    readApiConfig({
      VITE_API_MODE: 'http',
      VITE_API_BASE: 'https://api.example.test/api/v1/',
    }),
    {
      mode: 'http',
      baseUrl: 'https://api.example.test/api/v1',
      credentials: 'include',
    },
  )
})

test('a mistyped setting stops the app instead of silently picking a mode', () => {
  for (const mode of ['htpp', 'HTTP', 'real', 1]) {
    assert.throws(
      () => readApiConfig({ VITE_API_MODE: mode }),
      /VITE_API_MODE/,
      String(mode),
    )
  }
  for (const base of [
    'api/v1',
    '//api.example.test',
    '/',
    'ftp://api.example.test',
    'https://api.example.test/api?x=1',
    'javascript:alert(1)',
  ]) {
    assert.throws(
      () => readApiConfig({ VITE_API_BASE: base }),
      /VITE_API_BASE/,
      base,
    )
  }
})
