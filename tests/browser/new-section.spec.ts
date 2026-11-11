import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const form = (page: Page) => main(page).getByRole('form', { name: '새 구간' })
const submitButton = (page: Page) =>
  main(page).getByRole('button', { name: '타브 만들기' })
const startInput = (page: Page) =>
  form(page).getByLabel('시작', { exact: true })
const endInput = (page: Page) => form(page).getByLabel('끝', { exact: true })
const numberInput = (page: Page) => form(page).getByLabel('번호')
// The waveform has its own status; this is the one for creating the task.
const submitStatus = (page: Page) =>
  form(page).getByRole('status').and(form(page).locator(':scope > *'))
const draftRow = (page: Page) =>
  sidebar(page).getByRole('button', { name: '새 구간 작성 중' })
const replaceButton = (page: Page) =>
  main(page).getByRole('button', { name: '파일 바꾸기' })
const confirmDialog = (page: Page) =>
  page.getByRole('alertdialog', { name: '다른 파일로 바꿀까요?' })
const fileDialog = (page: Page) =>
  page.getByRole('dialog', { name: '파일 바꾸기' })

const BEFORE_START = '끝이 시작보다 앞에 있어요. 끝 시간을 다시 입력해 주세요.'
const TOO_LONG = '구간은 30초까지 정할 수 있어요. 범위를 줄여 주세요.'
const START_FORMAT = '시작 시간을 00:00.0 형식으로 입력해 주세요.'
const END_FORMAT = '끝 시간을 00:00.0 형식으로 입력해 주세요.'
const FAILED =
  '작업을 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.'

async function openNewSection(page: Page, scenario?: string) {
  const query = new URLSearchParams({
    ...(scenario ? { scenario } : {}),
    view: 'new-section',
    song: 'song-neon-harbor',
  })
  await page.goto(`/tests/browser/harness.html?${query}`)
  await expect(form(page)).toBeVisible()
}

async function fillRange(page: Page, start: string, end: string) {
  await startInput(page).fill(start)
  await startInput(page).press('Tab')
  await endInput(page).fill(end)
  await endInput(page).press('Tab')
}

// Playwright waits for an aria-disabled button to enable before clicking, so
// tests activate it the way a keyboard user would.
async function pressSubmit(page: Page) {
  await submitButton(page).focus()
  await page.keyboard.press('Enter')
}

const createCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.createCalls())

test('구간 추가 opens the new-section screen for that song', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await sidebar(page)
    .getByRole('button', { name: 'paper_moon_gtr_stem에 구간 추가' })
    .click()

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=new-section&song=song-paper-moon',
  )
  await expect(main(page)).toBeFocused()
  await expect(
    main(page).getByRole('navigation', { name: '작업 위치' }),
  ).toHaveText('paper_moon_gtr_stem새 구간')
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
  await expect(main(page).getByText('paper_moon_gtr_stem.mp3')).toBeVisible()
  await expect(main(page).getByText('01:36')).toBeVisible()
  await expect(main(page).getByText('분리된 기타 음원')).toBeVisible()
  await expect(draftRow(page)).toHaveAttribute('aria-current', 'page')
  await expect(draftRow(page)).toHaveCount(1)
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')
  // The policy defaults: the first name with its next free number.
  await expect(form(page).getByLabel('이름')).toHaveValue('인트로')
  await expect(numberInput(page)).toHaveValue('2')
  await expect(
    form(page).getByRole('radio', { name: '리듬 기타' }),
  ).toBeChecked()
  await expect(form(page).getByLabel('튜닝')).toHaveValue('e-standard')
  await expect(form(page).getByText('–')).toBeVisible()
})

test('a reversed range is explained next to the end time and blocks submit', async ({
  page,
}) => {
  await openNewSection(page)
  await fillRange(page, '0:42.1', '00:38.0')
  // A parsed time is rewritten in the canonical shape on blur.
  await expect(startInput(page)).toHaveValue('00:42.1')

  const error = form(page).locator('p', { hasText: BEFORE_START })
  await expect(error).toBeVisible()
  await expect(error.locator('img')).toHaveCount(1)
  await expect(endInput(page)).toHaveAttribute('aria-invalid', 'true')
  await expect(endInput(page)).toHaveAccessibleDescription(
    new RegExp(BEFORE_START),
  )
  await expect(startInput(page)).toHaveAttribute('aria-invalid', 'false')
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')

  await endInput(page).fill('01:05.8')
  await endInput(page).press('Tab')
  await expect(error).toHaveCount(0)
  await expect(form(page).getByText('23.7초')).toBeVisible()
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')
})

