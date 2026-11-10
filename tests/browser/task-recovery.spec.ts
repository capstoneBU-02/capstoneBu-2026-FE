import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: RegExp) =>
  sidebar(page).getByRole('button', { name })
// The top bar's own button; the dialog's 멈추기 sits deeper inside it.
const stopButton = (page: Page) =>
  main(page).locator('header > button', { hasText: '멈추기' })
const stopDialog = (page: Page, sectionName: string) =>
  page.getByRole('alertdialog', { name: `${sectionName} 작업을 멈출까요?` })
const stopNotice = (page: Page) =>
  main(page).getByRole('status').filter({ hasText: '작업을 멈췄어요.' })
const endedNotice = (page: Page) =>
  main(page)
    .getByRole('status')
    .filter({ hasText: '작업이 이미 끝나서 멈출 수 없어요.' })
const failurePanel = (page: Page, name: string) =>
  main(page).getByRole('region', { name })
const processingPanel = (page: Page) =>
  main(page).getByRole('region', { name: '순서를 기다리고 있어요' })

const STOP_FAILED = '작업을 멈추지 못했어요. 잠시 후 다시 시도해 주세요.'
const RETRY_FAILED = '다시 시도하지 못했어요. 잠시 후 다시 시도해 주세요.'

type Change = Parameters<Window['workspaceTest']['updateTaskOnServer']>[1]

const updateOnServer = (page: Page, taskId: string, change: Change) =>
  page.evaluate(
    ([id, next]) => window.workspaceTest.updateTaskOnServer(id, next),
    [taskId, change] as const,
  )
const setRetriesUsed = (page: Page, taskId: string, used: number) =>
  page.evaluate(
    ([id, count]) => window.workspaceTest.setRetriesUsed(id, count),
    [taskId, used] as const,
  )
const cancelCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.cancelCalls())
const retryCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.retryCalls())

async function openHome(page: Page, scenario?: string) {
  await page.goto(
    `/tests/browser/harness.html${scenario ? `?scenario=${scenario}` : ''}`,
  )
  await expect(page.locator('tbody tr')).toHaveCount(4)
}

// Opened from the list, so Back has somewhere inside the app to go.
async function openTaskFromHome(
  page: Page,
  name: RegExp,
  sectionName: string,
  scenario?: string,
) {
  await openHome(page, scenario)
  await sidebarTask(page, name).click()
  await expect(title(page)).toHaveText(sectionName)
}

// Playwright waits for an aria-disabled button to enable before clicking, so
// tests activate a busy button the way a keyboard user would.
async function pressButton(page: Page, name: string, scope = main(page)) {
  await scope.getByRole('button', { name, exact: true }).focus()
  await page.keyboard.press('Enter')
}

test('멈추기 asks first, then takes the task off the list', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로')
  await stopButton(page).click()

  const dialog = stopDialog(page, '솔로')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleDescription(
    '멈춘 작업은 목록에서 사라지고 되돌릴 수 없어요. 분리한 기타 음원도 함께 지워져요. 곡은 그대로 남아 새 구간을 만들 수 있어요.',
  )
  await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()

  // 취소 changes nothing.
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(stopButton(page)).toBeFocused()
  expect(await cancelCalls(page)).toEqual([])

  await stopButton(page).click()
  await dialog.getByRole('button', { name: '멈추기' }).click()

  await expect(title(page)).toHaveText('최근 작업')
  await expect(page).toHaveURL('/tests/browser/harness.html')
  await expect(main(page)).toBeFocused()
  await expect(stopNotice(page)).toHaveText('솔로 작업을 멈췄어요.')
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)
  // The song stays for a new section.
  await expect(
    sidebar(page).getByText('neon_harbor_live', { exact: true }),
  ).toBeVisible()
  expect(await cancelCalls(page)).toEqual(['task-solo'])
})

