import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'
import type {} from './harness/recording.ts'

// Chromium's synthesized microphone, for the test of the real engine at the
// end of this file. Playwright only takes launch options for a whole file.
test.use({
  launchOptions: [
    async ({ browserName }, use) => {
      await use(
        browserName === 'chromium'
          ? {
              args: [
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
              ],
            }
          : {},
      )
    },
    { scope: 'worker' },
  ],
})

const SECTION_SECONDS = 23.7
const LIMIT_SECONDS = 47.4

const main = (page: Page) => page.locator('#workspace-content')
const panel = (page: Page) =>
  page.getByRole('region', { name: '벌스 1 녹음', exact: true })
const inPanel = (page: Page, name: string) =>
  panel(page).getByRole('button', { name, exact: true })
const closeButton = (page: Page) =>
  panel(page).getByRole('button', { name: '녹음 닫기' })
const confirmation = (page: Page) => page.getByRole('alertdialog')
const held = (page: Page) => page.evaluate(() => window.recordingTest.held())
const advance = (page: Page, seconds: number) =>
  page.evaluate((value) => window.recordingTest.advance(value), seconds)
const otherTask = (page: Page) =>
  page.getByRole('complementary').getByRole('button', {
    name: '인트로',
    exact: true,
  })
const taskTitle = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true })
const saving = (page: Page) =>
  expect(panel(page).getByRole('status')).toContainText(
    '연주를 저장하고 있어요.',
  )
const releaseTakeSaves = (page: Page) =>
  page.evaluate(() => window.workspaceTest.releaseTakeSaves())
const failTakeSaves = (page: Page) =>
  page.evaluate(() => window.workspaceTest.failTakeSaves())
// Lets the effects of what just rendered run, so a test that expects nothing
// to happen does not look before it could have.
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )

