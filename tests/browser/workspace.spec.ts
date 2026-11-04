import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'AI 학습 활용' })
const settings = (page: Page) =>
  page.getByRole('button', { name: '설정 — AI 학습 활용 선택', exact: true })

async function openHarness(page: Page, scenario: string) {
  await page.goto(`/tests/browser/harness.html?scenario=${scenario}`)
  await expect(settings(page)).toBeEnabled()
}

test('expiry closes the dialog and retry does not reopen it; disabled trigger falls back to main', async ({
  page,
}) => {
  await openHarness(page, 'save-expired')
  await settings(page).click()
  await page.getByRole('button', { name: '동의해요', exact: true }).click()

  await expect(
    page.getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
  await expect(settings(page)).toBeDisabled()
  await expect(page.locator('#workspace-content')).toBeFocused()
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
  await settings(page).click()
  await expect(dialog(page)).toBeVisible()
})

test('closing and reopening clears a prior save error without changing the choice', async ({
  page,
}) => {
  await page.goto('/?demo=consent-error')
  await page.getByRole('button', { name: '선택하기' }).click()
  await page.getByRole('button', { name: '동의해요', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'AI 학습 활용 창 닫기' }).click()
  await page.getByRole('button', { name: '선택하기' }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('alert')).toHaveCount(0)
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('sidebar distinguishes loading, error and expiry from a successfully empty workspace', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-load')
  const loading = page
    .getByRole('status')
    .filter({ hasText: '작업을 불러오고 있어요' })
  await expect(loading).toBeVisible()
  await expect(page.getByText('아직 곡이 없어요')).toHaveCount(0)
  expect(
    await loading.evaluate((element) => element.closest('[aria-busy="true"]')),
  ).toBeNull()

  for (const scenario of ['error', 'expired']) {
    await page.goto(`/?demo=${scenario}`)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText('아직 곡이 없어요')).toHaveCount(0)
  }
  await page.goto('/?demo=empty')
  await expect(page.getByText('아직 곡이 없어요')).toBeVisible()
})

test('native close while saving permits reopening, and a prior save cannot close the new dialog', async ({
  page,
}) => {
  await openHarness(page, 'pending-save')
  await settings(page).click()
  await page.getByRole('button', { name: '동의해요', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '동의하지 않아요' }),
  ).toBeDisabled()
  const saving = dialog(page).getByRole('status')
  await expect(saving).toHaveText('선택을 저장하고 있어요.')
  expect(
    await saving.evaluate((element) => element.closest('[aria-busy="true"]')),
  ).toBeNull()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // Exercise the native close event independently of each Chromium version's
  // repeat-Escape policy, while keeping the actual production handler mounted.
  if (await dialog(page).isVisible()) {
    await dialog(page).evaluate((element) =>
      (element as HTMLDialogElement).close(),
    )
  }
  await expect(dialog(page)).toHaveCount(0)
  await settings(page).click()
  await expect(dialog(page)).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await expect(
    dialog(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  await expect(dialog(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: '동의해요', exact: true }),
  ).toBeEnabled()
})

test('dragging dialog text outside does not dismiss it, while a backdrop click does', async ({
  page,
}) => {
  await page.goto('/?demo=workspace')
  await page.getByRole('button', { name: '선택하기' }).click()
  const description = dialog(page).getByText(
    '올린 음원을 AI 학습에 써도 될까요?',
    { exact: false },
  )
  const bounds = await description.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + 12, bounds!.y + 10)
  await page.mouse.down()
  await page.mouse.move(8, 8, { steps: 8 })
  await page.mouse.up()
  await expect(dialog(page)).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(dialog(page)).toHaveCount(0)
})

test('late load and save completions cannot overwrite a replacement workspace', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-load')
  await expect(
    page.getByRole('heading', { name: '작업을 불러오고 있어요' }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(
    page.getByText('두 번째 작업 공간', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.releaseLoads())
  await expect(
    page.getByText('두 번째 작업 공간', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)

  await openHarness(page, 'pending-save')
  await settings(page).click()
  await page.getByRole('button', { name: '동의해요', exact: true }).click()
  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(dialog(page)).toHaveCount(0)
  await expect(
    page.getByText('두 번째 작업 공간', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await settings(page).click()
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('the hook rejects concurrent saves before a render and preserves an existing choice on failure', async ({
  page,
}) => {
  await openHarness(page, 'pending-save')
  await page.evaluate(() => window.workspaceTest.saveTwice())
  expect(await page.evaluate(() => window.workspaceTest.saveCalls())).toBe(1)
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await settings(page).click()
  await expect(
    dialog(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '동의하지 않아요' }).click()
  await page.evaluate(() => window.workspaceTest.rejectSave())
  await expect(dialog(page).getByRole('alert')).toBeVisible()
  await expect(
    dialog(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
})

test('mobile navigation and a removed consent trigger restore focus to visible main content', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=workspace')
  await page.getByRole('button', { name: '선택하기' }).waitFor()
  await expect(
    page.getByRole('img', { name: 'earmark', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '탐색 메뉴 열기' }).click()
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('button', { name: '내 작업' })
    .click()
  await expect(page.locator('#workspace-content')).toBeFocused()
  await page.getByRole('button', { name: '선택하기' }).click()
  await page.getByRole('button', { name: '동의하지 않아요' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('#workspace-content')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
})
