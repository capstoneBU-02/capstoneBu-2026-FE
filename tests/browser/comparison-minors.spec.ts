import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'
import type {} from './harness/recording.ts'

declare global {
  interface Window {
    minorRequest: { reject(): void; aborted: boolean }
  }
}

const main = (page: Page) => page.locator('#workspace-content')
const panel = (page: Page) =>
  page.getByRole('region', { name: '벌스 1 녹음', exact: true })
const otherTask = (page: Page) =>
  page
    .getByRole('complementary')
    .getByRole('button', { name: '인트로', exact: true })

async function open(page: Page) {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1',
  )
  await main(page).getByRole('tab', { name: /^비교/ }).click()
}

async function holdComparison(page: Page) {
  await page.route('**/mockComparisonRepository.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const signature = 'async requestComparison(performanceId, signal) {'
    expect(source).toContain(signature)
    const body = source.replace(
      signature,
      `${signature}
      await new Promise((resolve, reject) => {
        window.minorRequest = { reject: () => reject(new Error('request failed')), aborted: false };
        signal.addEventListener('abort', () => { window.minorRequest.aborted = true; reject(signal.reason); });
      });`,
    )
    await route.fulfill({ response, body })
  })
}

for (const source of ['upload', 'recording'] as const) {
  test(`a saved ${source} leaves while comparison waits and reports its later failure`, async ({
    page,
  }) => {
    await holdComparison(page)
    await open(page)
    if (source === 'upload') {
      await main(page)
        .getByRole('button', { name: '파일 올리기', exact: true })
        .click()
      const dialog = page.getByRole('dialog', { name: '연주 파일 올리기' })
      await dialog.locator('input[type=file]').setInputFiles({
        name: 'slow.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.alloc(1536),
      })
      await expect
        .poll(() =>
          page.evaluate(() => window.workspaceTest.probeCalls().length),
        )
        .toBe(1)
      await page.evaluate(() => window.workspaceTest.resolveProbe(24.1))
      await dialog
        .getByRole('button', { name: '비교하기', exact: true })
        .click()
    } else {
      await main(page)
        .getByRole('button', { name: '녹음', exact: true })
        .click()
      await panel(page)
        .getByRole('button', { name: '녹음 시작', exact: true })
        .click()
      await expect(
        panel(page).getByText('녹음 중', { exact: true }),
      ).toBeVisible()
      await page.evaluate(() => window.recordingTest.advance(12))
      await panel(page)
        .getByRole('button', { name: '정지', exact: true })
        .click()
      await panel(page)
        .getByRole('button', { name: '비교하기', exact: true })
        .click()
    }
    await page.waitForFunction(() => window.minorRequest !== undefined)
    await expect(
      page.getByRole('dialog', { name: '연주 파일 올리기' }),
    ).toHaveCount(0)
    await expect(panel(page)).toHaveCount(0)
    await otherTask(page).click()
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      '인트로',
    )
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await page.evaluate(() => window.minorRequest.aborted)).toBe(false)
    await page.evaluate(() => window.minorRequest.reject())
    await expect(main(page).getByRole('alert')).toContainText('벌스 1')
    await expect(main(page).getByRole('alert')).toContainText(
      '연주는 저장됐지만 비교를 시작하지 못했어요',
    )
    await main(page)
      .getByRole('button', { name: '알림 닫기', exact: true })
      .click()
    await expect(main(page).getByRole('alert')).toHaveCount(0)
    await expect(main(page)).toBeFocused()
  })
}

test('changing workspace cancels a saved take request and drops its late notice', async ({
  page,
}) => {
  await holdComparison(page)
  await open(page)
  await main(page).getByRole('button', { name: '녹음', exact: true }).click()
  await panel(page).focus()
  await expect(panel(page)).toBeFocused()
  await panel(page)
    .getByRole('button', { name: '녹음 시작', exact: true })
    .click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  await page.evaluate(() => window.recordingTest.advance(12))
  await panel(page).getByRole('button', { name: '정지', exact: true }).click()
  await panel(page)
    .getByRole('button', { name: '비교하기', exact: true })
    .click()
  await page.waitForFunction(() => window.minorRequest !== undefined)
  await expect(panel(page)).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(
    page.getByText('두 번째 작업 공간', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.minorRequest.aborted)).toBe(true)
  await page.evaluate(() => window.minorRequest.reject())
  await expect(main(page).getByRole('alert')).toHaveCount(0)
})

test('a microphone lost during a pending leave is announced on the destination', async ({
  page,
}) => {
  await open(page)
  await main(page).getByRole('button', { name: '녹음', exact: true }).click()
  await panel(page)
    .getByRole('button', { name: '녹음 시작', exact: true })
    .click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  await otherTask(page).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.evaluate(() => window.recordingTest.disconnect())
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '인트로',
  )
  await expect(main(page).getByRole('alert')).toContainText(
    '벌스 1 녹음이 중단되어 저장되지 않았어요',
  )
})

test('a missing comparison can be recreated from the saved take', async ({
  page,
}) => {
  await page.route('**/mockComparisonRepository.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const signature = 'async loadStatus(comparisonId, signal) {'
    expect(source).toContain(signature)
    await route.fulfill({
      response,
      body: source.replace(
        signature,
        `${signature}
      if (comparisonId === 'comparison-1') comparisons.delete(comparisonId);`,
      ),
    })
  })
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-seed=compared&comparison-run=instant',
  )
  await main(page).getByRole('tab', { name: /^비교/ }).click()
  await expect(
    main(page).getByText('저장된 비교를 찾을 수 없어요'),
  ).toBeVisible()
  await main(page)
    .getByRole('button', { name: '새로 비교하기', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: '다시 들어볼 곳' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    main(page).getByRole('combobox', { name: '연주' }).locator('option'),
  ).toHaveCount(1)
})
