import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const consentDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'AI 학습 활용' })
const settings = (page: Page) =>
  page.getByRole('button', { name: '설정', exact: true })

for (const view of [
  'home',
  'settings',
  'task-not-found',
  'task-inaccessible',
]) {
  test(`skip link preserves ${view}, URL and history while focusing content`, async ({
    page,
  }) => {
    await page.goto(`/?demo=workspace&view=${view}`)
    await expect(settings(page)).toBeEnabled()
    const previousUrl = page.url()
    const previousHistory = await page.evaluate(() => ({
      state: window.history.state as unknown,
      length: window.history.length,
    }))
    const previousHeading = await page
      .getByRole('heading', { level: 1 })
      .textContent()
    const skipLink = page.getByRole('link', { name: /건너뛰기/ })
    await skipLink.focus()
    await skipLink.press('Enter')

    await expect(page.locator('#workspace-content')).toBeFocused()
    await expect(page).toHaveURL(previousUrl)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      previousHeading!,
    )
    expect(
      await page.evaluate(() => ({
        state: window.history.state as unknown,
        length: window.history.length,
      })),
    ).toEqual(previousHistory)
  })
}

test('the mobile skip link scrolls to current content without navigating', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 })
  await page.goto('/?demo=workspace&view=settings')
  await expect(
    page.getByRole('heading', { name: '설정', exact: true }),
  ).toBeVisible()
  const previousUrl = page.url()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const skipLink = page.getByRole('link', { name: '본문으로 건너뛰기' })
  await skipLink.focus()
  await skipLink.press('Enter')
  const main = page.locator('#workspace-content')
  await expect(main).toBeFocused()
  await expect(page).toHaveURL(previousUrl)
  const bounds = await main.boundingBox()
  expect(bounds).not.toBeNull()
  expect(Math.abs(bounds!.y)).toBeLessThanOrEqual(1)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`sidebar rows keep their size and position across views at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const rows = [
      page.getByRole('button', { name: '내 작업', exact: true }),
      page.getByRole('button', { name: '도움말', exact: true }),
      settings(page),
    ]
    const layouts = []
    for (const view of ['home', 'settings', 'task-not-found']) {
      await page.goto(`/?demo=workspace&view=${view}`)
      await expect(page.locator('#workspace-content h1')).toBeVisible()
      if (viewport.width <= 700)
        await page.getByRole('button', { name: '탐색 메뉴 열기' }).click()
      await expect(settings(page)).toBeEnabled()
      layouts.push(
        await Promise.all(
          rows.map(async (row) => {
            const box = await row.boundingBox()
            expect(box).not.toBeNull()
            return { y: box!.y, height: box!.height }
          }),
        ),
      )
    }
    // Selecting a row may restyle it, but it must not shift the sidebar.
    expect(layouts[1]).toEqual(layouts[0])
    expect(layouts[2]).toEqual(layouts[0])
  })
}

test('a failed consent change after Back stays visible and can be retried without changing the saved choice', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-save')
  await expect(settings(page)).toBeEnabled()
  await settings(page).click()
  await page.getByRole('button', { name: '선택하기', exact: true }).click()
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await expect(consentDialog(page)).toHaveCount(0)
  await expect(page.getByText('현재 선택: 동의', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '변경하기', exact: true }).click()
  await consentDialog(page)
    .getByRole('button', { name: '동의하지 않아요' })
    .click()
  await expect(consentDialog(page).getByRole('status')).toHaveText(
    '선택을 저장하고 있어요.',
  )
  await page.goBack()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await expect(consentDialog(page)).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.rejectSave())

  await expect(page.getByRole('alert')).toContainText(
    '선택을 저장하지 못했어요.',
  )
  await page.getByRole('button', { name: 'AI 학습 활용 다시 선택' }).click()
  await expect(consentDialog(page).getByRole('alert')).toBeVisible()
  await expect(
    consentDialog(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  await consentDialog(page)
    .getByRole('button', { name: '동의하지 않아요' })
    .click()
  await expect(consentDialog(page).getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => window.workspaceTest.saveCalls())).toBe(3)
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await expect(consentDialog(page)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await settings(page).click()
  await expect(
    page.getByText('현재 선택: 동의하지 않음', { exact: true }),
  ).toBeVisible()
})

test('native close during saving preserves a late failure until it is acknowledged and does not leak into a new workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await page.goto('/tests/browser/harness.html?scenario=pending-save')
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await page.getByRole('button', { name: '선택하기', exact: true }).click()
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await consentDialog(page).evaluate((element) =>
    (element as HTMLDialogElement).close(),
  )
  // The native close event is queued. Wait until React unmounts the dialog,
  // not just until the closed element leaves the accessibility tree.
  await expect(page.locator('dialog')).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.rejectSave())
  await expect(page.getByRole('alert')).toContainText(
    '선택을 저장하지 못했어요.',
  )
  const retryButton = page.getByRole('button', {
    name: 'AI 학습 활용 다시 선택',
  })
  await expect(retryButton).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  )
  await retryButton.click()
  await expect(consentDialog(page).getByRole('alert')).toBeVisible()
  await consentDialog(page)
    .getByRole('button', { name: 'AI 학습 활용 창 닫기' })
    .click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '선택하기', exact: true }).click()
  await expect(consentDialog(page).getByRole('alert')).toHaveCount(0)
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(consentDialog(page)).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.rejectSave())
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'AI 학습 활용 다시 선택' }),
  ).toHaveCount(0)
})
