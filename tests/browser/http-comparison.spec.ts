import { expect, test, type Page } from '@playwright/test'
import {
  chooseTakeFile,
  comparisonAnswer,
  comparisonFixture,
  listedTake,
  openComparison,
  sendTake,
  serveComparison,
  serveTakes,
  type Answer,
} from './http-takes.ts'
import { API, answer, main } from './http-workspace.ts'

// Comparison 41 of take 12 through the http repositories against a faked
// API. The status is asked for every 2.5 seconds, so a change the server
// makes can take a round or two to show.
const SETTLED = { timeout: 10_000 }

test.describe.configure({ timeout: 60_000 })

const comparison = (page: Page) =>
  main(page).getByRole('tabpanel', { name: /^비교/ })
const status = (page: Page) =>
  comparison(page)
    .getByRole('status')
    .filter({ has: page.getByRole('heading', { level: 2 }) })
const button = (page: Page, name: string) =>
  comparison(page).getByRole('button', { name, exact: true })
const regionList = (page: Page) =>
  page.getByRole('region', { name: '다시 들어볼 곳' })
const rows = (page: Page) => regionList(page).getByRole('listitem')
const mark = (page: Page, number: number) =>
  regionList(page).getByRole('checkbox', {
    name: new RegExp(`^${number}번 구간`),
  })

const listed = [listedTake(12, 'UPLOAD', '2026-11-25T05:10:00.402913Z')]

test('a listed take is compared, then its result and sounds load', async ({
  page,
}) => {
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, { status: 'status-processing' })
  })
  await expect(status(page)).toContainText('아직 비교하지 않은 연주예요')

  await button(page, '비교하기').click()

  await expect(status(page)).toContainText('연주한 음을 읽고 있어요')
  expect(server.sent.map(({ key }) => key)).toEqual(['request'])

  server.show('status-success')
  await expect(rows(page)).toHaveCount(4, SETTLED)
  await expect(status(page)).toHaveCount(0)
  await expect(rows(page).first()).toContainText('00:00.4 – 00:00.7')
  await expect(regionList(page)).toContainText('1/3 확인')
  await expect(mark(page, 3)).toBeChecked()
  // The original song is the baseline, so its sound and the take's are
  // fetched from the links the playback answer signed.
  await expect
    .poll(() => [...new Set(server.downloads)].sort())
    .toEqual(['/performances/12/take.mp3', '/tracks/7/original.mp3'])
})

// The page undoes a refused check as soon as the refusal arrives, so the
// answer waits until the test has seen the check go on.
function held(refusal: Answer) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    answer: async () => {
      await gate
      return refusal
    },
    release: () => release(),
  }
}

test('checking a place is saved, and a refused check is undone', async ({
  page,
}) => {
  let markAnswer: () => Answer | Promise<Answer> = () =>
    comparisonAnswer('region-checked')
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, {
      status: 'status-success',
      mark: () => markAnswer(),
    })
  })
  await button(page, '비교하기').click()
  await expect(rows(page)).toHaveCount(4, SETTLED)

  await mark(page, 1).check()

  await expect(regionList(page)).toContainText('2/3 확인')
  await expect
    .poll(() => server.sent.filter(({ key }) => key.startsWith('mark')))
    .toEqual([{ key: 'mark 501', body: { is_checked: true } }])

  const refusal = held(comparisonAnswer('region-not-found', 404))
  markAnswer = refusal.answer
  await mark(page, 2).check()
  await expect(regionList(page)).toContainText('3/3 확인')
  refusal.release()

  await expect(comparison(page).getByRole('alert')).toHaveText(
    '다시 들어볼 곳을 찾을 수 없어요.',
  )
  await expect(mark(page, 2)).not.toBeChecked()
  await expect(regionList(page)).toContainText('2/3 확인')
})

