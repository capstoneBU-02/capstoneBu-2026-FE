import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

// The list follows changes made outside the open screen (#28).

const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: RegExp) =>
  sidebar(page).getByRole('button', { name })
const songHeading = (page: Page, name: string) =>
  sidebar(page).getByRole('button', { name, exact: true })
const rows = (page: Page) => main(page).locator('tbody tr')
const editButton = (page: Page) =>
  main(page).getByRole('button', { name: '구간 수정' })
// The top bar's own button; the dialog's 멈추기 sits deeper inside it.
const stopButton = (page: Page) =>
  main(page).locator('header > button', { hasText: '멈추기' })

type Change = Parameters<Window['workspaceTest']['updateTaskOnServer']>[1]

const updateOnServer = (page: Page, taskId: string, change: Change) =>
  page.evaluate(
    ([id, next]) => window.workspaceTest.updateTaskOnServer(id, next),
    [taskId, change] as const,
  )
const listCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.listCalls())
const holdNextListLoad = (page: Page) =>
  page.evaluate(() => window.workspaceTest.holdNextListLoad())
const releaseListLoad = (page: Page) =>
  page.evaluate(() => window.workspaceTest.releaseListLoad())

// 새 구간 made in another tab.
const createOnServer = (page: Page) =>
  page.evaluate(() =>
    window.workspaceTest.createTaskOnServer({
      songId: 'song-neon-harbor',
      sectionName: '브리지',
      part: 'lead',
      tuningId: 'e-standard',
      rangeStartSeconds: 120,
      rangeEndSeconds: 140,
    }),
  )

// A long interval keeps the timer out of the way, so only the tab coming
// back or focus loads the list; 150 ms shows timed refreshes.
async function openHome(page: Page, refresh = 60_000) {
  await page.goto(`/tests/browser/harness.html?refresh=${refresh}`)
  await expect(rows(page)).toHaveCount(4)
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

const focusWindow = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event('focus')))

// Waits long enough for several refresh turns, then checks none ran.
async function expectNoMoreListCalls(page: Page) {
  const calls = await listCalls(page)
  await page.waitForTimeout(600)
  expect(await listCalls(page)).toBe(calls)
}

test('a tab shown again brings in other tabs’ changes and keeps the list as it was', async ({
  page,
}) => {
  await openHome(page)
  await songHeading(page, 'paper_moon_gtr_stem').click()
  await expect(songHeading(page, 'paper_moon_gtr_stem')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await sidebarTask(page, /^솔로/).focus()

  await updateOnServer(page, 'task-verse', { processingStatus: 'queued' })
  await createOnServer(page)
  await setHidden(page, true)
  await setHidden(page, false)

  await expect(sidebarTask(page, /^벌스 1/)).toContainText('대기')
  await expect(sidebarTask(page, /^브리지/)).toContainText('대기')
  await expect(rows(page)).toHaveCount(5)
  await expect(songHeading(page, 'paper_moon_gtr_stem')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(sidebarTask(page, /^솔로/)).toBeFocused()
})

test('window focus loads the list again', async ({ page }) => {
  await openHome(page)
  await updateOnServer(page, 'task-intro', { processingStatus: 'queued' })
  await focusWindow(page)
  await expect(sidebarTask(page, /^인트로/)).toContainText('대기')
})

test('while a task runs the list follows it, and stops once none does', async ({
  page,
}) => {
  await openHome(page, 150)
  await updateOnServer(page, 'task-solo', { progressPercent: 80 })
  await expect(sidebarTask(page, /^솔로/)).toContainText('80%')

  await updateOnServer(page, 'task-solo', {
    processingStatus: 'completed',
    progressPercent: null,
  })
  await expect(sidebarTask(page, /^솔로/)).not.toContainText('%')
  await expectNoMoreListCalls(page)
})

test('a hidden tab stops loading the list until it is shown', async ({
  page,
}) => {
  await openHome(page, 150)
  await setHidden(page, true)
  await expectNoMoreListCalls(page)

  await updateOnServer(page, 'task-solo', { progressPercent: 90 })
  await setHidden(page, false)
  await expect(sidebarTask(page, /^솔로/)).toContainText('90%')
})

test('a failed refresh keeps the list and the next one catches up', async ({
  page,
}) => {
  await openHome(page)
  await updateOnServer(page, 'task-verse', { processingStatus: 'queued' })
  await page.evaluate(() =>
    window.workspaceTest.failNextListLoad('load-failed'),
  )
  const calls = await listCalls(page)
  await focusWindow(page)
  await expect.poll(() => listCalls(page)).toBeGreaterThan(calls)

  await expect(title(page)).toHaveText('최근 작업')
  await expect(rows(page)).toHaveCount(4)
  await expect(sidebarTask(page, /^벌스 1/)).not.toContainText('대기')

  await focusWindow(page)
  await expect(sidebarTask(page, /^벌스 1/)).toContainText('대기')
})

test('expiry found by a refresh closes the workspace', async ({ page }) => {
  await openHome(page)
  await page.evaluate(() => window.workspaceTest.failNextListLoad('expired'))
  await focusWindow(page)
  await expect(
    page.getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(sidebarTask(page, /^벌스 1/)).toHaveCount(0)
})

test('the open task follows a change the list brings in', async ({ page }) => {
  await page.goto(
    '/tests/browser/harness.html?refresh=60000&view=task&task=task-verse',
  )
  await expect(title(page)).toHaveText('벌스 1')
  await expect(editButton(page)).toBeVisible()

  // Another tab sends 구간 수정 for the task this one shows as done.
  await page.evaluate(() =>
    window.workspaceTest.queueTaskOnServer('task-verse'),
  )
  await focusWindow(page)

  await expect(sidebarTask(page, /^벌스 1/)).toContainText('대기')
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(editButton(page)).toHaveCount(0)
})

test('a refresh on its way still lands when the last running task finishes', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?refresh=60000&view=task&task=task-solo',
  )
  await expect(title(page)).toHaveText('솔로')
  await holdNextListLoad(page)
  // Another tab made 브리지 while 솔로 finished.
  await createOnServer(page)
  await updateOnServer(page, 'task-solo', {
    processingStatus: 'completed',
    progressPercent: null,
  })
  await focusWindow(page)

  // The open task answers first, leaving the list no running task.
  await expect(sidebarTask(page, /^솔로/)).not.toContainText('%')
  await releaseListLoad(page)
  await expect(sidebarTask(page, /^브리지/)).toContainText('대기')
})

test('a task stopped while the list loads does not come back', async ({
  page,
}) => {
  // Task loads wait here, so only the stop tells the list about 솔로.
  await page.goto(
    '/tests/browser/harness.html?refresh=60000&scenario=pending-task&view=task&task=task-solo',
  )
  await expect(
    main(page).getByRole('heading', { name: '작업을 여는 중이에요' }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-solo'))
  await expect(stopButton(page)).toBeVisible()

  await updateOnServer(page, 'task-intro', { processingStatus: 'queued' })
  await holdNextListLoad(page)
  const calls = await listCalls(page)
  await focusWindow(page)
  await expect.poll(() => listCalls(page)).toBe(calls + 1)

  await stopButton(page).click()
  await page
    .getByRole('alertdialog', { name: '솔로 작업을 멈출까요?' })
    .getByRole('button', { name: '멈추기' })
    .click()
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)

  // The held answer still lists 솔로; 인트로 shows that it landed.
  await releaseListLoad(page)
  await expect(sidebarTask(page, /^인트로/)).toContainText('대기')
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)
})
