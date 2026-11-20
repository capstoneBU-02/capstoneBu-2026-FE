import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const GUIDE =
  '벌스 1(23.7초) 구간을 연주한 파일을 올려 주세요. 반주 없이 기타 소리만 들어 있어야 해요.'
const HINT = 'MP3, MP4 · 구간을 처음부터 끝까지 연주한 파일'
const PRIVACY = '올린 연주는 다른 테스터에게 보이지 않아요.'
const TOO_SHORT =
  '구간(23.7초)보다 많이 짧아요. 구간 전체를 연주한 파일을 올려 주세요.'
const TOO_LONG =
  '구간(23.7초)보다 많이 길어요. 구간만 연주한 파일을 올려 주세요.'
const BAD_FORMAT =
  'MP3, MP4 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.'
const UNREADABLE =
  '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.'
const TIMED_OUT =
  '파일 길이를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 확인하거나 다른 파일을 올려 주세요.'
const MANY_FILES = '파일은 한 번에 하나만 올릴 수 있어요.'
const REFUSED = '이 파일은 연주로 사용할 수 없어요.'

const main = (page: Page) => page.locator('#workspace-content')
const opener = (page: Page) =>
  main(page).getByRole('button', { name: '파일 올리기', exact: true })
const takes = (page: Page) => main(page).locator('select option')
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: '연주 파일 올리기' })
const compare = (page: Page) =>
  dialog(page).getByRole('button', { name: '비교하기', exact: true })
const cancel = (page: Page) =>
  dialog(page).getByRole('button', { name: '취소', exact: true })
const closeButton = (page: Page) =>
  dialog(page).getByRole('button', { name: '연주 파일 올리기 창 닫기' })
const dropzone = (page: Page) =>
  dialog(page).getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
const replace = (page: Page) =>
  dialog(page).getByRole('button', { name: '파일 바꾸기', exact: true })
const alertText = (page: Page) => dialog(page).getByRole('alert')
const confirmation = (page: Page) => page.getByRole('alertdialog')
const sidebarTask = (page: Page, name: string | RegExp) =>
  page.getByRole('complementary').getByRole('button', { name, exact: true })
const taskTitle = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true })
// Whether the page asks the browser to confirm before it closes.
const pageCloseIsHeld = (page: Page) =>
  page.evaluate(() => {
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    return closing.defaultPrevented
  })

// 1.5KB of zeros; the harness probe decides each file's length by name, and
// slow.mp3 waits for the length a test gives it.
function audio(name: string, size = 1536) {
  return { name, mimeType: 'audio/mpeg', buffer: Buffer.alloc(size) }
}

type Upload = ReturnType<typeof audio>

// Safari gives a clicked button no focus, so focus has nowhere to return to.
async function pressOpener(page: Page) {
  await opener(page).focus()
  await page.keyboard.press('Enter')
}

async function openDialog(page: Page) {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-seed=saved',
  )
  await main(page).getByRole('tab', { name: /^비교/ }).click()
  await expect(takes(page)).toHaveCount(1, { timeout: 15_000 })
  await pressOpener(page)
  await expect(dialog(page)).toBeVisible()
}

async function choose(page: Page, file: Upload) {
  const picker = (await replace(page).count()) ? replace(page) : dropzone(page)
  const chooser = page.waitForEvent('filechooser')
  await picker.click()
  await (await chooser).setFiles(file)
}

async function chooseLength(page: Page, seconds: number, size?: number) {
  await choose(page, audio('slow.mp3', size))
  await expect(dialog(page).getByText('slow.mp3')).toBeVisible()
  await page.evaluate(
    (length) => window.workspaceTest.resolveProbe(length),
    seconds,
  )
}

async function dropFiles(page: Page, names: readonly string[]) {
  const dataTransfer = await page.evaluateHandle((list) => {
    const transfer = new DataTransfer()
    for (const name of list)
      transfer.items.add(
        new File([new Uint8Array(1536)], name, { type: 'audio/mpeg' }),
      )
    return transfer
  }, names)
  for (const type of ['dragenter', 'dragover', 'drop'])
    await dropzone(page).dispatchEvent(type, { dataTransfer })
}