test('a check the server cannot save says so', async ({ page }) => {
  const refusal = held([{ success: false }, 500])
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, {
      status: 'status-success',
      mark: refusal.answer,
    })
  })
  await button(page, '비교하기').click()
  await expect(rows(page)).toHaveCount(4, SETTLED)

  await mark(page, 1).check()
  await expect(regionList(page)).toContainText('2/3 확인')
  refusal.release()

  await expect(comparison(page).getByRole('alert')).toHaveText(
    '확인 표시를 저장하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(mark(page, 1)).not.toBeChecked()
  await expect(regionList(page)).toContainText('1/3 확인')
  expect(server.sent.map(({ key }) => key)).toEqual(['request', 'mark 501'])
})

test('a failed comparison is retried from the stage that failed', async ({
  page,
}) => {
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, { status: 'status-failed' })
  })
  await button(page, '비교하기').click()
  await expect(status(page)).toContainText('비교를 끝내지 못했어요', SETTLED)
  await expect(status(page)).toContainText(
    '다시 시도할 수 있어요. 남은 횟수 2회',
  )

  await button(page, '다시 시도').click()

  // Queued again, the comparison stands at the last stage that went through.
  await expect(status(page)).toContainText('연주와 기준 음원을 맞추고 있어요')
  expect(server.sent.map(({ key }) => key)).toEqual(['request', 'retry'])

  server.show('status-success')
  await expect(rows(page)).toHaveCount(4, SETTLED)
})

test('a take saved here that runs long says why it was not compared', async ({
  page,
}) => {
  const [takeServer] = await openComparison(page, () =>
    Promise.all([
      serveTakes(page, []),
      serveComparison(page, {
        status: 'status-not-comparable',
        result: comparisonAnswer('result-not-comparable'),
      }),
    ]),
  )
  takeServer.release()
  await chooseTakeFile(page)

  await sendTake(page).click()

  await expect(status(page)).toContainText(
    '올린 음원과 맞춰 보지 못했어요',
    SETTLED,
  )
  await expect(status(page)).toContainText('연주가 구간보다 많이 길어요.')
  // A take saved on this page knows its own length.
  await expect(status(page)).toContainText(
    /연주 \d\d:\d\d\.\d · 구간 \d\d:\d\d\.\d/,
  )
})

test('a status that keeps failing to load stops being asked for', async ({
  page,
}) => {
  let readable = false
  let asked = 0
  await openComparison(page, async () => {
    await serveTakes(page, listed)
    const served = await serveComparison(page, { status: 'status-success' })
    // A status the page cannot read stays unreadable however often it asks.
    await page.route(`${API}/comparisons/41`, (route) => {
      if (readable) return route.fallback()
      asked += 1
      return answer(route, {
        success: true,
        data: { comparison_id: 41, status: 'paused' },
      })
    })
    return served
  })

  await button(page, '비교하기').click()

  await expect(status(page)).toContainText(
    '비교 결과를 불러오지 못했어요',
    SETTLED,
  )
  const askedBefore = asked
  await page.waitForTimeout(3_000)
  expect(asked).toBe(askedBefore)

  readable = true
  await button(page, '다시 시도').click()

  await expect(rows(page)).toHaveCount(4, SETTLED)
})

test('a take the server is already comparing says so', async ({ page }) => {
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, {
      request: comparisonAnswer('comparison-in-progress', 409),
    })
  })

  await button(page, '비교하기').click()

  await expect(comparison(page).getByRole('alert')).toHaveText(
    '이 연주는 이미 비교하고 있어요.',
  )
  await expect(status(page)).toContainText('아직 비교하지 않은 연주예요')
  expect(server.sent.map(({ key }) => key)).toEqual(['request'])
})

test('a comparison the server reuses shows its result at once', async ({
  page,
}) => {
  const reused = comparisonFixture('reused')
  const server = await openComparison(page, async () => {
    await serveTakes(page, listed)
    return serveComparison(page, {
      request: [
        { ...reused, data: { ...(reused.data as object), comparison_id: 41 } },
        200,
      ],
      status: 'status-success',
    })
  })

  await button(page, '비교하기').click()

  await expect(rows(page)).toHaveCount(4, SETTLED)
  expect(server.sent.map(({ key }) => key)).toEqual(['request'])
})