test('the 30-second limit accepts its boundary and refuses a tenth more', async ({
  page,
}) => {
  await openNewSection(page)
  await fillRange(page, '00:42.1', '01:12.1')
  await expect(form(page).getByText('30.0초')).toBeVisible()
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')

  await endInput(page).fill('01:12.2')
  await endInput(page).press('Tab')
  await expect(form(page).getByText(TOO_LONG)).toBeVisible()
  await expect(form(page).getByText('30.1초')).toHaveAttribute(
    'data-over',
    'true',
  )
  for (const input of [startInput(page), endInput(page)])
    await expect(input).toHaveAccessibleDescription(new RegExp(TOO_LONG))
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')

  // Past the song length (04:12.0 in the fixture) is its own message.
  await fillRange(page, '04:00.0', '04:12.5')
  await expect(
    form(page).getByText(
      '끝이 곡 길이(04:12.0)를 넘어요. 끝 시간을 다시 입력해 주세요.',
    ),
  ).toBeVisible()
})

test('submitting an incomplete form shows every error and focuses the first', async ({
  page,
}) => {
  await openNewSection(page)
  await expect(form(page).getByText(START_FORMAT)).toHaveCount(0)
  await pressSubmit(page)

  await expect(form(page).getByText(START_FORMAT)).toBeVisible()
  await expect(form(page).getByText(END_FORMAT)).toBeVisible()
  await expect(startInput(page)).toBeFocused()
  expect(await createCalls(page)).toEqual([])

  // Nothing was typed, so leaving drops the form and its revealed errors.
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(draftRow(page)).toHaveCount(0)
  await sidebar(page)
    .getByRole('button', { name: 'neon_harbor_live에 구간 추가' })
    .click()
  await expect(form(page)).toBeVisible()
  await expect(form(page).getByText(START_FORMAT)).toHaveCount(0)
})

test('타브 만들기 creates a queued task and opens it', async ({ page }) => {
  await openNewSection(page)
  await form(page).getByLabel('이름').selectOption('벌스')
  // 벌스 1 already exists in this song.
  await expect(numberInput(page)).toHaveValue('2')
  await fillRange(page, '00:42.1', '01:05.8')
  await form(page).getByRole('radio', { name: '리드 기타' }).check()
  await form(page).getByLabel('튜닝').selectOption({ label: '드롭 D 6현' })
  // Enter in the number field submits before any blur normalizes '02'.
  await numberInput(page).fill('02')
  await numberInput(page).press('Enter')

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-created-1',
  )
  expect(await createCalls(page)).toEqual([
    {
      songId: 'song-neon-harbor',
      sectionName: '벌스 2',
      part: 'lead',
      tuningId: 'drop-d',
      rangeStartSeconds: 42.1,
      rangeEndSeconds: 65.8,
    },
  ])
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '벌스 2',
  )
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(main(page).getByText('드롭 D 6현')).toBeVisible()
  const row = sidebar(page).getByRole('button', { name: /^벌스 2/ })
  await expect(row).toHaveAttribute('aria-current', 'page')
  await expect(row).toContainText('대기')
  await expect(draftRow(page)).toHaveCount(0)

  // A queued task counts as in progress.
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await main(page)
    .getByRole('button', { name: '진행 중 2', exact: true })
    .click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('while creating, input is locked and a failure keeps it for a retry', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await startInput(page).fill('00:42.1')
  await endInput(page).fill('01:05.8')
  // Enter from the field: disabling it during the request drops its focus.
  await endInput(page).press('Enter')

  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(endInput(page)).toBeDisabled()
  await expect(main(page).getByRole('button', { name: '취소' })).toBeDisabled()
  await expect(replaceButton(page)).toBeDisabled()
  await pressSubmit(page)
  expect(await createCalls(page)).toHaveLength(1)

  await page.evaluate(() =>
    window.workspaceTest.failCreate('create-task-failed'),
  )
  await expect(form(page).getByRole('alert')).toHaveText(FAILED)
  await expect(startInput(page)).toHaveValue('00:42.1')
  await expect(endInput(page)).toHaveValue('01:05.8')
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')
  // The double submit above left focus on the button; a field submit
  // returns to its field.
  await expect(submitButton(page)).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  await page.evaluate(() =>
    window.workspaceTest.failCreate('create-task-failed'),
  )
  await expect(form(page).getByRole('alert')).toHaveText(FAILED)
  await endInput(page).press('Enter')
  await page.evaluate(() =>
    window.workspaceTest.failCreate('create-task-failed'),
  )
  await expect(form(page).getByRole('alert')).toHaveText(FAILED)
  await expect(endInput(page)).toBeFocused()

  await pressSubmit(page)
  await expect(form(page).getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.resolveCreate())
  await expect(page).toHaveURL(/view=task&task=task-created-1$/)
  expect(await createCalls(page)).toHaveLength(4)
})

