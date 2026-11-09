import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const sidebarTask = (page: Page, name: string) =>
  sidebar(page).getByRole('button', { name, exact: true })
const form = (page: Page) => main(page).getByRole('form', { name: '구간 수정' })
const editButton = (page: Page) =>
  main(page).getByRole('button', { name: '구간 수정' })
const submitButton = (page: Page) =>
  main(page).getByRole('button', { name: '타브 다시 만들기' })
const startInput = (page: Page) =>
  form(page).getByLabel('시작', { exact: true })
const endInput = (page: Page) => form(page).getByLabel('끝', { exact: true })
const overview = (page: Page) =>
  main(page)
    .getByRole('group', { name: '구간 파형' })
    .getByTestId('overview-track')
// The waveform has its own status; this is the one for sending the change.
const submitStatus = (page: Page) =>
  form(page).getByRole('status').and(form(page).locator(':scope > *'))

const NOTICE =
  '구간을 바꾸면 타브를 새로 만들어요. 지금 타브는 이전 결과로 남아요.'
const UNCHANGED =
  '시작이나 끝, 파트, 튜닝 중 하나를 바꿔야 타브를 다시 만들 수 있어요. 이름만 바꿀 수는 없어요.'
const SUBMITTING = '타브 다시 만들기를 요청하고 있어요.'
const FAILED =
  '타브를 다시 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.'

async function openTask(page: Page, taskId: string, scenario?: string) {
  const query = new URLSearchParams({
    ...(scenario ? { scenario } : {}),
    view: 'task',
    task: taskId,
  })
  await page.goto(`/tests/browser/harness.html?${query}`)
  await expect(title(page)).toBeVisible()
}

async function openEdit(page: Page, scenario?: string) {
  await openTask(page, 'task-verse', scenario)
  await editButton(page).click()
  await expect(form(page)).toBeVisible()
}

// Playwright waits for an aria-disabled button to enable before clicking, so
// tests activate it the way a keyboard user would.
async function pressSubmit(page: Page) {
  await submitButton(page).focus()
  await page.keyboard.press('Enter')
}

async function setEnd(page: Page, end: string) {
  await endInput(page).fill(end)
  await endInput(page).press('Tab')
}

const reviseCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.reviseCalls())

const historyLength = (page: Page) => page.evaluate(() => history.length)

// Starts from 내 작업 so Back has somewhere inside the app to go.
async function openEditFromHome(page: Page) {
  await page.goto('/tests/browser/harness.html')
  await expect(title(page)).toHaveText('최근 작업')
  await sidebarTask(page, '벌스 1').click()
  await expect(title(page)).toHaveText('벌스 1')
  await editButton(page).click()
  await expect(form(page)).toBeVisible()
}

test('구간 수정 opens the editor with the task values', async ({ page }) => {
  await openEdit(page)

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=edit-section&task=task-verse',
  )
  await expect(main(page)).toBeFocused()
  await expect(
    main(page).getByRole('navigation', { name: '작업 위치' }),
  ).toHaveText('neon_harbor_live벌스 1')
  await expect(title(page)).toHaveText('구간 수정')
  for (const text of ['neon_harbor_live.mp3', '04:12', '원곡', NOTICE])
    await expect(main(page).getByText(text, { exact: true })).toBeVisible()
  // The task keeps its file; changing it is a new section's choice.
  await expect(
    main(page).getByRole('button', { name: '파일 바꾸기' }),
  ).toHaveCount(0)

  await expect(form(page).getByLabel('이름')).toHaveValue('벌스')
  await expect(form(page).getByLabel('번호')).toHaveValue('1')
  await expect(startInput(page)).toHaveValue('00:42.1')
  await expect(endInput(page)).toHaveValue('01:05.8')
  await expect(form(page).getByText('23.7초')).toBeVisible()
  await expect(
    form(page).getByRole('radio', { name: '리듬 기타' }),
  ).toBeChecked()
  await expect(form(page).getByLabel('튜닝')).toHaveValue('e-standard')
  // Untouched values show no errors and the edited task stays highlighted.
  // Its row opens the task, another page, so it is only the current item.
  await expect(form(page).getByRole('alert')).toHaveCount(0)
  await expect(sidebarTask(page, '벌스 1')).toHaveAttribute(
    'aria-current',
    'true',
  )
  // The edited section is the selection, not one of the other sections.
  await expect(overview(page).getByText('솔로')).toBeVisible()
  await expect(overview(page).getByText('벌스 1')).toHaveCount(1)
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')
  // The notice and the reason the button is dimmed are read before a submit.
  await expect(form(page)).toHaveAccessibleDescription(NOTICE)
  await expect(submitButton(page)).toHaveAccessibleDescription(UNCHANGED)
})

