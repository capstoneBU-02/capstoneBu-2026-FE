import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import config from '../playwright.config.ts'

// How long the browser suite and the CI job around it may run (#41).

// Conservative baseline from PR #64's two-shard trial: Playwright reported
// 5.3 min for 223 tests (shard 1/2, run 44688218085). Keep this measured
// baseline while moving to four smaller shards; do not assume a linear speedup.
const SLOWEST_CI_RUN_SECONDS = 318
// Setup took up to 155 s in the two-shard trial; Chromium installation alone
// took 321 s in PR #58. Leave room for dependency mirrors and report upload.
const OTHER_STEPS_SECONDS = 360

// The browser job's own limit, not one of a step or another job.
function browserJobMinutes() {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const job = workflow.match(/^ {2}browser:\n((?:(?: {4}.*)?\n)*)/m)
  assert.ok(job, 'ci.yml has no browser job')
  const limit = job[1].match(/^ {4}timeout-minutes:\s*(\d+)/m)
  assert.ok(limit, 'the browser job has no timeout-minutes')
  return Number(limit[1])
}

const suiteSeconds = config.globalTimeout / 1000
const jobSeconds = browserJobMinutes() * 60

test('the browser suite may take twice its slowest CI run', () => {
  assert.ok(
    suiteSeconds >= 2 * SLOWEST_CI_RUN_SECONDS,
    `globalTimeout ${suiteSeconds} s`,
  )
})

test('the CI job outlasts the browser suite and still uploads its report', () => {
  assert.ok(
    jobSeconds >= suiteSeconds + OTHER_STEPS_SECONDS,
    `timeout-minutes ${jobSeconds / 60}, globalTimeout ${suiteSeconds} s`,
  )
})