test('a dialog opened while creating stays open over the new task', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await fillRange(page, '00:42.1', '01:05.8')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  const addButton = sidebar(page).getByRole('button', { name: '곡 추가' })
  await addButton.click()
  const addDialog = page.getByRole('dialog', { name: '곡 추가' })
  await expect(addDialog).toBeVisible()

  await page.evaluate(() => window.workspaceTest.resolveCreate())
  await expect(page).toHaveURL(/view=task&task=task-created-1$/)
  await expect(addDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(addDialog).toHaveCount(0)
  await expect(addButton).toBeFocused()
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '인트로 1',
  )
})

test('an expired session while creating ends the workspace', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await startInput(page).fill('00:42.1')
  await endInput(page).fill('01:05.8')
  // Enter from the field: the request disables it, so focus has left it.
  await endInput(page).press('Enter')
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  await page.evaluate(() => window.workspaceTest.failCreate('expired'))
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(form(page)).toHaveCount(0)
  await expect(main(page)).toBeFocused()
})

test('leaving while creating cancels the request and its late answer opens nothing', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await fillRange(page, '00:42.1', '01:05.8')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(
    main(page).getByRole('heading', { name: '최근 작업' }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => window.workspaceTest.createCancelled()),
  ).toEqual([true])

  await page.evaluate(() => window.workspaceTest.resolveCreate())
  await page.waitForTimeout(300)
  await expect(page).not.toHaveURL(/view=task/)
  await expect(
    main(page).getByRole('heading', { name: '최근 작업' }),
  ).toBeVisible()
})

test('a new section on another song goes out while the one left is still unanswered', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await fillRange(page, '00:42.1', '01:05.8')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  await sidebar(page)
    .getByRole('button', { name: 'paper_moon_gtr_stem에 구간 추가' })
    .click()
  await expect(main(page).getByText('paper_moon_gtr_stem.mp3')).toBeVisible()

  await fillRange(page, '00:10.0', '00:20.0')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText('작업을 만들고 있어요.')
  expect(await createCalls(page)).toHaveLength(2)
  await page.evaluate(() => window.workspaceTest.resolveCreate())
  await expect(page).toHaveURL(/view=task&task=task-created-\d+$/)
  await expect(
    main(page).getByRole('navigation', { name: '작업 위치' }),
  ).toContainText('paper_moon_gtr_stem')
})

test('a draft stays listed while away, and 취소 discards it', async ({
  page,
}) => {
  await openNewSection(page)
  await startInput(page).fill('00:10.0')
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(4)

  // An untouched visit to another song leaves no draft behind.
  await sidebar(page)
    .getByRole('button', { name: 'late_train_cover에 구간 추가' })
    .click()
  await expect(draftRow(page)).toHaveCount(2)
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(draftRow(page)).toHaveCount(1)

  await draftRow(page).click()
  await expect(startInput(page)).toHaveValue('00:10.0')
  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(page).toHaveURL('/tests/browser/harness.html')
  await expect(draftRow(page)).toHaveCount(0)

  await sidebar(page)
    .getByRole('button', { name: 'neon_harbor_live에 구간 추가' })
    .click()
  await expect(startInput(page)).toHaveValue('')
})