test('the stop notice stays on the list until the user moves on', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로')
  await stopButton(page).click()
  await stopDialog(page, '솔로').getByRole('button', { name: '멈추기' }).click()
  await expect(stopNotice(page)).toHaveText('솔로 작업을 멈췄어요.')

  await main(page)
    .getByRole('group', { name: '작업 상태 필터' })
    .getByRole('button', { name: /^실패/ })
    .click()
  await expect(stopNotice(page)).toHaveText('솔로 작업을 멈췄어요.')

  await sidebarTask(page, /^벌스 1/).click()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(stopNotice(page)).toHaveCount(0)
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(title(page)).toHaveText('최근 작업')
  await expect(stopNotice(page)).toHaveCount(0)
})

test('a queued task names what else goes with it', async ({ page }) => {
  await openHome(page)
  await updateOnServer(page, 'task-verse', {
    processingStatus: 'queued',
    hasSeparatedAudio: false,
    queueAhead: 1,
  })
  await sidebarTask(page, /^벌스 1/).click()
  await expect(processingPanel(page)).toBeVisible()
  await stopButton(page).click()
  // Nothing was separated yet.
  await expect(stopDialog(page, '벌스 1')).toHaveAccessibleDescription(
    '멈춘 작업은 목록에서 사라지고 되돌릴 수 없어요. 곡은 그대로 남아 새 구간을 만들 수 있어요.',
  )
})

test('a changed section warns that its previous results go too', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?view=task&task=task-verse')
  await main(page).getByRole('button', { name: '구간 수정' }).click()
  const end = main(page).getByLabel('끝', { exact: true })
  await end.fill('01:00.0')
  await end.press('Tab')
  await pressButton(page, '타브 다시 만들기')
  await expect(processingPanel(page)).toBeVisible()

  await stopButton(page).click()
  await expect(stopDialog(page, '벌스 1')).toHaveAccessibleDescription(
    '멈춘 작업은 목록에서 사라지고 되돌릴 수 없어요. 이전 결과도 함께 지워져요. 곡은 그대로 남아 새 구간을 만들 수 있어요.',
  )
})

test('a stop in progress cannot be sent twice and a failure keeps the dialog', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로', 'pending-cancel')
  await stopButton(page).click()
  const dialog = stopDialog(page, '솔로')
  await dialog.getByRole('button', { name: '멈추기' }).click()

  const busy = dialog.getByRole('button', { name: '멈추는 중…' })
  await expect(busy).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByRole('button', { name: '취소' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(dialog.getByRole('status')).toHaveText('멈추는 중…')
  // Neither Esc nor a second press ends the wait or sends again.
  await page.keyboard.press('Escape')
  await pressButton(page, '멈추는 중…', dialog)
  await expect(dialog).toBeVisible()
  expect(await cancelCalls(page)).toEqual(['task-solo'])
  // Chrome closes a dialog on a repeated Esc; the failure opens it again.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.evaluate(() =>
    window.workspaceTest.failCancel('cancel-task-failed'),
  )
  await expect(dialog.getByRole('alert')).toHaveText(STOP_FAILED)
  await expect(dialog.getByRole('button', { name: '멈추기' })).toHaveAttribute(
    'aria-disabled',
    'false',
  )
  await expect(title(page)).toHaveText('솔로')
  await expect(sidebarTask(page, /^솔로/)).toBeVisible()

  // Sending again clears the failure.
  await dialog.getByRole('button', { name: '멈추기' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.resolveCancel())
  await expect(title(page)).toHaveText('최근 작업')
  await expect(stopNotice(page)).toHaveText('솔로 작업을 멈췄어요.')
})

test('a stop that ends after the user left only updates the list', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로', 'pending-cancel')
  await stopButton(page).click()
  await stopDialog(page, '솔로').getByRole('button', { name: '멈추기' }).click()
  await page.goBack()
  await expect(title(page)).toHaveText('최근 작업')
  await sidebarTask(page, /^벌스 1/).click()
  await expect(title(page)).toHaveText('벌스 1')

  await page.evaluate(() => window.workspaceTest.resolveCancel())
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)
  await expect(title(page)).toHaveText('벌스 1')
  await expect(page).toHaveURL(/task=task-verse$/)
  await expect(stopNotice(page)).toHaveCount(0)
})

