import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import config from '../playwright.config.ts'

// How long the browser suite and the CI job around it may run (#41).

// The slowest full run seen in CI: Playwright reported 4.7 min for 229 tests
// on a slow runner (PR #40).
const SLOWEST_CI_RUN_SECONDS = 282
// The steps before and after the browser tests took 70–95 s. The cache only
// covers npm ci, so this mostly leaves room for a slower runner.
const OTHER_STEPS_SECONDS = 180

// The check job's own limit, not one of a step or another job.
function checkJobMinutes() {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const job = workflow.match(/^ {2}check:\n((?:(?: {4}.*)?\n)*)/m)
  assert.ok(job, 'ci.yml has no check job')
  const limit = job[1].match(/^ {4}timeout-minutes:\s*(\d+)/m)
  assert.ok(limit, 'the check job has no timeout-minutes')
  return Number(limit[1])
}

const suiteSeconds = config.globalTimeout / 1000
const jobSeconds = checkJobMinutes() * 60

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