test('replacing the file asks first and keeps the name and tuning', async ({
  page,
}) => {
  await openNewSection(page)
  await form(page).getByLabel('이름').selectOption('코러스')
  await numberInput(page).fill('3')
  await fillRange(page, '00:42.1', '01:05.8')
  await form(page).getByRole('radio', { name: '리드 기타' }).check()
  await form(page).getByLabel('튜닝').selectOption('e-flat')

  await replaceButton(page).click()
  await expect(confirmDialog(page)).toBeVisible()
  await expect(
    confirmDialog(page).getByRole('button', { name: '취소' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmDialog(page)).toHaveCount(0)
  await expect(replaceButton(page)).toBeFocused()
  await expect(startInput(page)).toHaveValue('00:42.1')

  // Cancelling the file choice also keeps every input.
  await replaceButton(page).click()
  await confirmDialog(page).getByRole('button', { name: '파일 바꾸기' }).click()
  await expect(fileDialog(page)).toBeVisible()
  await fileDialog(page).getByRole('button', { name: '취소' }).click()
  await expect(fileDialog(page)).toHaveCount(0)
  await expect(replaceButton(page)).toBeFocused()
  await expect(endInput(page)).toHaveValue('01:05.8')

  await replaceButton(page).click()
  await confirmDialog(page).getByRole('button', { name: '파일 바꾸기' }).click()
  const chooser = page.waitForEvent('filechooser')
  await fileDialog(page)
    .getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
    .click()
  await (
    await chooser
  ).setFiles({
    name: 'fresh_riff.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.alloc(1536),
  })
  const next = fileDialog(page).getByRole('button', { name: '다음' })
  await expect(next).toHaveAttribute('aria-disabled', 'false')
  await next.click()

  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=new-section&song=song-added-1',
  )
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()
  await expect(form(page).getByLabel('이름')).toHaveValue('코러스')
  await expect(numberInput(page)).toHaveValue('3')
  await expect(form(page).getByLabel('튜닝')).toHaveValue('e-flat')
  await expect(startInput(page)).toHaveValue('')
  await expect(endInput(page)).toHaveValue('')
  await expect(
    form(page).getByRole('radio', { name: '리듬 기타' }),
  ).toBeChecked()
  // The draft moved: only the new song lists it.
  await expect(draftRow(page)).toHaveCount(1)
  await expect(
    sidebar(page).getByRole('button', { name: 'fresh_riff', exact: true }),
  ).toBeVisible()
})

test('replacing a separated guitar file keeps that input kind', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?view=new-section&song=song-paper-moon',
  )
  await replaceButton(page).click()
  await confirmDialog(page).getByRole('button', { name: '파일 바꾸기' }).click()
  await expect(
    fileDialog(page).getByRole('radio', { name: '분리된 기타 음원' }),
  ).toBeChecked()
})

test('a first task turns an empty workspace into a listed one', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?scenario=empty')
  await sidebar(page).getByRole('button', { name: '곡 추가' }).click()
  const addDialog = page.getByRole('dialog', { name: '곡 추가' })
  const chooser = page.waitForEvent('filechooser')
  await addDialog
    .getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
    .click()
  await (
    await chooser
  ).setFiles({
    name: 'fresh_riff.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.alloc(1536),
  })
  const next = addDialog.getByRole('button', { name: '다음' })
  await expect(next).toHaveAttribute('aria-disabled', 'false')
  await next.click()

  await fillRange(page, '00:00.0', '00:20.0')
  await pressSubmit(page)
  await expect(page).toHaveURL(/view=task&task=task-created-1$/)
  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
})

for (const width of [390, 320]) {
  test(`at ${width}px the new-section screen fits without sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await openNewSection(page)
    // 00:00.0 needs a colon, which numeric, decimal and tel keypads lack.
    for (const input of [startInput(page), endInput(page)])
      await expect(input).not.toHaveAttribute(
        'inputmode',
        /^(numeric|decimal|tel)$/,
      )
    await fillRange(page, '00:42.1', '01:12.2')
    await expect(form(page).getByText(TOO_LONG)).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    for (const target of [
      submitButton(page),
      main(page).getByRole('button', { name: '취소' }),
      form(page).getByLabel('튜닝'),
    ]) {
      const box = await target.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
  })
}