test('only a finished task offers 구간 수정', async ({ page }) => {
  await openTask(page, 'task-verse')
  await expect(editButton(page)).toBeVisible()
  for (const taskId of ['task-solo', 'task-intro']) {
    await sidebar(page)
      .getByRole('button', {
        name: taskId === 'task-solo' ? /^솔로/ : '인트로',
      })
      .click()
    await expect(page).toHaveURL(new RegExp(`task=${taskId}$`))
    await expect(title(page)).toHaveText(
      taskId === 'task-solo' ? '솔로' : '인트로',
    )
    await expect(editButton(page)).toHaveCount(0)
  }

  // A running task cannot be edited from its URL either.
  await page.goto(
    '/tests/browser/harness.html?view=edit-section&task=task-solo',
  )
  await expect(title(page)).toHaveText('구간을 바꿀 수 없어요')
  await expect(
    main(page).getByText('타브가 완성된 작업만 구간을 바꿀 수 있어요.'),
  ).toBeVisible()
  await expect(form(page)).toHaveCount(0)
  // Opened from its URL, the closed editor's entry turns into the task.
  const length = await historyLength(page)
  await main(page).getByRole('button', { name: '작업으로 돌아가기' }).click()
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-solo',
  )
  await expect(title(page)).toHaveText('솔로')
  expect(await historyLength(page)).toBe(length)

  await page.goto(
    '/tests/browser/harness.html?view=edit-section&task=task-unknown',
  )
  await expect(title(page)).toHaveText('작업을 찾을 수 없어요')
  await page.goto('/tests/browser/harness.html?view=edit-section&task=Bad_Id')
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task-not-found',
  )
})

test('values the tab is not made from are not sent again', async ({ page }) => {
  await openEdit(page)
  await pressSubmit(page)
  await expect(form(page).getByRole('alert')).toHaveText(UNCHANGED)
  await expect(submitButton(page)).toBeFocused()

  // A new name alone keeps the same tab.
  await form(page).getByLabel('이름').selectOption('코러스')
  await pressSubmit(page)
  await expect(form(page).getByRole('alert')).toHaveText(UNCHANGED)
  expect(await reviseCalls(page)).toEqual([])

  await form(page).getByRole('radio', { name: '리드 기타' }).check()
  await expect(form(page).getByRole('alert')).toHaveCount(0)
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')
  await expect(submitButton(page)).toHaveAccessibleDescription('')
})

test('a blocked attempt replaces an earlier failure for good', async ({
  page,
}) => {
  await openEdit(page, 'pending-revise')
  await setEnd(page, '01:00.0')
  await pressSubmit(page)
  await page.evaluate(() =>
    window.workspaceTest.failRevise('revise-task-failed'),
  )
  await expect(form(page).getByRole('alert')).toHaveText(FAILED)

  await setEnd(page, '01:05.8')
  await pressSubmit(page)
  await expect(form(page).getByRole('alert')).toHaveText(UNCHANGED)
  // Nothing was sent since, so the old failure is not announced again.
  await setEnd(page, '01:00.0')
  await expect(form(page).getByRole('alert')).toHaveCount(0)
  expect(await reviseCalls(page)).toHaveLength(1)
})

