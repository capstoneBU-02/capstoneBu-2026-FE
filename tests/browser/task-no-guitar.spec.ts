import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

// #17 PR D: a section whose song had no guitar (Figma 84:3389), the editor
// that moves it, another file for a new section and the state preview.
const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const panel = (page: Page) =>
  main(page).getByRole('region', { name: '기타 소리를 거의 찾지 못했어요' })
const redefineButton = (page: Page) =>
  panel(page).getByRole('button', { name: '구간 다시 정하기' })
const otherFileButton = (page: Page) =>
  panel(page).getByRole('button', { name: '다른 파일 올리기' })
const form = (page: Page) =>
  main(page).getByRole('form', { name: '구간 다시 정하기' })
// The editor's own top bar holds the submit button, outside the form.
const submitButton = (page: Page) =>
  main(page).getByRole('button', { name: '타브 만들기' })
const fileDialog = (page: Page) =>
  page.getByRole('dialog', { name: '다른 파일 올리기' })

const ADVICE =
  '고른 구간에서 기타가 작게 들리거나 다른 악기와 겹쳐 있으면 그럴 수 있어요. 기타가 잘 들리는 구간을 다시 골라 보세요.'
const INTRO = '기타가 잘 들리는 구간으로 바꾸면 기타 분리부터 다시 시작해요.'
const SUBMITTING = '타브 만들기를 요청하고 있어요.'
const FAILED =
  '구간을 바꾸지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.'
const SAME_RANGE =
  '시작이나 끝을 바꿔야 타브를 만들 수 있어요. 같은 범위에서는 기타를 다시 찾지 못할 수 있어요.'

const submitStatus = (page: Page) =>
  form(page).getByRole('status').and(form(page).locator(':scope > *'))
const reviseCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.reviseCalls())
const noSidewaysScroll = async (page: Page, width: number) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    width,
  )

