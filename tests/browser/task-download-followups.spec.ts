import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const title = (page: Page) => main(page).getByRole('heading', { level: 1 })
const panel = (page: Page) =>
  main(page).getByRole('region', { name: '타브', exact: true })
const heading = (page: Page) =>
  panel(page).getByRole('heading', { name: '타브', exact: true })
const staff = (page: Page) =>
  panel(page).getByRole('img', { name: /^타브 악보/ })
const trigger = (page: Page) =>
  main(page).getByRole('button', { name: '내려받기', exact: true })
const menu = (page: Page) => page.getByRole('menu', { name: '내려받기' })
const item = (page: Page, name: string) =>
  menu(page).getByRole('menuitem', { name, exact: true })
const failure = (page: Page) =>
  main(page).getByRole('alert').filter({ hasText: '타브를 내려받지 못했어요.' })
const sidebarTask = (page: Page, name: RegExp) =>
  page
    .getByRole('complementary', { name: '워크스페이스 탐색' })
    .getByRole('button', { name })

// The PDF code and its fonts load on the first export; tests that export
// are marked slow, so this fits inside them.
const EXPORT_TIMEOUT = { timeout: 20_000 }
// The drawing code loads on its own after the page.
const STAFF_TIMEOUT = { timeout: 15_000 }

// 벌스 1 with the screen refreshing, so a change on the server shows.
async function openVerse(page: Page) {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&refresh=150',
  )
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
}

// 구간 수정 from another browser tab, already finished: the screen loads
// the new section's tab on its next refresh.
async function changeSection(page: Page, rangeEndSeconds: number) {
  await page.evaluate((end) => {
    window.workspaceTest.reviseTaskOnServer('task-verse', {
      sectionName: '벌스 1',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 0,
      rangeEndSeconds: end,
    })
    window.workspaceTest.updateTaskOnServer('task-verse', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    })
  }, rangeEndSeconds)
}

// Three minutes of two-second bars: a PDF of several pages.
async function openLongVerse(page: Page) {
  await openVerse(page)
  await changeSection(page, 180)
  await expect(staff(page)).toHaveAccessibleName('타브 악보 90마디')
}

// svg2pdf.js measures text in a hidden svg it adds to the body, once for
// each page it draws, so counting them counts pages. `leave` is pressed in
// a task of its own as the first page draws, as a user's press would come.
async function countPages(page: Page, leave?: Locator) {
  await page.evaluate(
    (button) => {
      let drawn = 0
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node.nodeName !== 'svg') continue
            drawn += 1
            document.documentElement.dataset.pagesDrawn = String(drawn)
            if (drawn === 1 && button)
              setTimeout(() => (button as HTMLElement).click())
          }
      }).observe(document.body, { childList: true })
    },
    leave ? await leave.elementHandle() : null,
  )
}

const pagesDrawn = (page: Page) =>
  page.evaluate(() => Number(document.documentElement.dataset.pagesDrawn ?? 0))

// Opens 벌스 1 again and saves its PDF; the number of pages in the file.
async function pdfAgain(page: Page): Promise<number> {
  await sidebarTask(page, /^벌스 1/).click()
  await expect(staff(page)).toHaveAccessibleName(
    '타브 악보 90마디',
    STAFF_TIMEOUT,
  )
  const saved = page.waitForEvent('download', EXPORT_TIMEOUT)
  await trigger(page).click()
  await item(page, 'PDF').click()
  const bytes = await readFile(await (await saved).path())
  return (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

test('a PDF left while its fonts load draws no page', async ({ page }) => {
  test.slow()
  await openLongVerse(page)
  await countPages(page)
  let releaseFonts = () => {}
  const held = new Promise<void>((resolve) => (releaseFonts = resolve))
  await page.route('**/*.ttf', async (route) => {
    await held
    await route.continue()
  })

  await trigger(page).click()
  await item(page, 'PDF').click()
  await sidebarTask(page, /^솔로/).click()
  await expect(title(page)).toHaveText('솔로')
  releaseFonts()

  // Every page drawn belongs to the PDF made after coming back.
  const pages = await pdfAgain(page)
  expect(await pagesDrawn(page)).toBe(pages)
})

test('a PDF stops at the next page once the screen is left', async ({
  page,
}) => {
  test.slow()
  await openLongVerse(page)
  await countPages(page, sidebarTask(page, /^솔로/))

  await trigger(page).click()
  await item(page, 'PDF').click()
  await expect(title(page)).toHaveText('솔로')

  // The PDF left behind drew a page or so before it stopped; the one made
  // after coming back drew all of its own.
  const pages = await pdfAgain(page)
  expect(pages).toBeGreaterThan(2)
  const left = (await pagesDrawn(page)) - pages
  expect(left).toBeGreaterThanOrEqual(1)
  expect(left).toBeLessThan(pages)
})

test('a page that fails to draw leaves nothing in the body', async ({
  page,
}) => {
  test.slow()
  await openVerse(page)
  // Measuring text in svg2pdf.js's hidden svg fails, as drawing a page can.
  await page.evaluate(() => {
    const getBBox = SVGGraphicsElement.prototype.getBBox
    SVGGraphicsElement.prototype.getBBox = function (
      this: SVGGraphicsElement,
      options?: SVGBoundingBoxOptions,
    ) {
      if (this.ownerSVGElement?.parentNode === document.body)
        throw new Error('Text could not be measured')
      return getBBox.call(this, options)
    }
  })

  await trigger(page).click()
  await item(page, 'PDF').click()
  await expect(failure(page)).toBeVisible(EXPORT_TIMEOUT)
  await expect(page.locator('body > svg')).toHaveCount(0)
})

test('focus in the download notice or menu stays in the tab as it loads again', async ({
  page,
}) => {
  test.slow()
  await openVerse(page)
  await page.route('**/*.ttf', (route) => route.abort())
  await trigger(page).click()
  await item(page, 'PDF').click()
  await expect(failure(page)).toBeVisible(EXPORT_TIMEOUT)

  // The notice goes with the tab it failed for; its button had focus.
  await failure(page).getByRole('button', { name: '다시 시도' }).focus()
  await changeSection(page, 50)
  await expect(failure(page)).toHaveCount(0)
  await expect(heading(page)).toBeFocused()
  await expect(staff(page)).toHaveAccessibleName('타브 악보 25마디')
  await expect(heading(page)).toBeFocused()

  // So does the open menu, and 내려받기 with it.
  await trigger(page).click()
  await expect(item(page, 'PNG 이미지')).toBeFocused()
  await changeSection(page, 60)
  await expect(menu(page)).toHaveCount(0)
  await expect(heading(page)).toBeFocused()
  await expect(staff(page)).toHaveAccessibleName('타브 악보 30마디')
})