test('타브 다시 만들기 queues the new section and keeps the old result', async ({
  page,
}) => {
  await openEdit(page)
  await setEnd(page, '01:00.0')
  await expect(form(page).getByText('17.9초')).toBeVisible()
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')
  await pressSubmit(page)

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-verse',
  )
  expect(await reviseCalls(page)).toEqual([
    {
      taskId: 'task-verse',
      input: {
        sectionName: '벌스 1',
        part: 'rhythm',
        tuningId: 'e-standard',
        rangeStartSeconds: 42.1,
        rangeEndSeconds: 60,
      },
    },
  ])
  await expect(main(page)).toBeFocused()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(
    main(page).getByText('00:42.1–01:00.0', { exact: true }),
  ).toBeVisible()
  // The sidebar follows the queued task; a queued task has nothing to edit.
  await expect(
    sidebar(page).getByRole('button', { name: /^벌스 1/ }),
  ).toContainText('대기')
  await expect(editButton(page)).toHaveCount(0)

  // D10, SEG-04: the old result stays, labelled with the section it came from.
  const previous = main(page).getByRole('region', { name: '이전 결과' })
  await expect(previous.getByRole('listitem')).toHaveCount(1)
  await expect(previous.getByRole('listitem')).toHaveText(
    /벌스 1.*00:42\.1–01:05\.8.*리듬 기타.*E 표준 6현/,
  )
})

test('Back skips a closed editor', async ({ page }) => {
  await openEditFromHome(page)
  await setEnd(page, '01:00.0')
  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(page).toHaveURL(/view=task&task=task-verse$/)
  await expect(main(page)).toBeFocused()
  // The abandoned change is not one step back.
  await page.goBack()
  await expect(title(page)).toHaveText('최근 작업')
  await page.goForward()
  await expect(title(page)).toHaveText('벌스 1')

  await editButton(page).click()
  await setEnd(page, '01:00.0')
  await pressSubmit(page)
  await expect(page).toHaveURL(/view=task&task=task-verse$/)
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(main(page)).toBeFocused()
  // Nor is the editor of a task that is now queued.
  await page.goBack()
  await expect(title(page)).toHaveText('최근 작업')
  await page.goForward()
  await expect(title(page)).toHaveText('벌스 1')
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(
    main(page).getByRole('region', { name: '이전 결과' }),
  ).toBeVisible()
})

test('an editor opened from its URL becomes its task when closed', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?view=edit-section&task=task-verse',
  )
  await expect(form(page)).toBeVisible()
  const length = await historyLength(page)
  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(page).toHaveURL(/view=task&task=task-verse$/)
  await expect(title(page)).toHaveText('벌스 1')
  expect(await historyLength(page)).toBe(length)
})

test('구간 수정 follows the task as loaded, not the list', async ({ page }) => {
  await openEditFromHome(page)
  await page.goBack()
  await expect(title(page)).toHaveText('벌스 1')
  await page.goBack()
  await expect(title(page)).toHaveText('최근 작업')
  // Another tab queues the task; this tab's list still says it is done.
  await page.evaluate(() =>
    window.workspaceTest.queueTaskOnServer('task-verse'),
  )
  await page.goForward()
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(editButton(page)).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL(/view=edit-section&task=task-verse$/)
  await expect(title(page)).toHaveText('구간을 바꿀 수 없어요')
  await expect(form(page)).toHaveCount(0)
  await expect(
    sidebar(page).getByRole('button', { name: /^벌스 1/ }),
  ).not.toContainText('대기')
  expect(await reviseCalls(page)).toEqual([])
})

test('구간 수정 waits for the task and can load it again', async ({ page }) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=pending-task&view=edit-section&task=task-verse',
  )
  await expect(title(page)).toHaveText('작업을 여는 중이에요')
  await expect(form(page)).toHaveCount(0)
  await page.evaluate(() =>
    window.workspaceTest.failTask('task-verse', 'load-failed'),
  )
  await expect(title(page)).toHaveText('작업을 열지 못했어요')
  const calls = (await page.evaluate(() => window.workspaceTest.taskCalls()))
    .length
  await main(page).getByRole('button', { name: '다시 시도' }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.workspaceTest.taskCalls())).length,
    )
    .toBeGreaterThan(calls)
  await page.evaluate(() => window.workspaceTest.resolveTask('task-verse'))
  await expect(form(page)).toBeVisible()
  await expect(endInput(page)).toHaveValue('01:05.8')
})

