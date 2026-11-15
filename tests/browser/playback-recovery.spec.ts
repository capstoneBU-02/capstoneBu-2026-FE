import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'
import type { TaskStage } from '../../src/features/workspace/model.ts'

const main = (page: Page) => page.locator('#workspace-content')
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const play = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pause = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const OUTPUT_FAILURE =
  '음원을 재생하지 못했어요. 재생 버튼을 눌러 다시 시도해 주세요.'

async function openPlayer(page: Page, screen: 'task' | 'editor') {
  const view =
    screen === 'task'
      ? 'view=task&task=task-verse'
      : 'view=new-section&song=song-neon-harbor'
  await page.goto(`/tests/browser/harness.html?${view}`)
  if (screen === 'editor') {
    await main(page).getByLabel('시작', { exact: true }).fill('00:10.0')
    await main(page).getByLabel('끝', { exact: true }).fill('00:20.0')
    await main(page).getByLabel('끝', { exact: true }).press('Tab')
  }
  await expect(play(page)).toHaveAttribute('aria-disabled', 'false', {
    timeout: 15_000,
  })
  await play(page).click()
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
    .toEqual(['running'])
  await pause(page).click()
}

for (const screen of ['task', 'editor'] as const) {
  test(`output resume failure in the ${screen} restores play and allows retry`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openPlayer(page, screen)
    await page.evaluate(() => window.workspaceTest.holdOutputResume())
    await play(page).click()
    await expect
      .poll(() =>
        page.evaluate(() => window.workspaceTest.pendingOutputResumes()),
      )
      .toBe(1)
    await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
    await expect(play(page)).toBeVisible()
    await expect(play(page)).toBeFocused()
    await expect(player(page).getByRole('alert')).toHaveText(OUTPUT_FAILURE)
    const held = await player(page).getByTestId('elapsed').textContent()
    await page.waitForTimeout(250)
    await expect(player(page).getByTestId('elapsed')).toHaveText(held!)
    if (screen === 'task')
      await expect(
        main(page).getByRole('button', { name: '내려받기', exact: true }),
      ).toBeVisible({ timeout: 15_000 })
    await play(page).click()
    await expect(pause(page)).toBeVisible()
    await expect(player(page).getByRole('alert')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
      .toEqual(['running'])
    await expect(player(page).getByTestId('elapsed')).not.toHaveText(held!)
    expect(errors).toEqual([])
  })
}

test('changing tracks clears the old output failure even when returning to that track', async ({
  page,
}) => {
  await openPlayer(page, 'task')
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.workspaceTest.pendingOutputResumes()),
    )
    .toBe(1)
  await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
  await expect(player(page).getByRole('alert')).toHaveText(OUTPUT_FAILURE)
  for (const name of ['원곡', '분리 기타']) {
    await player(page).getByRole('radio', { name, exact: true }).check()
    await expect(play(page)).toHaveAttribute('aria-disabled', 'false', {
      timeout: 15_000,
    })
    await expect(player(page).getByRole('alert')).toHaveCount(0)
  }
  await play(page).click()
  await expect(pause(page)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
    .toEqual(['running'])
})

test('a late output failure after leaving a task does not report an error in the list', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openPlayer(page, 'task')
  await page.evaluate(() => window.workspaceTest.holdOutputResume())
  await play(page).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.workspaceTest.pendingOutputResumes()),
    )
    .toBe(1)
  await page
    .getByRole('complementary')
    .getByRole('button', { name: '내 작업', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  await page.evaluate(() => window.workspaceTest.settleOutputResume(false))
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.audioContexts()))
    .toEqual(['closed'])
  await page.waitForTimeout(100)
  expect(errors).toEqual([])
  await expect(page.getByText(OUTPUT_FAILURE)).toHaveCount(0)
})

test('a separation failure names the same stage in the list and task headline', async ({
  page,
}) => {
  await page.goto('/?demo=task-states')
  const row = page.locator('tbody tr').filter({ hasText: '벌스 2' })
  await expect(row).toContainText('기타 분리 실패')
  await row.getByRole('button').click()
  await expect(
    main(page).getByText('기타 분리 실패', { exact: true }),
  ).toBeVisible()
  await expect(
    main(page).getByRole('heading', { name: '기타를 분리하지 못했어요' }),
  ).toBeVisible()
})

for (const hasSeparatedAudio of [false, true]) {
  test(`detail failure stage overrides audio availability (${hasSeparatedAudio})`, async ({
    page,
  }) => {
    await page.goto('/tests/browser/harness.html')
    await expect(page.locator('tbody tr')).toHaveCount(4)
    // Deliberately differs from the list's inference. Both detail labels
    // must read the supplied stages, not infer from available audio again.
    const stages: TaskStage[] = hasSeparatedAudio
      ? [
          { id: 'separation', status: 'failed' },
          { id: 'transcription', status: 'waiting' },
        ]
      : [
          { id: 'separation', status: 'done' },
          { id: 'transcription', status: 'failed' },
        ]
    await page.evaluate(
      ({ hasSeparatedAudio, stages }) =>
        window.workspaceTest.updateTaskOnServer('task-verse', {
          processingStatus: 'failed',
          failureKind: 'transcription',
          hasSeparatedAudio,
          stages,
        }),
      { hasSeparatedAudio, stages },
    )
    await page
      .getByRole('complementary')
      .getByRole('button', { name: /벌스 1/ })
      .click()
    await expect(
      main(page).getByRole('heading', {
        name: hasSeparatedAudio
          ? '기타를 분리하지 못했어요'
          : '타브를 만들지 못했어요',
      }),
    ).toBeVisible()
    await expect(
      main(page).getByText(hasSeparatedAudio ? '기타 분리 실패' : '타브 실패', {
        exact: true,
      }),
    ).toBeVisible()
  })
}

for (const task of ['task-solo', 'task-verse']) {
  test(`keyboard retry on ${task} shows the focused waveform`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/harness.html?view=task&task=${task}&scenario=separated-error`,
    )
    const retry = main(page).getByRole('button', {
      name: task === 'task-solo' ? '분리 기타 다시 시도' : '다시 불러오기',
      exact: true,
    })
    await expect(retry).toBeVisible({ timeout: 15_000 })
    await page.evaluate(() => window.workspaceTest.healAudio())
    await retry.focus()
    await retry.press('Enter')
    const waveform = main(page).getByRole('group', { name: '분리 기타 파형' })
    await expect(waveform).toHaveAttribute('data-state', 'ready', {
      timeout: 15_000,
    })
    await expect(waveform).toBeFocused()
    await expect(waveform).toHaveCSS('outline-style', 'solid')
    await expect(waveform).toHaveCSS('outline-width', '2px')
  })
}