test('an expired session while stopping closes the workspace', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로', 'pending-cancel')
  await stopButton(page).click()
  await stopDialog(page, '솔로').getByRole('button', { name: '멈추기' }).click()
  await page.evaluate(() => window.workspaceTest.failCancel('expired'))
  await expect(stopDialog(page, '솔로')).toHaveCount(0)
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
})

test('a task that finishes while the dialog is open loses 멈추기', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?refresh=150&view=task&task=task-solo',
  )
  await expect(title(page)).toHaveText('솔로')
  await stopButton(page).click()
  await expect(stopDialog(page, '솔로')).toBeVisible()

  await updateOnServer(page, 'task-solo', {
    processingStatus: 'completed',
    progressPercent: null,
  })
  await expect(stopDialog(page, '솔로')).toHaveCount(0)
  await expect(stopButton(page)).toHaveCount(0)
  await expect(main(page)).toBeFocused()
  // Said outside the dialog, which kept the page from being read.
  await expect(endedNotice(page)).toHaveText(
    '솔로 작업이 이미 끝나서 멈출 수 없어요.',
  )
  expect(await cancelCalls(page)).toEqual([])
})

test('a stop refused because the task just finished says why', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=pending-cancel&view=task&task=task-solo',
  )
  await expect(title(page)).toHaveText('솔로')
  await stopButton(page).click()
  const dialog = stopDialog(page, '솔로')
  await dialog.getByRole('button', { name: '멈추기' }).click()
  await expect(dialog.getByRole('button', { name: '멈추는 중…' })).toBeVisible()

  // The task finished before the server took the request; the screen has
  // not seen it yet.
  await updateOnServer(page, 'task-solo', {
    processingStatus: 'completed',
    progressPercent: null,
  })
  await page.evaluate(() =>
    window.workspaceTest.failCancel('cancel-task-failed'),
  )
  await expect(dialog).toHaveCount(0)
  await expect(endedNotice(page)).toHaveText(
    '솔로 작업이 이미 끝나서 멈출 수 없어요.',
  )
  await expect(main(page).getByText('완료', { exact: true })).toBeVisible()
  await expect(stopButton(page)).toHaveCount(0)
  await expect(main(page)).toBeFocused()
  expect(await cancelCalls(page)).toEqual(['task-solo'])

  // The notice belongs to that task.
  await sidebarTask(page, /^벌스 1/).click()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(endedNotice(page)).toHaveCount(0)
})

test('a task already gone counts as stopped', async ({ page }) => {
  await openTaskFromHome(page, /^솔로/, '솔로', 'pending-cancel')
  await stopButton(page).click()
  await stopDialog(page, '솔로').getByRole('button', { name: '멈추기' }).click()
  // Another tab stopped it first.
  await page.evaluate(() => window.workspaceTest.failCancel('task-unavailable'))
  await expect(title(page)).toHaveText('최근 작업')
  await expect(stopNotice(page)).toHaveText('솔로 작업을 멈췄어요.')
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)
})

