import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: RegExp) =>
  sidebar(page).getByRole('button', { name })
const panel = (page: Page) =>
  main(page).getByRole('region', {
    name: /^(순서를 기다리고 있어요|타브 만드는 중)$/,
  })
const progress = (page: Page) => panel(page).getByRole('progressbar')
const stages = (page: Page) =>
  panel(page).getByRole('list', { name: '처리 단계' }).getByRole('listitem')
const announcement = (page: Page) =>
  main(page).locator('[data-announcer="task-status"]')
const editButton = (page: Page) =>
  main(page).getByRole('button', { name: '구간 수정' })
const REFRESH_FAILED = '지금 상태를 불러오지 못했어요. 잠시 후 다시 확인할게요.'

type Change = Parameters<Window['workspaceTest']['updateTaskOnServer']>[1]

const updateOnServer = (page: Page, taskId: string, change: Change) =>
  page.evaluate(
    ([id, next]) => window.workspaceTest.updateTaskOnServer(id, next),
    [taskId, change] as const,
  )
const taskCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.taskCalls().length)

// Refreshes every 150 ms, so a server change shows within a few turns.
const openHarness = (page: Page, query = '') =>
  page.goto(`/tests/browser/harness.html?refresh=150${query}`)

async function openHome(page: Page) {
  await openHarness(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
}

// Waits long enough for several refresh turns, then checks none ran.
async function expectNoMoreCalls(page: Page) {
  const calls = await taskCalls(page)
  await page.waitForTimeout(600)
  expect(await taskCalls(page)).toBe(calls)
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

test('a queued task follows the server until its tab is done', async ({
  page,
}) => {
  await openHome(page)
  await updateOnServer(page, 'task-verse', {
    processingStatus: 'queued',
    hasSeparatedAudio: false,
    queueAhead: 2,
  })
  await sidebarTask(page, /^벌스 1/).click()

  await expect(panel(page)).toHaveAccessibleName('순서를 기다리고 있어요')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '0')
  await expect(stages(page)).toHaveText([
    '기타 분리, 기다리는 중',
    '타브 생성, 기다리는 중',
  ])
  await expect(
    panel(page).getByText(
      '앞에 작업 2개가 있어요. 창을 닫아도 순서는 그대로예요.',
    ),
  ).toBeVisible()
  await expect(editButton(page)).toHaveCount(0)
  // The list follows the task as it was loaded.
  await expect(sidebarTask(page, /^벌스 1/)).toContainText('대기')

  await updateOnServer(page, 'task-verse', { queueAhead: 0 })
  await expect(
    panel(page).getByText('바로 다음 순서예요. 창을 닫아도 순서는 그대로예요.'),
  ).toBeVisible()

  await updateOnServer(page, 'task-verse', {
    processingStatus: 'processing',
    progressPercent: 12,
  })
  await expect(panel(page)).toHaveAccessibleName('타브 만드는 중')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '12')
  await expect(panel(page).getByText('12%', { exact: true })).toBeVisible()
  await expect(stages(page)).toHaveText([
    '기타 분리, 진행 중',
    '타브 생성, 기다리는 중',
  ])
  await expect(
    panel(page).getByText('창을 닫아도 계속 진행돼요.'),
  ).toBeVisible()
  await expect(announcement(page)).toHaveText('기타 분리를 시작했어요.')
  await expect(main(page).getByText('진행 중', { exact: true })).toBeVisible()
  await expect(sidebarTask(page, /^벌스 1/)).toContainText('12%')

  await updateOnServer(page, 'task-verse', {
    progressPercent: 64,
    hasSeparatedAudio: true,
  })
  await expect(stages(page)).toHaveText([
    '기타 분리, 완료',
    '타브 생성, 진행 중',
  ])
  await expect(announcement(page)).toHaveText('타브 생성을 시작했어요.')
  // Progress alone is not read out again.
  await updateOnServer(page, 'task-verse', { progressPercent: 80 })
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '80')
  await expect(announcement(page)).toHaveText('타브 생성을 시작했어요.')

  await updateOnServer(page, 'task-verse', {
    processingStatus: 'completed',
    progressPercent: null,
  })
  await expect(announcement(page)).toHaveText('타브를 다 만들었어요.')
  await expect(
    main(page).getByRole('heading', { name: '작업 화면 준비 중' }),
  ).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  await expect(editButton(page)).toBeVisible()
  // A finished task shows its name alone in the list.
  await expect(sidebarTask(page, /^벌스 1/)).toHaveText('벌스 1')
  // A finished task is not loaded again.
  await expectNoMoreCalls(page)
})