async function openChorus(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?${query}view=task&task=task-chorus`,
  )
  await expect(title(page)).toHaveText('코러스 2')
  await expect(panel(page)).toBeVisible()
}

// Playwright waits for an aria-disabled button to enable before clicking, so
// tests activate it the way a keyboard user would.
async function pressSubmit(page: Page) {
  await submitButton(page).focus()
  await page.keyboard.press('Enter')
}

async function setTime(page: Page, label: '시작' | '끝', value: string) {
  const input = form(page).getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press('Tab')
}

test('a song without guitar offers a new range or another file', async ({
  page,
}) => {
  await openChorus(page)
  await expect(panel(page).getByText(ADVICE, { exact: true })).toBeVisible()
  await expect(panel(page).getByRole('button')).toHaveText([
    '구간 다시 정하기',
    '다른 파일 올리기',
  ])
  // SEPARATION_NO_GUITAR cannot be sent again, and the header has nothing
  // to change or stop.
  for (const name of ['다시 시도', '구간 수정', '멈추기'])
    await expect(main(page).getByRole('button', { name })).toHaveCount(0)
  await expect(
    main(page).getByRole('heading', { level: 2, name: '타브', exact: true }),
  ).toHaveCount(0)
})

test('구간 다시 정하기 needs a new range and starts over from separation', async ({
  page,
}) => {
  await openChorus(page)
  await redefineButton(page).click()
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=edit-section&task=task-chorus',
  )
  await expect(title(page)).toHaveText('구간 다시 정하기')
  await expect(form(page)).toHaveAccessibleDescription(INTRO)
  await expect(form(page).getByLabel('시작', { exact: true })).toHaveValue(
    '03:10.0',
  )
  await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(submitButton(page)).toHaveAccessibleDescription(SAME_RANGE)

  // Separation listens to the range alone, so a new part keeps it blocked.
  await form(page).getByRole('radio', { name: '리드 기타' }).check()
  await pressSubmit(page)
  await expect(form(page).getByRole('alert')).toHaveText(SAME_RANGE)
  expect(await reviseCalls(page)).toEqual([])

  await setTime(page, '끝', '03:25.0')
  await expect(form(page).getByRole('alert')).toHaveCount(0)
  await pressSubmit(page)
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-chorus',
  )
  expect(await reviseCalls(page)).toEqual([
    {
      taskId: 'task-chorus',
      input: {
        sectionName: '코러스 2',
        part: 'lead',
        tuningId: 'e-standard',
        rangeStartSeconds: 190,
        rangeEndSeconds: 205,
      },
    },
  ])
  await expect(main(page)).toBeFocused()
  await expect(
    main(page).getByRole('region', { name: '순서를 기다리고 있어요' }),
  ).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  await expect(
    main(page).getByText('03:10.0–03:25.0', { exact: true }),
  ).toBeVisible()
  // It had no tab, so nothing is listed as a previous result.
  await expect(
    main(page).getByRole('region', { name: '이전 결과' }),
  ).toHaveCount(0)
  await expect(
    sidebar(page).getByRole('button', { name: /^코러스 2/ }),
  ).toContainText('대기')
})

test('a redefine that fails keeps the new range for another try', async ({
  page,
}) => {
  await openChorus(page, 'scenario=pending-revise&')
  await redefineButton(page).click()
  await setTime(page, '끝', '03:25.0')
  await pressSubmit(page)
  await expect(submitStatus(page)).toHaveText(SUBMITTING)
  await page.evaluate(() =>
    window.workspaceTest.failRevise('revise-task-failed'),
  )
  await expect(form(page).getByRole('alert')).toHaveText(FAILED)
  await expect(form(page).getByLabel('끝', { exact: true })).toHaveValue(
    '03:25.0',
  )
  await expect(submitButton(page)).toBeFocused()

  await page.keyboard.press('Enter')
  await page.evaluate(() => window.workspaceTest.resolveRevise())
  await expect(page).toHaveURL(/view=task&task=task-chorus$/)
  await expect(
    main(page).getByRole('region', { name: '순서를 기다리고 있어요' }),
  ).toBeVisible()
})

test('the new range starts with every retry', async ({ page }) => {
  await openChorus(page, 'refresh=150&')
  await page.evaluate(() =>
    window.workspaceTest.setRetriesUsed('task-chorus', 3),
  )
  await redefineButton(page).click()
  await setTime(page, '끝', '03:25.0')
  await pressSubmit(page)
  await expect(
    main(page).getByRole('region', { name: '순서를 기다리고 있어요' }),
  ).toBeVisible()

  // Its tab fails later; the retries used on the old range do not count.
  await page.evaluate(() =>
    window.workspaceTest.updateTaskOnServer('task-chorus', {
      processingStatus: 'failed',
      failureKind: 'transcription',
      hasSeparatedAudio: true,
      progressPercent: null,
    }),
  )
  const failure = main(page).getByRole('region', {
    name: '타브를 만들지 못했어요',
  })
  await expect(failure.getByText('3회 남음')).toBeVisible()
  await expect(failure.getByRole('button', { name: '다시 시도' })).toBeVisible()
})

test('취소 leaves the section as it was', async ({ page }) => {
  await openChorus(page)
  await redefineButton(page).click()
  await setTime(page, '시작', '03:05.0')
  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=task&task=task-chorus',
  )
  await expect(main(page)).toBeFocused()
  await expect(panel(page)).toBeVisible()
  await expect(
    main(page).getByText('03:10.0–03:31.0', { exact: true }),
  ).toBeVisible()
  expect(await reviseCalls(page)).toEqual([])
})

test('a tab failure cannot be moved from its URL', async ({ page }) => {
  await page.goto(
    '/tests/browser/harness.html?view=edit-section&task=task-intro',
  )
  await expect(title(page)).toHaveText('구간을 바꿀 수 없어요')
  await expect(
    main(page).getByText(
      '타브가 완성된 작업과 기타를 찾지 못한 작업만 구간을 바꿀 수 있어요.',
    ),
  ).toBeVisible()
  await expect(form(page)).toHaveCount(0)
})

test('다른 파일 올리기 starts a new section with the name and tuning', async ({
  page,
}) => {
  await openChorus(page)
  await otherFileButton(page).click()
  await expect(fileDialog(page)).toBeVisible()
  await expect(
    fileDialog(page).getByRole('radio', { name: '원곡' }),
  ).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(fileDialog(page)).toHaveCount(0)
  await expect(otherFileButton(page)).toBeFocused()

  await otherFileButton(page).click()
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
  await expect(main(page)).toBeFocused()
  const newSection = main(page).getByRole('form', { name: '새 구간' })
  await expect(newSection.getByLabel('이름')).toHaveValue('코러스')
  await expect(newSection.getByLabel('번호')).toHaveValue('2')
  await expect(newSection.getByLabel('튜닝')).toHaveValue('e-standard')
  // The range and part were chosen for the old file.
  await expect(newSection.getByLabel('시작', { exact: true })).toHaveValue('')
  await expect(newSection.getByLabel('끝', { exact: true })).toHaveValue('')
  await expect(
    newSection.getByRole('radio', { name: '리듬 기타' }),
  ).toBeChecked()
  // The failed task stays where it was.
  await expect(
    sidebar(page).getByRole('button', { name: /^코러스 2/ }),
  ).toBeVisible()
  await expect(
    sidebar(page).getByRole('button', { name: '새 구간 작성 중' }),
  ).toHaveCount(1)

  // Leaving the new section drops its draft and keeps the failed task.
  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(page).toHaveURL('/tests/browser/harness.html')
  await expect(
    sidebar(page).getByRole('button', { name: '새 구간 작성 중' }),
  ).toHaveCount(0)
  await expect(
    sidebar(page).getByRole('button', { name: /^코러스 2/ }),
  ).toBeVisible()
})

test('?demo=task-states previews every task state', async ({ page }) => {
  await page.goto('/?demo=task-states')
  await expect(page.locator('tbody tr')).toHaveCount(7)
  const open = async (name: RegExp, sectionName: string) => {
    await sidebar(page).getByRole('button', { name }).click()
    await expect(title(page)).toHaveText(sectionName)
  }

  await open(/^브리지/, '브리지')
  await expect(
    main(page).getByRole('region', { name: '순서를 기다리고 있어요' }),
  ).toBeVisible()
  await open(/^아웃트로/, '아웃트로')
  const tab = main(page).getByRole('region', { name: '타브를 만들지 못했어요' })
  await expect(tab.getByRole('button', { name: '문의하기' })).toBeVisible()
  await open(/^벌스 2/, '벌스 2')
  const separation = main(page).getByRole('region', {
    name: '기타를 분리하지 못했어요',
  })
  await expect(separation.getByText('1회 남음')).toBeVisible()
  await open(/^코러스 2/, '코러스 2')
  await expect(panel(page)).toBeVisible()
})

for (const width of [390, 320]) {
  test(`at ${width}px the no-guitar body and its editor fit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await openChorus(page)
    for (const button of [redefineButton(page), otherFileButton(page)]) {
      const box = await button.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    await noSidewaysScroll(page, width)
    await redefineButton(page).click()
    await expect(form(page)).toBeVisible()
    await noSidewaysScroll(page, width)
  })
}
