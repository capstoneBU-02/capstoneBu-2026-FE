import { expect, test, type Page } from '@playwright/test'
import { DEMO_ACCESS_CODES } from '../../src/app/demoConfig.ts'
import type {} from './access-harness.tsx'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: string | RegExp) =>
  sidebar(page).getByRole('button', {
    name,
    exact: typeof name === 'string',
  })
const loadingTask = (page: Page) =>
  main(page).getByRole('status').filter({ hasText: '작업을 여는 중이에요' })
const SECTION_NAMES = ['벌스 1', '솔로', '인트로', '코러스 2']

async function settleRendering(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
}

test('a list row opens a read-only task header and history reopens the same task', async ({
  page,
}) => {
  await page.goto('/?demo=workspace')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page
    .locator('tbody')
    .getByRole('button', { name: /^벌스 1/ })
    .click()

  await expect(page).toHaveURL('/?demo=workspace&view=task&task=task-verse')
  await expect(main(page)).toBeFocused()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(page.getByRole('navigation', { name: '작업 위치' })).toHaveText(
    /neon_harbor_live\s*벌스 1/,
  )
  await expect(main(page).getByText('완료', { exact: true })).toBeVisible()
  for (const text of [
    '00:42.1–01:05.8',
    '리듬 기타',
    'E 표준 6현',
    '입력 · 원곡에서 기타 분리',
    'neon_harbor_live.mp3',
  ]) {
    await expect(main(page).getByText(text, { exact: true })).toBeVisible()
  }
  await expect(
    main(page).getByRole('heading', { name: '작업 화면 준비 중' }),
  ).toBeVisible()
  await expect(sidebarTask(page, '벌스 1')).toHaveAttribute(
    'aria-current',
    'page',
  )
  // Unimplemented task actions are not offered as working controls.
  await expect(main(page).getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)

  await page.goBack()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await expect(sidebarTask(page, '벌스 1')).not.toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.goForward()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(page).toHaveURL('/?demo=workspace&view=task&task=task-verse')
})

test('sidebar sections switch tasks, mark the current one and keep back/forward order', async ({
  page,
}) => {
  await page.goto('/?demo=workspace')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await sidebarTask(page, '인트로').click()
  await expect(title(page)).toHaveText('인트로')
  await expect(main(page).getByText('타브 실패', { exact: true })).toBeVisible()
  await expect(
    main(page).getByText('입력 · 올린 기타 음원', { exact: true }),
  ).toBeVisible()
  await expect(sidebarTask(page, '인트로')).toHaveAttribute(
    'aria-current',
    'page',
  )

  const historyLength = await page.evaluate(() => window.history.length)
  await sidebarTask(page, '인트로').click()
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength)

  await sidebarTask(page, /^솔로/).click()
  await expect(title(page)).toHaveText('솔로')
  await expect(main(page).getByText('진행 중', { exact: true })).toBeVisible()
  await expect(sidebarTask(page, '인트로')).not.toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.goBack()
  await expect(title(page)).toHaveText('인트로')
  await expect(sidebarTask(page, '인트로')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.goBack()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await page.goForward()
  await expect(title(page)).toHaveText('인트로')
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await expect(main(page)).toBeFocused()
})

