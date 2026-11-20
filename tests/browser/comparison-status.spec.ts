import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const TASK = 'task-verse'
// A comparison's status is asked for every 2.5 seconds.
const SETTLED = { timeout: 10_000 }
const STAGE =
  /비교 순서를 기다리고 있어요|연주와 기준 음원을 맞추고 있어요|연주한 음을 읽고 있어요|다르게 들리는 곳을 찾고 있어요/

const main = (page: Page) => page.locator('#workspace-content')
const comparison = (page: Page) =>
  main(page).getByRole('tabpanel', { name: /^비교/ })
// The result view keeps a status of its own; only this panel's has a title.
const status = (page: Page) =>
  comparison(page)
    .getByRole('status')
    .filter({ has: page.getByRole('heading', { level: 2 }) })
const button = (page: Page, name: string) =>
  comparison(page).getByRole('button', { name, exact: true })
// The toolbar counts the differences only once the result is open.
const resultLegend = (page: Page) =>
  comparison(page)
    .getByText(/^다르게 들림 \d+$/)
    .first()
const notice = (page: Page) => comparison(page).getByRole('alert')
// Newest first: index 0 is the take that opens.
const chooseTake = (page: Page, index: number) =>
  comparison(page)
    .getByRole('combobox', { name: '연주' })
    .selectOption({ index })
const firstMark = (page: Page) =>
  page
    .getByRole('region', { name: '다시 들어볼 곳' })
    .getByRole('checkbox', { name: /^1번 구간/ })

