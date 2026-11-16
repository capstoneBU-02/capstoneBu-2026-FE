import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const play = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pause = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const cancel = (page: Page) =>
  player(page).getByRole('button', { name: '재생 시작 취소', exact: true })
const outputFailure = (page: Page) =>
  player(page)
    .getByRole('alert')
    .filter({ hasText: '음원을 재생하지 못했어요' })

async function openPlayer(page: Page, screen: 'task' | 'editor' = 'task') {
  await page.goto(
    `/tests/browser/harness.html?${screen === 'task' ? 'view=task&task=task-verse' : 'view=new-section&song=song-neon-harbor'}`,
  )
  if (screen === 'editor') {
    await main(page).getByLabel('시작', { exact: true }).fill('00:10.0')
    await main(page).getByLabel('끝', { exact: true }).fill('00:20.0')
    await main(page).getByLabel('끝', { exact: true }).press('Tab')
  }
  await expect(play(page)).toHaveAttribute('aria-disabled', 'false', {
    timeout: 15_000,
  })
  // The normal click path works before a pending resume is injected.
  await play(page).click()
  await expect(
    player(page).getByRole('button', { name: '일시정지' }),
  ).toBeVisible()
  await player(page).getByRole('button', { name: '일시정지' }).click()
}

for (const screen of ['task', 'editor'] as const) {
  test(`pending output in ${screen} can be cancelled without losing position`, async ({
    page,
  }) => {
    await openPlayer(page, screen)
    const held = await player(page).getByTestId('elapsed').textContent()
    await page.evaluate(() => window.workspaceTest.holdOutputResume())
    await play(page).click()
    await expect(cancel(page)).toBeFocused()
    await expect(player(page).getByRole('status')).toHaveText(
      '재생 시작을 기다리고 있어요. 취소한 뒤 다시 시도할 수 있어요.',
    )
    await expect(
      player(page).getByRole('button', { name: '일시정지' }),
    ).toHaveCount(0)
    await cancel(page).click()
    await expect(play(page)).toBeFocused()
    await expect(player(page).getByRole('status')).toHaveCount(0)
    await page.evaluate(() => window.workspaceTest.settleOutputResume(true))
    await expect(play(page)).toBeVisible()
    await expect(player(page).getByTestId('elapsed')).toHaveText(held!)
    await expect(outputFailure(page)).toHaveCount(0)
    await play(page).click()
    await expect(
      player(page).getByRole('button', { name: '일시정지' }),
    ).toBeVisible()
    await expect(player(page).getByTestId('elapsed')).not.toHaveText(held!)
  })
}

// WebKit opens a new output suspended, so even an ordinary first play resumes
// it; that takes milliseconds and is not a wait to tell the user about.
test('an output that resumes at once never shows the waiting state', async ({
  page,
}) => {
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.suspendOutput())
  const shown = await page.evaluateHandle(() => {
    const region = document.querySelector(
      '#workspace-content [aria-label="구간 재생"]',
    )!
    const seen: string[] = []
    new MutationObserver(() => {
      if (region.querySelector('[role="status"]')) seen.push('notice')
      if (region.querySelector('[aria-label="재생 시작 취소"]'))
        seen.push('cancel')
    }).observe(region, { subtree: true, childList: true, attributes: true })
    return seen
  })
  await play(page).click()
  await expect(pause(page)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
    .toEqual(['running'])
  expect(await shown.jsonValue()).toEqual([])
})

test('successful resume clears the waiting notice and starts the clock', async ({
  page,
}) => {
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await expect(cancel(page)).toBeVisible()
  const held = await player(page).getByTestId('elapsed').textContent()
  await page.evaluate(() => window.workspaceTest.settleOutputResume(true))
  await expect(player(page).getByRole('status')).toHaveCount(0)
  await expect(
    player(page).getByRole('button', { name: '일시정지' }),
  ).toBeFocused()
  await expect(player(page).getByTestId('elapsed')).not.toHaveText(held!)
})

