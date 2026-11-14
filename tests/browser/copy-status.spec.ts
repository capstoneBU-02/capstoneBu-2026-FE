import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: RegExp) =>
  sidebar(page).getByRole('button', { name })
const home = (page: Page) =>
  sidebar(page).getByRole('button', { name: '내 작업' })
const listRow = (page: Page, sectionName: string) =>
  page.locator('tbody tr').filter({ hasText: sectionName })
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const copied = (page: Page) =>
  main(page).getByRole('checkbox', { name: '카피 완료', exact: true })
const toMark = (page: Page) =>
  main(page).getByRole('checkbox', { name: '카피 완료로 표시' })
const copyBox = (page: Page) => main(page).getByRole('checkbox')
const saveFailure = (page: Page) =>
  main(page)
    .getByRole('alert')
    .filter({ hasText: '카피 완료를 저장하지 못했어요' })

const copyCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.copyCalls())

// Opens the list first, then the task from the sidebar.
async function openFromHome(page: Page, name: RegExp, query = '') {
  await page.goto(`/tests/browser/harness.html${query}`)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await sidebarTask(page, name).click()
  await expect(title(page)).toBeVisible()
}

async function expectListCopied(page: Page, section: string, done: boolean) {
  await home(page).click()
  const row = listRow(page, section)
  await expect(row).toHaveCount(1)
  if (done) await expect(row).toContainText('카피 완료')
  else await expect(row).not.toContainText('카피 완료')
}

test('a finished task is marked and unmarked as copied', async ({ page }) => {
  await openFromHome(page, /^벌스 1/)
  await expect(title(page)).toHaveText('벌스 1')
  await expect(copied(page)).toBeChecked()
  await expect(sidebarTask(page, /^벌스 1/)).toHaveAccessibleName(/카피 완료/)

  await copied(page).uncheck()
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).not.toHaveAttribute('aria-disabled', 'true')
  expect(await copyCalls(page)).toEqual([
    { taskId: 'task-verse', confirmed: false, aborted: false },
  ])
  await expect(sidebarTask(page, /^벌스 1/)).not.toHaveAccessibleName(
    /카피 완료/,
  )
  await expectListCopied(page, '벌스 1', false)

  await sidebarTask(page, /^벌스 1/).click()
  await toMark(page).press('Space')
  await expect(copied(page)).toBeChecked()
  await expect(sidebarTask(page, /^벌스 1/)).toHaveAccessibleName(/카피 완료/)
  await expectListCopied(page, '벌스 1', true)
  expect((await copyCalls(page)).map((call) => call.confirmed)).toEqual([
    false,
    true,
  ])
})

test('the box shows the value being saved and takes no more input', async ({
  page,
}) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(toMark(page)).toBeFocused()

  // aria-disabled keeps the box focusable, so force a click on it anyway.
  await toMark(page).click({ force: true })
  await toMark(page).press('Space')
  await expect(toMark(page)).not.toBeChecked()
  expect(await copyCalls(page)).toHaveLength(1)

  await page.evaluate(() => window.workspaceTest.resolveCopy())
  await expect(toMark(page)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).toBeFocused()
})

test('a failed save goes back to the saved value and says so', async ({
  page,
}) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await expect(toMark(page)).not.toBeChecked()

  await page.evaluate(() => window.workspaceTest.failCopy('copy-status-failed'))
  await expect(copied(page)).toBeChecked()
  await expect(copied(page)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(copied(page)).toBeFocused()
  await expect(saveFailure(page)).toHaveText(
    '카피 완료를 저장하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(sidebarTask(page, /^벌스 1/)).toHaveAccessibleName(/카피 완료/)

  // Trying again clears the message.
  await copied(page).click()
  await expect(saveFailure(page)).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.resolveCopy())
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).not.toHaveAttribute('aria-disabled', 'true')
})

test('leaving does not cancel a save, and coming back shows it', async ({
  page,
}) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')

  await home(page).click()
  // The server has not answered, so the list keeps its copy.
  await expect(listRow(page, '벌스 1')).toContainText('카피 완료')
  await sidebarTask(page, /^벌스 1/).click()
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')

  await home(page).click()
  await page.evaluate(() => window.workspaceTest.resolveCopy())
  await expect(listRow(page, '벌스 1')).not.toContainText('카피 완료')
  expect(await copyCalls(page)).toEqual([
    { taskId: 'task-verse', confirmed: false, aborted: false },
  ])
  await sidebarTask(page, /^벌스 1/).click()
  await expect(toMark(page)).not.toBeChecked()
  await expect(toMark(page)).not.toHaveAttribute('aria-disabled', 'true')
})

test('a save that fails after coming back says so', async ({ page }) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')

  await home(page).click()
  await sidebarTask(page, /^벌스 1/).click()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')
  await page.evaluate(() => window.workspaceTest.failCopy('copy-status-failed'))
  await expect(copied(page)).toBeChecked()
  await expect(copied(page)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(saveFailure(page)).toHaveText(
    '카피 완료를 저장하지 못했어요. 다시 시도해 주세요.',
  )
})

test('switching to another workspace cancels a save', async ({ page }) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await expect(toMark(page)).toHaveAttribute('aria-disabled', 'true')

  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(
    page.getByText('두 번째 작업 공간', { exact: true }),
  ).toBeVisible()
  expect(await copyCalls(page)).toEqual([
    { taskId: 'task-verse', confirmed: false, aborted: true },
  ])
})

test('a finished tab does not mark the copy done (COPY-04)', async ({
  page,
}) => {
  await openFromHome(page, /^솔로/, '?refresh=150')
  await expect(title(page)).toHaveText('솔로')
  await expect(copyBox(page)).toHaveCount(0)

  await page.evaluate(() =>
    window.workspaceTest.updateTaskOnServer('task-solo', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    }),
  )
  await expect(toMark(page)).toBeVisible()
  await expect(toMark(page)).not.toBeChecked()
  await expect(sidebarTask(page, /^솔로/)).not.toHaveAccessibleName(/카피 완료/)
  await expectListCopied(page, '솔로', false)
  expect(await copyCalls(page)).toEqual([])
})

test('a task without a finished tab has no copy box', async ({ page }) => {
  await openFromHome(page, /^인트로/)
  await expect(title(page)).toHaveText('인트로')
  await expect(copyBox(page)).toHaveCount(0)
})

test('an expired session while saving closes the workspace', async ({
  page,
}) => {
  await openFromHome(page, /^벌스 1/, '?scenario=pending-copy')
  await copied(page).click()
  await page.evaluate(() => window.workspaceTest.failCopy('expired'))
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
})