test('clicking any cell of a row opens that task', async ({ page }) => {
  await page.goto('/?demo=workspace')
  await page
    .locator('tbody tr')
    .filter({ hasText: '코러스 2' })
    .getByText('03:10.0–03:31.0')
    .click()
  await expect(title(page)).toHaveText('코러스 2')
  await expect(
    main(page).getByText('기타를 찾지 못함', { exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL('/?demo=workspace&view=task&task=task-chorus')
})

test('malformed and unknown task ids show the generic notice without task data', async ({
  page,
}) => {
  await page.goto('/?demo=workspace&view=task&task=..%2Fprivate')
  await expect(page).toHaveURL('/?demo=workspace&view=task-not-found')
  await expect(
    main(page).getByRole('heading', { name: '작업을 찾을 수 없어요' }),
  ).toBeVisible()
  const genericMessage = await main(page).innerText()

  await page.goto('/?demo=workspace&view=task&task=someone-elses-private-task')
  await expect(
    main(page).getByRole('heading', { name: '작업을 찾을 수 없어요' }),
  ).toBeVisible()
  expect(await main(page).innerText()).toBe(genericMessage)
  for (const section of SECTION_NAMES) {
    expect(await main(page).innerText()).not.toContain(section)
  }
  await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(0)
  await page.getByRole('button', { name: '내 작업으로', exact: true }).click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await expect(main(page)).toBeFocused()
})

test('a late response for a previous task never replaces the task being opened', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-task')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await sidebarTask(page, '벌스 1').click()
  await expect(loadingTask(page)).toBeVisible()
  await sidebarTask(page, /^솔로/).click()
  await expect(sidebarTask(page, /^솔로/)).toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await settleRendering(page)
  await expect(loadingTask(page)).toBeVisible()
  await expect(main(page).getByText('벌스 1')).toHaveCount(0)

  await page.evaluate(() => window.workspaceTest.resolveTask('task-solo'))
  await expect(title(page)).toHaveText('솔로')
  await expect(page.getByRole('navigation', { name: '작업 위치' })).toHaveText(
    /neon_harbor_live\s*솔로/,
  )

  // Going back starts a fresh request instead of showing the stale result.
  await page.goBack()
  await expect(loadingTask(page)).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await expect(title(page)).toHaveText('벌스 1')
})

test('a failed task request can be retried and a late failure is ignored', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-task')
  await sidebarTask(page, '인트로').click()
  await expect(loadingTask(page)).toBeVisible()
  await page.evaluate(() =>
    window.workspaceTest.failTask('task-intro', 'load-failed'),
  )
  await expect(
    main(page).getByRole('heading', { name: '작업을 열지 못했어요' }),
  ).toBeVisible()
  await expect(main(page).getByRole('alert')).toHaveText(
    '잠시 후 다시 시도해 주세요.',
  )
  const calls = (await page.evaluate(() => window.workspaceTest.taskCalls()))
    .length
  await main(page).getByRole('button', { name: '다시 시도' }).click()
  await expect(loadingTask(page)).toBeVisible()
  await expect(main(page)).toBeFocused()
  expect(
    (await page.evaluate(() => window.workspaceTest.taskCalls())).length,
  ).toBeGreaterThan(calls)

  await sidebarTask(page, '코러스 2').click()
  await page.evaluate(() =>
    window.workspaceTest.failTask('task-intro', 'task-unavailable'),
  )
  await settleRendering(page)
  await expect(loadingTask(page)).toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-chorus'))
  await expect(title(page)).toHaveText('코러스 2')
})

for (const width of [390, 320]) {
  test(`mobile navigation opens a task, closes the drawer and avoids overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/?demo=workspace')
    const menu = page.getByRole('button', { name: '탐색 메뉴 열기' })
    await menu.click()
    await sidebarTask(page, '인트로').click()
    await expect(title(page)).toHaveText('인트로')
    await expect(main(page)).toBeFocused()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
  })
}

test('an expired session while opening a task offers code re-entry', async ({
  page,
}) => {
  await page.goto('/tests/browser/access-harness.html')
  await page
    .getByRole('textbox', { name: '테스터 코드', exact: true })
    .fill(DEMO_ACCESS_CODES.returningWorkspace)
  await page.keyboard.press('Enter')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.evaluate(() => window.accessTest.expireSession())
  await sidebarTask(page, '벌스 1').click()
  const expiredTitle = main(page).getByRole('heading', {
    name: '작업 공간을 열 수 없어요',
  })
  await expect(expiredTitle).toBeVisible()
  // Expiry hides the whole workspace, not just the task body.
  await expect(sidebar(page)).not.toContainText('neon_harbor_live')
  await expect(sidebarTask(page, '벌스 1')).toHaveCount(0)
  await page.getByRole('button', { name: '내 작업', exact: true }).click()
  await expect(expiredTitle).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.getByRole('button', { name: '코드 다시 입력' }).click()
  await expect(
    page.getByRole('textbox', { name: '테스터 코드', exact: true }),
  ).toBeFocused()
})

test('reopening a task waits for a fresh result instead of showing the previous one', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-task')
  await sidebarTask(page, '벌스 1').click()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await expect(title(page)).toHaveText('벌스 1')
  await sidebar(page)
    .getByRole('button', { name: '내 작업', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await sidebarTask(page, '벌스 1').click()
  await settleRendering(page)
  await expect(loadingTask(page)).toBeVisible()
  await expect(page.getByRole('navigation', { name: '작업 위치' })).toHaveCount(
    0,
  )
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await expect(title(page)).toHaveText('벌스 1')

  await sidebarTask(page, '인트로').click()
  await page.evaluate(() =>
    window.workspaceTest.failTask('task-intro', 'load-failed'),
  )
  await expect(title(page)).toHaveText('작업을 열지 못했어요')
  await sidebarTask(page, /^솔로/).click()
  await sidebarTask(page, '인트로').click()
  await settleRendering(page)
  await expect(loadingTask(page)).toBeVisible()
  await expect(main(page).getByRole('alert')).toHaveCount(0)
})

test('a previous task that settles after the current one cannot replace it', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-task')
  await sidebarTask(page, '벌스 1').click()
  await sidebarTask(page, /^솔로/).click()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-solo'))
  await expect(title(page)).toHaveText('솔로')
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await settleRendering(page)
  await expect(title(page)).toHaveText('솔로')

  await sidebarTask(page, '인트로').click()
  await sidebarTask(page, '코러스 2').click()
  await page.evaluate(() => window.workspaceTest.resolveTask('task-chorus'))
  await expect(title(page)).toHaveText('코러스 2')
  await page.evaluate(() =>
    window.workspaceTest.failTask('task-intro', 'load-failed'),
  )
  await settleRendering(page)
  await expect(title(page)).toHaveText('코러스 2')
  await expect(main(page).getByRole('alert')).toHaveCount(0)
})

test('a task response from a replaced workspace is ignored', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=pending-task')
  await sidebarTask(page, '벌스 1').click()
  await expect(loadingTask(page)).toBeVisible()
  await page.evaluate(() => window.workspaceTest.switchWorkspace())
  await expect(title(page)).toHaveText('작업을 찾을 수 없어요')
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await settleRendering(page)
  await expect(title(page)).toHaveText('작업을 찾을 수 없어요')
  await expect(page.getByRole('navigation', { name: '작업 위치' })).toHaveCount(
    0,
  )
})

test('a task id outside the URL rule opens the generic notice without a request', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=odd-task-id')
  await page
    .locator('tbody')
    .getByRole('button', { name: /^벌스 1/ })
    .click()
  await expect(page).toHaveURL(/[?&]view=task-not-found(&|$)/)
  await expect(title(page)).toHaveText('작업을 찾을 수 없어요')
  expect(await page.evaluate(() => window.workspaceTest.taskCalls())).toEqual(
    [],
  )
  await page.goBack()
  await page.goForward()
  await expect(title(page)).toHaveText('작업을 찾을 수 없어요')
})

test('retrying a failed workspace load keeps focus in the content area', async ({
  page,
}) => {
  await page.goto('/?demo=error')
  await main(page).getByRole('button', { name: '다시 시도' }).click()
  await expect(main(page)).toBeFocused()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
})