test('a failed task shows its failure and stops refreshing', async ({
  page,
}) => {
  await openHarness(page, '&view=task&task=task-solo')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await updateOnServer(page, 'task-solo', {
    processingStatus: 'failed',
    failureKind: 'transcription',
    progressPercent: null,
  })
  await expect(announcement(page)).toHaveText('타브를 만들지 못했어요.')
  await expect(main(page).getByText('타브 실패', { exact: true })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  await expect(sidebarTask(page, /^솔로/)).not.toContainText('64%')
  await expectNoMoreCalls(page)
})

test('separated-guitar input shows separation as skipped', async ({ page }) => {
  await openHome(page)
  await updateOnServer(page, 'task-intro', {
    processingStatus: 'processing',
    failureKind: null,
    progressPercent: 30,
  })
  await sidebarTask(page, /^인트로/).click()
  await expect(stages(page)).toHaveText([
    '기타 분리건너뜀',
    '타브 생성, 진행 중',
  ])
  await expect(stages(page).first().getByText('건너뜀')).toBeVisible()
  // Opening the task is not a change to announce.
  await expect(announcement(page)).toHaveText('')
})

test('refreshing stops when the user leaves and a late answer changes nothing', async ({
  page,
}) => {
  await openHarness(page, '&scenario=pending-task&view=task&task=task-solo')
  await expect(
    main(page).getByRole('heading', { name: '작업을 여는 중이에요' }),
  ).toBeVisible()
  // Every call so far opens the task, so any later one is a refresh. Counting
  // after the answer would miss a refresh sent while the screen was busy.
  const opening = await taskCalls(page)
  expect(opening).toBeGreaterThan(0)
  await page.evaluate(() => window.workspaceTest.resolveTask('task-solo'))
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  // The next refresh is sent and left waiting.
  await expect.poll(() => taskCalls(page)).toBeGreaterThan(opening)
  await updateOnServer(page, 'task-solo', { progressPercent: 90 })

  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(
    main(page).getByRole('heading', { name: '최근 작업' }),
  ).toBeVisible()
  await expectNoMoreCalls(page)

  // The list loads the server's 90% on its own (#28). A hidden tab stops
  // that, so a late answer bringing 95% would be the only way it changes.
  await expect(sidebarTask(page, /^솔로/)).toContainText('90%')
  await setHidden(page, true)
  await updateOnServer(page, 'task-solo', { progressPercent: 95 })
  await page.evaluate(() => window.workspaceTest.resolveTask('task-solo'))
  await page.waitForTimeout(600)
  await expect(sidebarTask(page, /^솔로/)).toContainText('90%')
  await expect(
    main(page).getByRole('heading', { name: '최근 작업' }),
  ).toBeVisible()
})

test('opening another task stops the first one refreshing', async ({
  page,
}) => {
  await openHome(page)
  await updateOnServer(page, 'task-verse', {
    processingStatus: 'processing',
    progressPercent: 20,
    hasSeparatedAudio: false,
  })
  await sidebarTask(page, /^솔로/).click()
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await updateOnServer(page, 'task-solo', {
    processingStatus: 'queued',
    hasSeparatedAudio: false,
    progressPercent: null,
  })
  await expect(announcement(page)).toHaveText('순서를 기다리고 있어요.')

  await sidebarTask(page, /^벌스 1/).click()
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '20')
  // The new task starts without the last task's announcement.
  await expect(announcement(page)).toHaveText('')
  const soloCalls = async () =>
    (await page.evaluate(() => window.workspaceTest.taskCalls())).filter(
      (id) => id === 'task-solo',
    ).length
  const before = await soloCalls()
  const verseBefore = await taskCalls(page)
  await page.waitForTimeout(600)
  expect(await soloCalls()).toBe(before)
  // The open task keeps refreshing.
  expect(await taskCalls(page)).toBeGreaterThan(verseBefore)
})

test('구간 수정 keeps the copy it opened with and does not refresh', async ({
  page,
}) => {
  await openHarness(page, '&view=edit-section&task=task-solo')
  await expect(
    main(page).getByRole('heading', {
      level: 1,
      name: '구간을 바꿀 수 없어요',
    }),
  ).toBeVisible()
  await expectNoMoreCalls(page)
})

test('a hidden tab stops refreshing and catches up when shown', async ({
  page,
}) => {
  await openHarness(page, '&view=task&task=task-solo')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await setHidden(page, true)
  await updateOnServer(page, 'task-solo', { progressPercent: 70 })
  await expectNoMoreCalls(page)
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')

  await setHidden(page, false)
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '70')
})

test('a failed refresh keeps the task on screen and tries again', async ({
  page,
}) => {
  await openHarness(page, '&view=task&task=task-solo')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await page.evaluate(() =>
    window.workspaceTest.failNextTaskLoad('load-failed'),
  )
  await expect(panel(page).getByRole('status')).toHaveText(REFRESH_FAILED)
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')

  await updateOnServer(page, 'task-solo', { progressPercent: 72 })
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '72')
  await expect(panel(page).getByRole('status')).toHaveText('')
})

test('a task that disappears while open shows the missing-task notice', async ({
  page,
}) => {
  await openHarness(page, '&view=task&task=task-solo')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await page.evaluate(() =>
    window.workspaceTest.failNextTaskLoad('task-unavailable'),
  )
  await expect(
    main(page).getByRole('heading', { name: '작업을 찾을 수 없어요' }),
  ).toBeVisible()
  await expectNoMoreCalls(page)
})

test('an expired workspace found by a refresh closes the workspace', async ({
  page,
}) => {
  await openHarness(page, '&view=task&task=task-solo')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await page.evaluate(() => window.workspaceTest.failNextTaskLoad('expired'))
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(
    sidebar(page).getByRole('button', { name: /^솔로/ }),
  ).toHaveCount(0)
})

test('the demo shows the running task with its stages', async ({ page }) => {
  await page.goto('/?demo=workspace&view=task&task=task-solo')
  await expect(panel(page)).toHaveAccessibleName('타브 만드는 중')
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
  await expect(stages(page)).toHaveText([
    '기타 분리, 완료',
    '타브 생성, 진행 중',
  ])
})

for (const width of [390, 320]) {
  test(`at ${width}px the processing panel fits without sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await openHarness(page, '&view=task&task=task-solo')
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '64')
    await updateOnServer(page, 'task-solo', {
      processingStatus: 'queued',
      hasSeparatedAudio: false,
      progressPercent: null,
      queueAhead: 12,
    })
    await expect(panel(page)).toHaveAccessibleName('순서를 기다리고 있어요')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    const box = await progress(page).boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  })
}