test('a second stop while one is sent is refused and says so', async ({
  page,
}) => {
  await openTaskFromHome(page, /^솔로/, '솔로', 'pending-cancel')
  await stopButton(page).click()
  await stopDialog(page, '솔로').getByRole('button', { name: '멈추기' }).click()
  await page.goBack()
  await expect(title(page)).toHaveText('최근 작업')
  await page.evaluate(() =>
    window.workspaceTest.queueTaskOnServer('task-verse'),
  )
  await sidebarTask(page, /^벌스 1/).click()
  await expect(title(page)).toHaveText('벌스 1')

  await stopButton(page).click()
  const dialog = stopDialog(page, '벌스 1')
  await dialog.getByRole('button', { name: '멈추기' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(STOP_FAILED)
  expect(await cancelCalls(page)).toEqual(['task-solo'])

  // The first stop still ends as it should.
  await page.evaluate(() => window.workspaceTest.resolveCancel())
  await expect(sidebarTask(page, /^솔로/)).toHaveCount(0)
  await expect(dialog).toBeVisible()
})

test('only a queued or running task offers 멈추기', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?view=task&task=task-verse')
  await expect(title(page)).toHaveText('벌스 1')
  await expect(stopButton(page)).toHaveCount(0)
  for (const [name, section] of [
    [/^인트로/, '인트로'],
    [/^코러스 2/, '코러스 2'],
  ] as const) {
    await sidebarTask(page, name).click()
    await expect(title(page)).toHaveText(section)
    await expect(stopButton(page)).toHaveCount(0)
  }
})

test('stopping the last task leaves the songs for a new section', async ({
  page,
}) => {
  await openHome(page)
  for (const taskId of ['task-verse', 'task-intro', 'task-chorus'])
    await updateOnServer(page, taskId, {
      processingStatus: 'processing',
      failureKind: null,
      progressPercent: 10,
    })
  for (const [name, section] of [
    [/^벌스 1/, '벌스 1'],
    [/^솔로/, '솔로'],
    [/^인트로/, '인트로'],
    [/^코러스 2/, '코러스 2'],
  ] as const) {
    await sidebarTask(page, name).click()
    await expect(title(page)).toHaveText(section)
    await stopButton(page).click()
    await stopDialog(page, section)
      .getByRole('button', { name: '멈추기' })
      .click()
    await expect(stopNotice(page)).toHaveText(`${section} 작업을 멈췄어요.`)
  }
  await expect(title(page)).toHaveText('아직 만든 구간이 없어요')
  await expect(stopNotice(page)).toHaveText('코러스 2 작업을 멈췄어요.')
})

test('a failed tab shows the retries left and queues again', async ({
  page,
}) => {
  await openTaskFromHome(page, /^인트로/, '인트로')
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await expect(panel).toBeVisible()
  await expect(
    panel.getByText(
      '올린 기타 음원은 그대로 들을 수 있어요. 다시 시도하거나 구간을 짧게 나눠 보세요.',
    ),
  ).toBeVisible()
  const retry = panel.getByRole('button', { name: '다시 시도' })
  // The count is the repository's, read with the button.
  await expect(retry).toHaveAccessibleDescription('2회 남음')
  await expect(panel.getByText('2회 남음')).toBeVisible()
  const songRequests = await page.evaluate(
    () => window.workspaceTest.audioCalls().length,
  )

  await retry.click()
  await expect(processingPanel(page)).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(main(page)).toBeFocused()
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(sidebarTask(page, /^인트로/)).toContainText('대기')
  expect(await retryCalls(page)).toEqual(['task-intro'])
  // The task loads again in place; the song is not fetched again.
  expect(
    await page.evaluate(() => window.workspaceTest.audioCalls().length),
  ).toBe(songRequests)
})

test('a failed separation names the original song as kept', async ({
  page,
}) => {
  await openHome(page)
  await updateOnServer(page, 'task-verse', {
    processingStatus: 'failed',
    failureKind: 'transcription',
    hasSeparatedAudio: false,
  })
  await sidebarTask(page, /^벌스 1/).click()
  const panel = failurePanel(page, '기타를 분리하지 못했어요')
  await expect(
    panel.getByText(
      '원곡은 그대로 들을 수 있어요. 다시 시도하거나 구간을 짧게 나눠 보세요.',
    ),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(panel.getByText('3회 남음')).toBeVisible()
})

test('used-up retries offer 문의하기 instead', async ({ page }) => {
  await openHome(page)
  await setRetriesUsed(page, 'task-intro', 3)
  await sidebarTask(page, /^인트로/).click()
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await expect(
    panel.getByText(
      '다시 시도는 3번까지 할 수 있어요. 구간을 짧게 나눠 새로 만들어 보세요. 올린 기타 음원은 그대로 들을 수 있어요.',
    ),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(panel.getByText(/회 남음/)).toHaveCount(0)

  const contact = panel.getByRole('button', { name: '문의하기' })
  await contact.click()
  const dialog = page.getByRole('dialog', { name: '문의하기' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(contact).toBeFocused()
})

test('a retry in progress cannot be sent twice; a failure shows the new count', async ({
  page,
}) => {
  await openTaskFromHome(page, /^인트로/, '인트로', 'pending-retry')
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await pressButton(page, '다시 시도', panel)

  const busy = panel.getByRole('button', { name: '다시 시도하는 중…' })
  await expect(busy).toHaveAttribute('aria-disabled', 'true')
  await expect(busy).toBeFocused()
  await expect(panel.getByRole('status')).toHaveText('다시 시도하고 있어요.')
  await page.keyboard.press('Enter')
  expect(await retryCalls(page)).toEqual(['task-intro'])

  // Another tab used the last tries meanwhile.
  await setRetriesUsed(page, 'task-intro', 3)
  await page.evaluate(() => window.workspaceTest.failRetry('retry-task-failed'))
  await expect(panel.getByRole('alert')).toHaveText(RETRY_FAILED)
  // The one button turns into 문의하기 and keeps focus.
  const contact = panel.getByRole('button', { name: '문의하기' })
  await expect(contact).toBeFocused()
  await expect(panel.getByText(/회 남음/)).toHaveCount(0)
})

test('a failed retry with tries left can be sent again', async ({ page }) => {
  await openTaskFromHome(page, /^인트로/, '인트로', 'pending-retry')
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await panel.getByRole('button', { name: '다시 시도' }).click()
  await page.evaluate(() => window.workspaceTest.failRetry('retry-task-failed'))
  await expect(panel.getByRole('alert')).toHaveText(RETRY_FAILED)
  await expect(panel.getByText('2회 남음')).toBeVisible()

  await panel.getByRole('button', { name: '다시 시도' }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.resolveRetry())
  await expect(processingPanel(page)).toBeVisible()
  await expect(main(page)).toBeFocused()
})

test('a second retry while one is sent is refused and says so', async ({
  page,
}) => {
  await openHome(page, 'pending-retry')
  await updateOnServer(page, 'task-verse', {
    processingStatus: 'failed',
    failureKind: 'transcription',
    progressPercent: null,
  })
  await sidebarTask(page, /^인트로/).click()
  await failurePanel(page, '타브를 만들지 못했어요')
    .getByRole('button', { name: '다시 시도' })
    .click()
  await sidebarTask(page, /^벌스 1/).click()
  await expect(title(page)).toHaveText('벌스 1')

  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await panel.getByRole('button', { name: '다시 시도' }).click()
  await expect(panel.getByRole('alert')).toHaveText(RETRY_FAILED)
  await expect(panel.getByRole('button', { name: '다시 시도' })).toBeVisible()
  expect(await retryCalls(page)).toEqual(['task-intro'])
})

test('a retry the server still reports as failed can be sent again', async ({
  page,
}) => {
  await openTaskFromHome(page, /^인트로/, '인트로', 'pending-retry')
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await panel.getByRole('button', { name: '다시 시도' }).click()
  // The retry ran and failed again before the screen loaded the task.
  await page.evaluate(() => {
    window.workspaceTest.resolveRetry()
    window.workspaceTest.updateTaskOnServer('task-intro', {
      processingStatus: 'failed',
      failureKind: 'transcription',
      progressPercent: null,
    })
  })
  const retry = panel.getByRole('button', { name: '다시 시도' })
  await expect(retry).toHaveAttribute('aria-disabled', 'false')
  await expect(retry).toHaveAccessibleDescription('1회 남음')
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('a retry whose reload fails opens the task afresh', async ({ page }) => {
  await openTaskFromHome(page, /^인트로/, '인트로', 'pending-retry')
  const panel = failurePanel(page, '타브를 만들지 못했어요')
  await panel.getByRole('button', { name: '다시 시도' }).click()
  await page.evaluate(() => {
    window.workspaceTest.failNextTaskLoad('load-failed')
    window.workspaceTest.resolveRetry()
  })
  // The old failure never stays on screen with its 다시 시도.
  await expect(processingPanel(page)).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(main(page)).toBeFocused()
})

for (const width of [390, 320]) {
  test(`at ${width}px 멈추기 and the failure panel fit without sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/tests/browser/harness.html?view=task&task=task-solo')
    await expect(stopButton(page)).toBeVisible()
    const box = await stopButton(page).boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await stopButton(page).click()
    await expect(stopDialog(page, '솔로')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.keyboard.press('Escape')

    await page.goto('/tests/browser/harness.html?view=task&task=task-intro')
    await expect(failurePanel(page, '타브를 만들지 못했어요')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
  })
}