async function openPanel(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=task-verse&comparison=1${query}`,
  )
  await main(page).getByRole('button', { name: '녹음', exact: true }).click()
  await expect(panel(page)).toBeVisible()
}

async function startRecording(page: Page, query = '') {
  await openPanel(page, query)
  await inPanel(page, '녹음 시작').click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
}

async function recordTake(page: Page, query = '', seconds = 12) {
  await startRecording(page, query)
  await advance(page, seconds)
  await inPanel(page, '정지').click()
  await expect(inPanel(page, '비교하기')).toBeVisible()
}

test.describe('declining to give up a take', () => {
  test('returns focus to the close button while the take goes on', async ({
    page,
  }) => {
    await startRecording(page)
    await closeButton(page).click()
    await expect(confirmation(page)).toBeVisible()

    await confirmation(page).getByRole('button', { name: '취소' }).click()

    await expect(confirmation(page)).toBeHidden()
    await expect(closeButton(page)).toBeFocused()
  })

  for (const [how, decline] of [
    [
      '취소',
      (page: Page) =>
        confirmation(page).getByRole('button', { name: '취소' }).click(),
    ],
    ['Esc', (page: Page) => page.keyboard.press('Escape')],
  ] as const) {
    test(`with ${how} after the take ended by itself keeps focus in the panel`, async ({
      page,
    }) => {
      await startRecording(page)
      await closeButton(page).click()
      await expect(confirmation(page)).toBeVisible()

      // The limit ends the take behind the question, which stays: the take is
      // still unsaved. Its close button is a new one by now.
      await advance(page, LIMIT_SECONDS + 5)
      expect(await held(page)).toBe(0)
      await expect(confirmation(page)).toBeVisible()
      await decline(page)

      await expect(confirmation(page)).toBeHidden()
      await expect(inPanel(page, '들어 보기')).toBeFocused()
    })
  }
})

test.describe('a leave asked about while the take stops needing it', () => {
  test('goes to the task asked for once the save ends', async ({ page }) => {
    await recordTake(page, '&comparison-save=held')
    await inPanel(page, '비교하기').click()
    await saving(page)
    await otherTask(page).click()
    await expect(confirmation(page)).toBeVisible()

    await releaseTakeSaves(page)

    await expect(taskTitle(page, '인트로')).toBeVisible()
    await expect(confirmation(page)).toBeHidden()
  })

  test('goes back once the save ends', async ({ page }) => {
    await page.goto(
      '/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-save=held',
    )
    await otherTask(page).click()
    await expect(taskTitle(page, '인트로')).toBeVisible()
    await page
      .getByRole('complementary')
      .getByRole('button', { name: /^벌스 1/ })
      .click()
    await expect(taskTitle(page, '벌스 1')).toBeVisible()
    await main(page).getByRole('button', { name: '녹음', exact: true }).click()
    await inPanel(page, '녹음 시작').click()
    await advance(page, 12)
    await inPanel(page, '정지').click()
    await inPanel(page, '비교하기').click()
    await saving(page)
    const entries = await page.evaluate(() => history.length)

    await page.goBack()
    await expect(confirmation(page)).toBeVisible()
    await releaseTakeSaves(page)

    await expect(taskTitle(page, '인트로')).toBeVisible()
    await expect(confirmation(page)).toBeHidden()
    expect(await page.evaluate(() => history.length)).toBe(entries)
    // The one Back press went back one entry, no more and no less.
    await page.goBack()
    await expect(taskTitle(page, '벌스 1')).toBeVisible()
  })

  test('goes to the task asked for once the microphone is lost', async ({
    page,
  }) => {
    await startRecording(page)
    await otherTask(page).click()
    await expect(confirmation(page)).toBeVisible()

    await page.evaluate(() => window.recordingTest.disconnect())

    await expect(taskTitle(page, '인트로')).toBeVisible()
    await expect(confirmation(page)).toBeHidden()
    expect(await held(page)).toBe(0)
  })

  test('stays when the leave was declined before the save ended', async ({
    page,
  }) => {
    await recordTake(page, '&comparison-save=held')
    await inPanel(page, '비교하기').click()
    await saving(page)
    await otherTask(page).click()
    await expect(confirmation(page)).toBeVisible()
    await confirmation(page).getByRole('button', { name: '취소' }).click()
    await expect(confirmation(page)).toBeHidden()

    await releaseTakeSaves(page)

    // The saved take closes the panel; the leave declined earlier stays so.
    await expect(panel(page)).toBeHidden()
    await settle(page)
    await expect(taskTitle(page, '벌스 1')).toBeVisible()
    await expect(confirmation(page)).toBeHidden()
  })

  test('stays asked about when the save fails', async ({ page }) => {
    await recordTake(page, '&comparison-save=held')
    await inPanel(page, '비교하기').click()
    await saving(page)
    await otherTask(page).click()
    await expect(confirmation(page)).toBeVisible()

    await failTakeSaves(page)

    // The take is still unsaved, so the question still guards it.
    await expect(
      panel(page).getByText('연주를 저장하지 못했어요. 다시 시도해 주세요.'),
    ).toBeVisible()
    await settle(page)
    await expect(confirmation(page)).toBeVisible()
    await expect(taskTitle(page, '벌스 1')).toBeVisible()
  })
})

test.describe('a take begun before the section loaded', () => {
  // The separated guitar, which the section plays from, loads when asked.
  const HELD = '&scenario=pending-separated'
  const offsets = (page: Page) =>
    page.evaluate(() => window.workspaceTest.sourceOffsets())
  const loops = (page: Page) =>
    page.evaluate(() =>
      window.workspaceTest.audioSources().map((source) => source.loop),
    )
  const releaseGuitar = (page: Page) =>
    page.evaluate(() => window.workspaceTest.releaseSeparated())
  // Once the bar can play, the guitar has loaded and nothing else is coming.
  const loaded = (page: Page) =>
    expect(
      page
        .getByRole('region', { name: '구간 재생' })
        .getByRole('button', { name: '재생', exact: true }),
    ).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 })

  test('hears it join from the time already recorded', async ({ page }) => {
    await startRecording(page, HELD)
    await advance(page, 5)
    expect(await offsets(page)).toEqual([])

    await releaseGuitar(page)

    await expect.poll(() => offsets(page), { timeout: 10_000 }).toHaveLength(1)
    expect((await offsets(page))[0]).toBeCloseTo(5, 1)
    expect(await loops(page)).toEqual([false])
  })

  test('begun again hears it from where the new take is', async ({ page }) => {
    await startRecording(page, HELD)
    await advance(page, 5)
    await inPanel(page, '처음부터').click()
    await advance(page, 2)

    await releaseGuitar(page)

    await expect.poll(() => offsets(page), { timeout: 10_000 }).toHaveLength(1)
    expect((await offsets(page))[0]).toBeCloseTo(2, 1)
  })

  test('that already ran past the section stays quiet', async ({ page }) => {
    await startRecording(page, HELD)
    await advance(page, SECTION_SECONDS + 1)

    await releaseGuitar(page)

    await loaded(page)
    await settle(page)
    await expect(inPanel(page, '정지')).toBeVisible()
    expect(await offsets(page)).toEqual([])
  })

  test('stopped before it loaded stays quiet', async ({ page }) => {
    await recordTake(page, HELD, 5)

    await releaseGuitar(page)

    await loaded(page)
    await settle(page)
    expect(await offsets(page)).toEqual([])
  })

  test('thrown away before it loaded stays quiet', async ({ page }) => {
    await startRecording(page, HELD)
    await advance(page, 5)
    await closeButton(page).click()
    await confirmation(page).getByRole('button', { name: '그만두기' }).click()
    await expect(panel(page)).toBeHidden()

    await releaseGuitar(page)

    await loaded(page)
    await settle(page)
    expect(await offsets(page)).toEqual([])
  })

  test('records on its own when the section fails to load', async ({
    page,
  }) => {
    await recordTake(page, '&scenario=separated-error', 5)

    await expect(
      panel(page).getByText('00:05.0', { exact: true }),
    ).toBeVisible()
    expect(await offsets(page)).toEqual([])
  })
})

test.describe('the browser microphone', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium flags')
  const ENGINE_MODULE = '/src/features/recording/recorderEngine.ts'

  test('처음부터 starts the take over and keeps recording', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async (path) => {
      const { browserRecorderEngine } = await import(/* @vite-ignore */ path)
      let progressed = 0
      const request = browserRecorderEngine.open({
        onProgress(seconds: number) {
          progressed = seconds
        },
        onInterrupted() {},
      })
      const capture = await request.capture
      const heard = (seconds: number) =>
        new Promise<void>((resolve) => {
          const check = () =>
            progressed >= seconds ? resolve() : setTimeout(check, 20)
          check()
        })
      await heard(0.5)
      capture.restart()
      const restarted = capture.elapsedSeconds()
      progressed = 0
      await heard(0.5)
      const { samples, sampleRate } = capture.finish()
      request.release()
      return {
        restarted,
        seconds: samples.length / sampleRate,
        elapsed: capture.elapsedSeconds(),
      }
    }, ENGINE_MODULE)

    expect(result.restarted).toBe(0)
    expect(result.seconds).toBeGreaterThanOrEqual(0.5)
    expect(result.seconds).toBeCloseTo(result.elapsed, 3)
  })
})