test('late rejection of a cancelled attempt leaves the next attempt pending', async ({
  page,
}) => {
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await cancel(page).click()
  await play(page).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.workspaceTest.pendingOutputResumes()),
    )
    .toBe(2)
  await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
  await expect(cancel(page)).toBeVisible()
  await expect(outputFailure(page)).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.settleOutputResume(true))
  await expect(
    player(page).getByRole('button', { name: '일시정지' }),
  ).toBeVisible()
})

test('synchronous failures replace the announcement and retain keyboard focus', async ({
  page,
}) => {
  const diagnostics: unknown[][] = []
  page.on('console', async (message) => {
    if (
      message.type() === 'warning' &&
      message.text().startsWith('[earmark:audio-output]')
    )
      diagnostics.push(
        await Promise.all(message.args().map((arg) => arg.jsonValue())),
      )
  })
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.failOutputStart(true))
  await play(page).focus()
  await play(page).press('Enter')
  await expect(outputFailure(page)).toBeVisible()
  const first = await outputFailure(page).elementHandle()
  await play(page).press('Enter')
  await expect(outputFailure(page)).toBeVisible()
  await expect
    .poll(() => first!.evaluate((element) => element.isConnected))
    .toBe(false)
  await expect(play(page)).toBeFocused()
  await expect.poll(() => diagnostics.length).toBe(2)
  expect(diagnostics).toEqual([
    ['[earmark:audio-output]', { stage: 'start', reason: 'TypeError' }],
    ['[earmark:audio-output]', { stage: 'start', reason: 'TypeError' }],
  ])
  await page.evaluate(() => window.workspaceTest.failOutputStart(false))
  await play(page).press('Enter')
  await expect(outputFailure(page)).toHaveCount(0)
  await expect(
    player(page).getByRole('button', { name: '일시정지' }),
  ).toBeFocused()
})

test('repeated async failures produce new alerts without moving focus', async ({
  page,
}) => {
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await expect(cancel(page)).toBeVisible()
  await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
  await expect(outputFailure(page)).toBeVisible()
  const first = await outputFailure(page).elementHandle()
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).press('Enter')
  await expect(cancel(page)).toBeFocused()
  await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
  await expect(outputFailure(page)).toBeVisible()
  expect(await first!.evaluate((element) => element.isConnected)).toBe(false)
  await expect(play(page)).toBeFocused()
})

test('a late resume success after leaving does not restore playback or its notice', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openPlayer(page)
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await expect(cancel(page)).toBeVisible()
  await page
    .getByRole('complementary')
    .getByRole('button', { name: '내 작업', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await page.evaluate(() => window.workspaceTest.settleOutputResume(true))
  await expect
    .poll(() =>
      page.evaluate(() => window.workspaceTest.pendingOutputResumes()),
    )
    .toBe(0)
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
    .toEqual(['closed'])
  await expect(player(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const width of [320, 390]) {
  test(`both output and download failures keep their controls usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await openPlayer(page)
    await page.route('**/*.ttf', (route) => route.abort())
    await main(page)
      .getByRole('button', { name: '내려받기', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'PDF', exact: true }).click()
    const download = player(page)
      .getByRole('alert')
      .filter({ hasText: '타브를 내려받지 못했어요.' })
    await expect(download).toBeVisible()
    await page.evaluate(() => window.workspaceTest.failOutputStart(true))
    await play(page).click()
    await expect(outputFailure(page)).toBeVisible()
    const top = (await download.boundingBox())!
    const bottom = (await outputFailure(page).boundingBox())!
    const button = (await play(page).boundingBox())!
    expect(top.x).toBeGreaterThanOrEqual(0)
    expect(top.x + top.width).toBeLessThanOrEqual(width)
    expect(top.y + top.height).toBeLessThanOrEqual(bottom.y)
    expect(bottom.x + bottom.width).toBeLessThanOrEqual(width)
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(button.y)
    await expect(
      download.getByRole('button', { name: '다시 시도' }),
    ).toBeInViewport()
    await expect(play(page)).toBeInViewport()
  })
}
