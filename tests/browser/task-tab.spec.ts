import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const tracks = (page: Page) => main(page).getByRole('region', { name: '트랙' })
const lane = (page: Page, label: string) =>
  tracks(page)
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator('[data-state]')
const position = (page: Page) =>
  tracks(page).getByRole('slider', { name: '재생 위치' })
const panel = (page: Page) =>
  main(page).getByRole('region', { name: '타브', exact: true })
const staff = (page: Page) =>
  panel(page).getByRole('img', { name: /^타브 악보/ })
const overlay = (page: Page) => panel(page).locator('[data-mark="current-bar"]')
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const playButton = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pauseButton = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const restartButton = (page: Page) =>
  player(page).getByRole('button', { name: '구간 처음으로' })
const choice = (page: Page, label: string) =>
  player(page)
    .getByRole('group', { name: '재생 트랙' })
    .getByRole('radio', { name: label, exact: true })
const elapsed = (page: Page) => player(page).getByTestId('elapsed')

const commits = (page: Page) =>
  page.evaluate(() => window.workspaceTest.commits())
// Requests the screen still waits for; StrictMode cancels a duplicate.
const liveTabCalls = (page: Page) =>
  page.evaluate(() =>
    window.workspaceTest
      .tabCalls()
      .filter((call) => !call.aborted)
      .map((call) => call.taskId),
  )

// Synthesis, decoding and peaks take a moment on a loaded machine.
const AUDIO_TIMEOUT = { timeout: 15_000 }
function openTask(page: Page, taskId: string, query = '') {
  return page.goto(
    `/tests/browser/harness.html?view=task&task=${taskId}${query}`,
  )
}

async function openReadyVerse(page: Page) {
  await openTask(page, 'task-verse')
  for (const label of ['분리 기타', '원곡'])
    await expect(lane(page, label)).toHaveAttribute(
      'data-state',
      'ready',
      AUDIO_TIMEOUT,
    )
  await expect(staff(page)).toBeVisible()
}

// Clicks the waveforms this far across the section while paused.
async function seekTo(page: Page, ratio: number) {
  const box = (await position(page).boundingBox())!
  await position(page).click({
    position: { x: box.width * ratio, y: box.height / 2 },
  })
}

test('a finished task shows its tab below the tracks', async ({ page }) => {
  await openTask(page, 'task-verse')
  // 00:42.1–01:05.8 is 23.7 s: twelve two-second bars.

  await expect(
    panel(page).getByRole('heading', { level: 2, name: '타브' }),
  ).toBeVisible()
  await expect(panel(page).getByText('초안 · 자동 생성')).toBeVisible()
  await expect(staff(page)).toHaveAccessibleName('타브 악보 12마디')
  await expect(
    main(page).getByRole('heading', { name: '작업 화면 준비 중' }),
  ).toHaveCount(0)
  const above = (await tracks(page).boundingBox())!
  const tab = (await panel(page).boundingBox())!
  expect(tab.y).toBeGreaterThanOrEqual(above.y + above.height)
  expect(await liveTabCalls(page)).toEqual(['task-verse'])
})

test('a running task gets its tab once it finishes', async ({ page }) => {
  await openTask(page, 'task-solo', '&refresh=150')
  await expect(main(page).getByRole('heading', { name: '솔로' })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  expect(await liveTabCalls(page)).toEqual([])

  await page.evaluate(() =>
    window.workspaceTest.updateTaskOnServer('task-solo', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    }),
  )
  // 02:31.0–02:52.4 is 21.4 s: eleven bars, the last one running past it.
  await expect(staff(page)).toHaveAccessibleName('타브 악보 11마디')
  expect(await liveTabCalls(page)).toEqual(['task-solo'])
})

test('a section changed elsewhere gets its new tab', async ({ page }) => {
  await openTask(page, 'task-verse', '&refresh=150')
  await expect(staff(page)).toHaveAccessibleName('타브 악보 12마디')

  // Another tab shortens the section, and it finishes again before this tab
  // ever sees it running.
  await page.evaluate(() => {
    window.workspaceTest.reviseTaskOnServer('task-verse', {
      sectionName: '벌스 1',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 42.1,
      rangeEndSeconds: 50,
    })
    window.workspaceTest.updateTaskOnServer('task-verse', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    })
  })
  // 00:42.1–00:50.0 is 7.9 s: four bars.
  await expect(staff(page)).toHaveAccessibleName('타브 악보 4마디')
})

