import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const TASK = 'task-verse'

const main = (page: Page) => page.locator('#workspace-content')
const views = (page: Page) =>
  main(page).getByRole('tablist', { name: '작업 화면' })
const view = (page: Page, name: RegExp) =>
  views(page).getByRole('tab', { name })
const tabView = (page: Page) => view(page, /^타브/)
const comparisonView = (page: Page) => view(page, /^비교/)
const record = (page: Page) =>
  main(page).getByRole('button', { name: '녹음', exact: true })

function openTask(page: Page, query = '&comparison=1') {
  return page.goto(`/tests/browser/harness.html?view=task&task=${TASK}${query}`)
}

test('a finished task opens on its tab, with 비교 beside it', async ({
  page,
}) => {
  await openTask(page)

  await expect(tabView(page)).toHaveAttribute('aria-selected', 'true')
  await expect(comparisonView(page)).toHaveAttribute('aria-selected', 'false')
  await expect(
    main(page).getByRole('region', { name: '타브', exact: true }),
  ).toBeVisible()
})

test('arrow keys move between the two views', async ({ page }) => {
  await openTask(page)

  await tabView(page).focus()
  await page.keyboard.press('ArrowRight')

  await expect(comparisonView(page)).toBeFocused()
  await expect(comparisonView(page)).toHaveAttribute('aria-selected', 'true')
  await expect(
    main(page).getByRole('region', { name: '타브', exact: true }),
  ).toBeHidden()

  await page.keyboard.press('ArrowLeft')

  await expect(tabView(page)).toBeFocused()
  await expect(tabView(page)).toHaveAttribute('aria-selected', 'true')
})

test('녹음 in the top bar opens the 비교 view', async ({ page }) => {
  await openTask(page)

  await record(page).click()

  await expect(comparisonView(page)).toHaveAttribute('aria-selected', 'true')
})

test('without a comparison repository the task shows its tab alone', async ({
  page,
}) => {
  await openTask(page, '')

  await expect(
    main(page).getByRole('region', { name: '타브', exact: true }),
  ).toBeVisible()
  await expect(views(page)).toHaveCount(0)
  await expect(record(page)).toHaveCount(0)
})