test('opens on the drop area with the section guide and nothing to compare yet', async ({
  page,
}) => {
  await openDialog(page)

  await expect(dialog(page).getByText(GUIDE)).toBeVisible()
  await expect(dialog(page).getByText(PRIVACY)).toBeVisible()
  await expect(dropzone(page)).toBeFocused()
  await expect(dropzone(page)).toHaveAccessibleDescription(HINT)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(alertText(page)).toHaveCount(0)
})

test('a file of the right length is saved, closing the dialog and adding the take', async ({
  page,
}) => {
  await openDialog(page)

  await choose(page, audio('slow.mp3'))
  await expect(dialog(page).getByText('길이 확인 중 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')

  await page.evaluate(() => window.workspaceTest.resolveProbe(24.1))
  await expect(dialog(page).getByText('00:24 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
  await expect(alertText(page)).toHaveCount(0)

  await compare(page).click()

  await expect(dialog(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(2)
  await expect(takes(page).first()).toContainText('파일 #2')
  await expect(opener(page)).toBeFocused()
})

test('a dropped file is checked like a chosen one', async ({ page }) => {
  await openDialog(page)

  await dropFiles(page, ['fresh_riff.mp3'])

  await expect(dialog(page).getByText('fresh_riff.mp3')).toBeVisible()
  await expect(alertText(page)).toHaveText(TOO_LONG)
})

test('dropping two files asks for one and keeps the drop area', async ({
  page,
}) => {
  await openDialog(page)

  await dropFiles(page, ['fresh_riff.mp3', 'broken.mp3'])

  await expect(alertText(page)).toHaveText(MANY_FILES)
  await expect(dropzone(page)).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')
})

test('a format that cannot be uploaded is refused without reading its length', async ({
  page,
}) => {
  await openDialog(page)

  await choose(page, {
    name: 'take.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.alloc(1536),
  })

  await expect(alertText(page)).toHaveText(BAD_FORMAT)
  await expect(dialog(page).getByText('1.5KB', { exact: true })).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')
  expect(await page.evaluate(() => window.workspaceTest.probeCalls())).toEqual(
    [],
  )
})

test('a file much shorter than the section cannot be compared', async ({
  page,
}) => {
  await openDialog(page)

  await chooseLength(page, 8.2)

  await expect(alertText(page)).toHaveText(TOO_SHORT)
  await expect(dialog(page).getByText('00:08 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')

  // Playwright refuses to click an aria-disabled button; a user still can.
  await compare(page).evaluate((button: HTMLElement) => button.click())
  await expect(dialog(page)).toBeVisible()
  await expect(takes(page)).toHaveCount(1)
})

test('a file much longer than the section cannot be compared', async ({
  page,
}) => {
  await openDialog(page)

  await choose(page, audio('fresh_riff.mp3'))

  await expect(alertText(page)).toHaveText(TOO_LONG)
  await expect(dialog(page).getByText('02:20 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')
})

test('a file that does not play is refused', async ({ page }) => {
  await openDialog(page)

  await choose(page, audio('broken.mp3'))

  await expect(alertText(page)).toHaveText(UNREADABLE)
  await expect(dialog(page).getByText('길이 알 수 없음 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')
})

test('a length check that took too long can be run again', async ({ page }) => {
  await openDialog(page)

  await choose(page, audio('slow.mp3'))
  await expect(dialog(page).getByText('slow.mp3')).toBeVisible()
  await page.evaluate(() => window.workspaceTest.timeOutProbe())
  await expect(alertText(page)).toHaveText(TIMED_OUT)

  await dialog(page).getByRole('button', { name: '다시 확인' }).click()

  await expect(alertText(page)).toHaveCount(0)
  await expect(replace(page)).toBeFocused()
  await expect
    .poll(() => page.evaluate(() => window.workspaceTest.probeCalls().length))
    .toBe(2)
  await page.evaluate(() => window.workspaceTest.resolveProbe(24.1))
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
})

test('choosing another file drops the check of the one before', async ({
  page,
}) => {
  await openDialog(page)

  await choose(page, audio('slow.mp3'))
  await expect(dialog(page).getByText('slow.mp3')).toBeVisible()
  await choose(page, audio('fresh_riff.mp3'))
  await expect(alertText(page)).toHaveText(TOO_LONG)

  // The first file's length arrives after it was replaced.
  await page.evaluate(() => window.workspaceTest.resolveProbe(24.1))
  await expect(dialog(page).getByText('fresh_riff.mp3')).toBeVisible()
  await expect(alertText(page)).toHaveText(TOO_LONG)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')

  await choose(page, audio('slow.mp3'))
  await expect(alertText(page)).toHaveCount(0)
  await expect(dialog(page).getByText('길이 확인 중 · 1.5KB')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'true')

  await page.evaluate(() => window.workspaceTest.resolveProbe(24.1))
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
})

test('a refused save keeps the dialog and the file so it can be tried again', async ({
  page,
}) => {
  await openDialog(page)
  // The mock refuses an empty file when it is saved.
  await chooseLength(page, 24.1, 0)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')

  await compare(page).click()

  await expect(alertText(page)).toHaveText(REFUSED)
  await expect(dialog(page).getByText('slow.mp3')).toBeVisible()
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
  await expect(takes(page)).toHaveCount(1)

  await chooseLength(page, 24.1)
  await expect(alertText(page)).toHaveCount(0)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
  await compare(page).click()

  await expect(dialog(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(2)
})

test('pressing 비교하기 twice saves one take', async ({ page }) => {
  await openDialog(page)
  await chooseLength(page, 24.1)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')

  await compare(page).evaluate((button: HTMLElement) => {
    button.click()
    button.click()
  })

  await expect(dialog(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(2)
})

test('the dialog cannot be closed while the take is being saved', async ({
  page,
}) => {
  await openDialog(page)
  await chooseLength(page, 24.1, 0)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')

  await dialog(page).evaluate((element: HTMLDialogElement) => {
    const button = (name: string) =>
      [...element.querySelectorAll('button')].find(
        (candidate) =>
          candidate.textContent === name ||
          candidate.getAttribute('aria-label') === name,
      )
    button('비교하기')?.click()
    button('취소')?.click()
    button('연주 파일 올리기 창 닫기')?.click()
    element.dispatchEvent(new Event('cancel', { cancelable: true }))
  })

  // Saving this file fails, so a close that was let through would show here.
  await expect(alertText(page)).toHaveText(REFUSED)
  await expect(dialog(page)).toBeVisible()
})

test('leaving while the file is being saved asks first', async ({ page }) => {
  // Back needs an earlier screen of the workspace to return to. No take is
  // seeded, since a seed would hang on the same save.
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-save=hangs',
  )
  await sidebarTask(page, '인트로').click()
  await expect(taskTitle(page, '인트로')).toBeVisible()
  await sidebarTask(page, /^벌스 1/).click()
  await main(page).getByRole('tab', { name: /^비교/ }).click()
  await expect(opener(page)).toBeVisible({ timeout: 15_000 })
  await pressOpener(page)
  await chooseLength(page, 24.1)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
  // A file that was only chosen is not worth asking about.
  expect(await pageCloseIsHeld(page)).toBe(false)

  await compare(page).click()
  await expect(dialog(page).getByRole('status')).toHaveText(
    '연주를 저장하고 있어요.',
  )
  expect(await pageCloseIsHeld(page)).toBe(true)

  await page.goBack()
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')
  await confirmation(page).getByRole('button', { name: '취소' }).click()
  await expect(confirmation(page)).toBeHidden()
  await expect(dialog(page)).toBeVisible()
  await expect(taskTitle(page, '벌스 1')).toBeVisible()

  await page.goBack()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()
  await expect(taskTitle(page, '인트로')).toBeVisible()
  await expect(dialog(page)).toBeHidden()
  expect(await pageCloseIsHeld(page)).toBe(false)
})

// Saving waits until the test lets it go, then runs as the mock does.
async function holdSave(page: Page) {
  await page.addInitScript(() => {
    const gate = new Promise((resolve) => {
      Object.assign(globalThis, { releaseSave: resolve })
    })
    Object.assign(globalThis, { saveGate: gate, saveReleased: false })
  })
  await page.route('**/mockComparisonRepository.ts*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const signature = 'async savePerformance(input, signal) {'
    const refusal = 'if (input.audio.size === 0)'
    expect(source).toContain(signature)
    expect(source.split(refusal)).toHaveLength(2)
    // The flag goes up after the mock's own wait, as it decides the file.
    const body = source
      .replace(signature, `${signature} await globalThis.saveGate;`)
      .replace(refusal, `globalThis.saveReleased = true; ${refusal}`)
    await route.fulfill({ response, body })
  })
}

test('a save that fails while leaving is asked about stays with its error', async ({
  page,
}) => {
  await holdSave(page)
  // Back needs an earlier screen of the workspace to return to.
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1',
  )
  await sidebarTask(page, '인트로').click()
  await expect(taskTitle(page, '인트로')).toBeVisible()
  await sidebarTask(page, /^벌스 1/).click()
  await main(page).getByRole('tab', { name: /^비교/ }).click()
  await expect(opener(page)).toBeVisible({ timeout: 15_000 })
  await pressOpener(page)
  // The mock refuses an empty file when it is saved.
  await chooseLength(page, 24.1, 0)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false')
  await compare(page).click()
  await expect(dialog(page).getByRole('status')).toHaveText(
    '연주를 저장하고 있어요.',
  )

  await page.goBack()
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')
  await page.evaluate(() => {
    ;(globalThis as unknown as { releaseSave(): void }).releaseSave()
  })
  await page.waitForFunction(
    () => (globalThis as unknown as { saveReleased: boolean }).saveReleased,
  )
  // React renders what the failure changed within a frame or two.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )

  // The question stays, and the failure waits behind it.
  await expect(confirmation(page)).toBeVisible()
  await confirmation(page).getByRole('button', { name: '취소' }).click()
  await expect(confirmation(page)).toBeHidden()
  await expect(alertText(page)).toHaveText(REFUSED)
  await expect(taskTitle(page, '벌스 1')).toBeVisible()
  expect(await pageCloseIsHeld(page)).toBe(true)

  // Choosing again leaves nothing unsaved to ask about.
  await choose(page, audio('slow.mp3'))
  await expect(alertText(page)).toHaveCount(0)
  expect(await pageCloseIsHeld(page)).toBe(false)
})

test('Esc closes the dialog, returns focus and forgets the file', async ({
  page,
}) => {
  await openDialog(page)
  await choose(page, audio('fresh_riff.mp3'))
  await expect(alertText(page)).toHaveText(TOO_LONG)

  await page.keyboard.press('Escape')

  await expect(dialog(page)).toBeHidden()
  await expect(opener(page)).toBeFocused()
  await expect(takes(page)).toHaveCount(1)

  await pressOpener(page)
  await expect(dropzone(page)).toBeVisible()
  await expect(alertText(page)).toHaveCount(0)
})

test('취소 and the close button close the dialog and return focus', async ({
  page,
}) => {
  await openDialog(page)

  await cancel(page).click()
  await expect(dialog(page)).toBeHidden()
  await expect(opener(page)).toBeFocused()

  await pressOpener(page)
  await closeButton(page).click()
  await expect(dialog(page)).toBeHidden()
  await expect(opener(page)).toBeFocused()
})

test('backing out of the file chooser leaves the dialog open', async ({
  page,
}) => {
  await openDialog(page)

  await dialog(page)
    .locator('input[type="file"]')
    .evaluate((input) =>
      input.dispatchEvent(new Event('cancel', { bubbles: true })),
    )

  await expect(dialog(page)).toBeVisible()
})

test('Tab and Shift+Tab keep focus inside the dialog', async ({
  page,
  browserName,
}) => {
  // Safari's default Tab skips buttons; Option+Tab reaches them.
  const option = browserName === 'webkit' ? 'Alt+' : ''
  await openDialog(page)
  await choose(page, audio('fresh_riff.mp3'))
  await expect(alertText(page)).toHaveText(TOO_LONG)

  for (const key of [`${option}Tab`, `${option}Shift+Tab`]) {
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press(key)
      const inside = await dialog(page).evaluate((element) =>
        element.contains(document.activeElement),
      )
      expect(inside, `${key} press ${press + 1}`).toBe(true)
    }
  }
})