test('the tab area waits for its tab and retries a failed request', async ({
  page,
}) => {
  await openTask(page, 'task-verse', '&scenario=pending-tab')
  await expect(panel(page).getByRole('status')).toHaveText(
    '타브를 불러오는 중이에요',
  )

  await page.evaluate(() => window.workspaceTest.failTab('tab-unavailable'))
  await expect(panel(page).getByRole('alert')).toContainText(
    '타브를 불러오지 못했어요. 다시 시도해 주세요.',
  )
  // The rest of the task stays usable.
  await expect(tracks(page)).toBeVisible()
  await expect(player(page)).toBeVisible()

  await panel(page).getByRole('button', { name: '다시 시도' }).click()
  // The button goes with the failure, so focus stays in the tab area.
  await expect(
    panel(page).getByRole('heading', { level: 2, name: '타브' }),
  ).toBeFocused()
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await expect(panel(page).getByRole('status')).toHaveText(
    '타브를 불러오는 중이에요',
  )
  await page.evaluate(() => window.workspaceTest.resolveTab())
  await expect(staff(page)).toHaveAccessibleName('타브 악보 12마디')
})

test('a tab the screen cannot read fails inside the tab area', async ({
  page,
}) => {
  await openTask(page, 'task-verse', '&scenario=pending-tab')
  await expect(panel(page).getByRole('status')).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveTabWithBadFormat())
  await expect(panel(page).getByRole('alert')).toContainText(
    '타브를 표시하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(tracks(page)).toBeVisible()

  await panel(page).getByRole('button', { name: '다시 시도' }).click()
  await page.evaluate(() => window.workspaceTest.resolveTab())
  await expect(staff(page)).toHaveAccessibleName('타브 악보 12마디')
})

test('an expired session while loading the tab closes the workspace', async ({
  page,
}) => {
  await openTask(page, 'task-verse', '&scenario=pending-tab')
  await expect(panel(page).getByRole('status')).toBeVisible()
  await page.evaluate(() => window.workspaceTest.failTab('expired'))
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
})

test('leaving the task cancels its tab request', async ({ page }) => {
  await openTask(page, 'task-verse', '&scenario=pending-tab')
  await expect(panel(page).getByRole('status')).toBeVisible()
  expect(await liveTabCalls(page)).toEqual(['task-verse'])

  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(panel(page)).toHaveCount(0)
  expect(await liveTabCalls(page)).toEqual([])
})

test('the current bar follows playback without rendering the page', async ({
  page,
}) => {
  await openReadyVerse(page)
  await expect(overlay(page)).toHaveAttribute('data-bar', '1')

  // 30% of 23.7 s is 7.1 s, in the fourth bar; a paused seek moves the box.
  await seekTo(page, 0.3)
  await expect(elapsed(page)).toHaveText('00:07.1')
  await expect(overlay(page)).toHaveAttribute('data-bar', '4')

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await page.waitForTimeout(200)
  const rendered = await commits(page)
  const drawn = await staff(page).elementHandle()
  // The fifth bar starts at 8 s.
  await expect(overlay(page)).toHaveAttribute('data-bar', '5', {
    timeout: 5_000,
  })
  expect(await commits(page)).toBe(rendered)
  // The tab itself stays as drawn.
  expect(await drawn!.evaluate((node) => node.isConnected)).toBe(true)
})

test('the current bar stays put across a track switch and a restart', async ({
  page,
}) => {
  await openReadyVerse(page)
  await seekTo(page, 0.3)
  await expect(overlay(page)).toHaveAttribute('data-bar', '4')

  // The original counts from the section start too, so the bar holds.
  await choice(page, '원곡').check()
  await expect(choice(page, '원곡')).toBeChecked()
  await expect(elapsed(page)).toHaveText('00:07.1')
  await expect(overlay(page)).toHaveAttribute('data-bar', '4')

  await restartButton(page).click()
  await expect(elapsed(page)).toHaveText('00:00.0')
  await expect(overlay(page)).toHaveAttribute('data-bar', '1')
})