test('취소 returns to the task without sending the change', async ({
  page,
}) => {
  await openEdit(page)
  await setEnd(page, '01:00.0')
  await main(page).getByRole('button', { name: '취소' }).click()

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-verse',
  )
  await expect(title(page)).toHaveText('벌스 1')
  await expect(
    main(page).getByText('00:42.1–01:05.8', { exact: true }),
  ).toBeVisible()
  expect(await reviseCalls(page)).toEqual([])

  // Reopening starts from the task again, not from the abandoned change.
  await editButton(page).click()
  await expect(endInput(page)).toHaveValue('01:05.8')
})

test('a failed change keeps the edited values for a retry', async ({
  page,
}) => {
  await openEdit(page, 'pending-revise')
  await setEnd(page, '01:00.0')
  await pressSubmit(page)

  await expect(submitStatus(page)).toHaveText(SUBMITTING)
  await expect(endInput(page)).toBeDisabled()
  await expect(main(page).getByRole('button', { name: '취소' })).toBeDisabled()
  await page.evaluate(() =>
    window.workspaceTest.failRevise('revise-task-failed'),
  )

  await expect(form(page).getByRole('alert')).toHaveText(FAILED)
  await expect(endInput(page)).toHaveValue('01:00.0')
  await expect(submitButton(page)).toBeFocused()
  await expect(page).toHaveURL(/view=edit-section&task=task-verse$/)

  await page.keyboard.press('Enter')
  await page.evaluate(() => window.workspaceTest.resolveRevise())
  await expect(page).toHaveURL(/view=task&task=task-verse$/)
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
})

test('an expired session while sending closes the workspace', async ({
  page,
}) => {
  await openEdit(page, 'pending-revise')
  await setEnd(page, '01:00.0')
  await pressSubmit(page)
  await page.evaluate(() => window.workspaceTest.failRevise('expired'))

  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(form(page)).toHaveCount(0)
})

test('a second Enter while sending does not send again', async ({ page }) => {
  await openEdit(page, 'pending-revise')
  await setEnd(page, '01:00.0')
  await submitButton(page).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(submitStatus(page)).toHaveText(SUBMITTING)
  expect(await reviseCalls(page)).toHaveLength(1)
})

test('a change saved after the user left does not pull them back', async ({
  page,
}) => {
  await openEdit(page, 'pending-revise')
  await setEnd(page, '01:00.0')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText(SUBMITTING)
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(title(page)).toHaveText('최근 작업')
  await expect(main(page)).toBeFocused()

  await page.evaluate(() => window.workspaceTest.resolveRevise())
  // Let the settled request reach the page before checking nothing moved.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  await expect(page).toHaveURL('/tests/browser/harness.html')
  await expect(title(page)).toHaveText('최근 작업')
  await expect(main(page)).toBeFocused()
  // The cancelled request does not change the list either.
  await expect(
    sidebar(page).getByRole('button', { name: /^벌스 1/ }),
  ).not.toContainText('대기')
})

for (const width of [390, 320]) {
  test(`at ${width}px the task bar and the editor fit without sideways scroll`, async ({
    page,
  }) => {
    const inView = async (target: ReturnType<Page['locator']>) => {
      const box = await target.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    const scrollWidth = () =>
      page.evaluate(() => document.documentElement.scrollWidth)
    await page.setViewportSize({ width, height: 720 })
    await openTask(page, 'task-verse')
    await inView(editButton(page))
    // The task's name stays readable next to the button.
    const current = main(page)
      .getByRole('navigation', { name: '작업 위치' })
      .locator('[aria-current="page"]')
    expect(
      await current.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    expect(await scrollWidth()).toBe(width)

    await editButton(page).click()
    await expect(form(page)).toBeVisible()
    await pressSubmit(page)
    await expect(form(page).getByRole('alert')).toHaveText(UNCHANGED)
    expect(await scrollWidth()).toBe(width)
    for (const target of [
      submitButton(page),
      main(page).getByRole('button', { name: '취소' }),
      form(page).getByLabel('튜닝'),
      form(page).getByText(NOTICE),
    ])
      await inView(target)
  })
}