async function openComparison(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=${TASK}&comparison=1${query}`,
  )
  await main(page).getByRole('tab', { name: /^비교/ }).click()
}

// The two entries are built apart from this panel; what matters here is which
// one the panel opens.
async function stubTakeEntries(page: Page) {
  const stub = (name: string, entry: string) =>
    `export function ${name}() { document.body.dataset.takeEntry = '${entry}'; return null }`
  await page.route('**/RecordingPanel.tsx*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: stub('RecordingPanel', 'record'),
    }),
  )
  await page.route('**/PerformanceUploadDialog.tsx*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: stub('PerformanceUploadDialog', 'upload'),
    }),
  )
}

// Puts a statement first in one method of the mock, where its own error class
// is in scope.
function rewriteMockMethod(page: Page, method: string, statement: string) {
  return page.route('**/mockComparisonRepository.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const signature = `async ${method}(`
    expect(source).toContain(signature)
    const body = source.replace(
      new RegExp(`(async ${method}\\([^)]*\\) \\{)`),
      `$1 ${statement}`,
    )
    await route.fulfill({ response, body })
  })
}

// Without a code the screen falls back on its own wording.
const mockError = (code?: string) =>
  code
    ? `new ComparisonRepositoryError('${code}')`
    : `new Error('mock failure')`

// The harness has no switch for these, so the mock answers with a failure for
// as long as the page's flag stays up.
async function failMockRequest(page: Page, method: string, code?: string) {
  await page.addInitScript(() => {
    Object.assign(globalThis, { failComparisonMock: true })
  })
  await rewriteMockMethod(
    page,
    method,
    `if (globalThis.failComparisonMock) throw ${mockError(code)};`,
  )
}

const recoverMockRequest = (page: Page) =>
  page.evaluate(() => {
    Object.assign(globalThis, { failComparisonMock: false })
  })

// Every call fails, but only once the test lets it, so the screen can move on
// while the request is still out.
async function holdMockFailure(page: Page, method: string, code?: string) {
  await page.addInitScript(() => {
    const gate = new Promise((resolve) => {
      Object.assign(globalThis, { releaseMockFailure: resolve })
    })
    Object.assign(globalThis, { mockFailureGate: gate, mockFailed: false })
  })
  await rewriteMockMethod(
    page,
    method,
    `await globalThis.mockFailureGate; globalThis.mockFailed = true; throw ${mockError(code)};`,
  )
}

// Returns once the failure has reached the screen.
async function releaseMockFailure(page: Page) {
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { releaseMockFailure(): void }
    ).releaseMockFailure()
  })
  await page.waitForFunction(
    () => (globalThis as unknown as { mockFailed: boolean }).mockFailed,
  )
  // React renders what the failure changed within a frame or two.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
}

// The harness ends a comparison within a fifth of a second, which a busy
// machine can miss. Runs started from the flag's time on stay queued; an earlier
// run keeps its real state, since a retry reads the failure it answers.
async function holdComparisonRuns(page: Page, from: number | null) {
  await page.addInitScript((value) => {
    Object.assign(globalThis, { holdRunsFrom: value })
  }, from)
  await page.route('**/mockComparisonRun.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const signature = 'export function comparisonRunState(run, now, timing) {'
    expect(source).toContain(signature)
    const body = source.replace(
      signature,
      `${signature} if (globalThis.holdRunsFrom != null && run.enqueuedAt >= globalThis.holdRunsFrom) return waitingAfter(STAGE_ORDER.indexOf(run.startStage) - 1);`,
    )
    await route.fulfill({ response, body })
  })
}

const holdNewRuns = (page: Page) =>
  page.evaluate(() => {
    Object.assign(globalThis, { holdRunsFrom: Date.now() })
  })

const releaseRuns = (page: Page) =>
  page.evaluate(() => {
    Object.assign(globalThis, { holdRunsFrom: null })
  })

test('a task with no takes offers both ways to add one', async ({ page }) => {
  await stubTakeEntries(page)
  await openComparison(page)

  await expect(status(page)).toContainText('아직 비교한 연주가 없어요')

  await button(page, '녹음하기').click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-take-entry',
    'record',
  )

  await button(page, '파일 올리기').click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-take-entry',
    'upload',
  )
})

test('a saved take is compared and moves on to its result', async ({
  page,
}) => {
  await holdComparisonRuns(page, 0)
  await openComparison(page, '&comparison-seed=saved')

  await expect(status(page)).toContainText('아직 비교하지 않은 연주예요')
  await button(page, '비교하기').click()

  await expect(status(page)).toContainText('비교하는 중')
  await expect(status(page)).toContainText('비교 순서를 기다리고 있어요')
  await expect(button(page, '비교하기')).toHaveCount(0)
  // The button left with its panel; the keyboard stays where it was.
  await expect(page.locator('section:focus')).toContainText('비교하는 중')

  await releaseRuns(page)

  await expect(resultLegend(page)).toBeVisible(SETTLED)
  await expect(status(page)).toHaveCount(0)
})

test('a second press while the request is on its way sends nothing', async ({
  page,
}) => {
  // A run still going is what makes the mock refuse a second request.
  await holdComparisonRuns(page, 0)
  await openComparison(page, '&comparison-seed=saved')

  const disabledDuringRequest = await button(page, '비교하기').evaluate(
    async (element: HTMLElement) => {
      element.click()
      // React commits the press in a microtask, before the request can answer.
      await Promise.resolve()
      const disabled = element.getAttribute('aria-disabled')
      element.click()
      return disabled
    },
  )

  expect(disabledDuringRequest).toBe('true')
  await expect(status(page)).toContainText('비교하는 중')
  await expect(comparison(page).getByRole('alert')).toHaveCount(0)
})

test('a take from an earlier section cannot be compared', async ({ page }) => {
  await page.route('**/comparisonRules.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const body = source.replace(
      'export function isFromPreviousSection',
      'function currentSectionRule',
    )
    await route.fulfill({
      response,
      body: `${body}\nexport const isFromPreviousSection = () => true`,
    })
  })
  await openComparison(page, '&comparison-seed=saved')

  await expect(status(page)).toContainText('이전 구간의 연주예요')
  await expect(status(page)).toContainText('비교할 수 없어요')
  await expect(button(page, '비교하기')).toHaveCount(0)
})

test('a take that could not be compared says why', async ({ page }) => {
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-outcome=not-comparable',
  )

  await expect(status(page)).toContainText('원곡과 맞춰 보지 못했어요', SETTLED)
  await expect(status(page)).toContainText('연주가 구간보다 많이 짧아요.')
  await expect(status(page)).toContainText(
    /연주 \d\d:\d\d\.\d · 구간 \d\d:\d\d\.\d/,
  )
  await expect(button(page, '다시 시도')).toHaveCount(0)
  // The toolbar already holds these two.
  await expect(button(page, '파일 올리기')).toHaveCount(1)
  await expect(button(page, '다시 녹음')).toHaveCount(1)
})

test('a failed comparison can be sent again until it succeeds', async ({
  page,
}) => {
  await holdComparisonRuns(page, null)
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-outcome=failed-then-success',
  )

  await expect(status(page)).toContainText('비교를 끝내지 못했어요', SETTLED)
  await expect(status(page)).toContainText(
    '다시 시도할 수 있어요. 남은 횟수 3회',
  )

  await holdNewRuns(page)
  await button(page, '다시 시도').click()

  await expect(status(page)).toContainText(STAGE)

  await releaseRuns(page)

  await expect(resultLegend(page)).toBeVisible(SETTLED)
})

test('focus stays in the comparison when its panel is replaced', async ({
  page,
}) => {
  await holdComparisonRuns(page, null)
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-outcome=failed-then-success',
  )
  await expect(status(page)).toContainText('비교를 끝내지 못했어요', SETTLED)

  await holdNewRuns(page)
  await button(page, '다시 시도').click()
  await expect(status(page)).toContainText(STAGE)
  await releaseRuns(page)
  await expect(resultLegend(page)).toBeVisible(SETTLED)

  const focusInComparison = await comparison(page).evaluate((panel) =>
    panel.contains(document.activeElement),
  )
  expect(focusInComparison).toBe(true)
})

test('a failure that cannot be retried points to another take', async ({
  page,
}) => {
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-outcome=failed-final',
  )

  await expect(status(page)).toContainText(
    '이 연주는 다시 시도할 수 없어요. 다시 녹음하거나 다른 파일을 올려 주세요.',
    SETTLED,
  )
  await expect(button(page, '다시 시도')).toHaveCount(0)
})

test('a list that failed to load can be asked for again', async ({ page }) => {
  await failMockRequest(page, 'listPerformances')
  await openComparison(page)

  await expect(status(page)).toContainText('연주 기록을 불러오지 못했어요')

  await recoverMockRequest(page)
  await button(page, '다시 시도').click()

  await expect(status(page)).toContainText('아직 비교한 연주가 없어요')
})

test('a result that failed to load can be asked for again', async ({
  page,
}) => {
  await failMockRequest(page, 'loadResult')
  await openComparison(page, '&comparison-seed=compared')

  await expect(status(page)).toContainText(
    '비교 결과를 불러오지 못했어요',
    SETTLED,
  )

  await recoverMockRequest(page)
  await button(page, '다시 시도').click()

  await expect(resultLegend(page)).toBeVisible(SETTLED)
})

test('a comparison that is gone while it runs can be asked for again', async ({
  page,
}) => {
  await holdComparisonRuns(page, 0)
  await failMockRequest(page, 'loadStatus', 'comparison-unavailable')
  await openComparison(page, '&comparison-seed=compared')

  await expect(status(page)).toContainText(
    '비교 결과를 불러오지 못했어요',
    SETTLED,
  )

  await recoverMockRequest(page)
  await button(page, '다시 시도').click()

  await expect(status(page)).toContainText('비교하는 중')
  await releaseRuns(page)
  await expect(resultLegend(page)).toBeVisible(SETTLED)
})

test('a failed comparison that is gone before its details arrive can be asked for again', async ({
  page,
}) => {
  await failMockRequest(page, 'loadStatus', 'comparison-unavailable')
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-outcome=failed&comparison-run=instant',
  )

  await expect(status(page)).toContainText(
    '비교 결과를 불러오지 못했어요',
    SETTLED,
  )

  await recoverMockRequest(page)
  await button(page, '다시 시도').click()

  await expect(status(page)).toContainText('비교를 끝내지 못했어요', SETTLED)
})

test('a request that fails after another take was chosen tells only its own take', async ({
  page,
}) => {
  await holdMockFailure(page, 'requestComparison', 'stem-not-ready')
  await openComparison(page, '&comparison-seed=saved&comparison-seed-count=2')
  await expect(status(page)).toContainText('아직 비교하지 않은 연주예요')

  await button(page, '비교하기').click()
  await chooseTake(page, 1)
  // The first take's request is still out, so this one waits its turn.
  await expect(button(page, '비교하기')).toHaveAttribute(
    'aria-disabled',
    'true',
  )

  await releaseMockFailure(page)

  await expect(button(page, '비교하기')).toHaveAttribute(
    'aria-disabled',
    'false',
  )
  await expect(notice(page)).toHaveCount(0)

  await chooseTake(page, 0)
  await expect(notice(page)).toHaveText(
    '기타 음원이 준비되면 비교할 수 있어요.',
  )
})

test('a mark that fails after another take was chosen tells only its own take', async ({
  page,
}) => {
  await holdMockFailure(page, 'markRegion')
  await openComparison(
    page,
    '&comparison-seed=compared&comparison-seed-count=2',
  )
  await expect(firstMark(page)).toBeVisible(SETTLED)

  await firstMark(page).check()
  await chooseTake(page, 1)
  await expect(firstMark(page)).toBeVisible(SETTLED)
  await expect(firstMark(page)).not.toBeChecked()

  await releaseMockFailure(page)

  await chooseTake(page, 0)
  await expect(notice(page)).toHaveText(
    '확인 표시를 저장하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(firstMark(page)).toBeVisible(SETTLED)
  await expect(firstMark(page)).not.toBeChecked()

  // With the failure on screen, the other take shows none of it.
  await chooseTake(page, 1)
  await expect(firstMark(page)).toBeVisible(SETTLED)
  await expect(notice(page)).toHaveCount(0)
  await expect(firstMark(page)).not.toBeChecked()
})
