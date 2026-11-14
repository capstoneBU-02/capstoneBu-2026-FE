import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const tracks = (page: Page) => main(page).getByRole('region', { name: '트랙' })
const lane = (page: Page, label: string) =>
  tracks(page)
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator('[data-state]')
const panel = (page: Page) =>
  main(page).getByRole('region', { name: '타브', exact: true })
const staff = (page: Page) =>
  panel(page).getByRole('img', { name: /^타브 악보/ })
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const choice = (page: Page, label: string) =>
  player(page)
    .getByRole('group', { name: '재생 트랙' })
    .getByRole('radio', { name: label, exact: true })
const trigger = (page: Page) =>
  main(page).getByRole('button', { name: '내려받기', exact: true })
const busyTrigger = (page: Page) =>
  main(page).getByRole('button', { name: '내려받는 중…' })
const menu = (page: Page) => page.getByRole('menu', { name: '내려받기' })
const item = (page: Page, name: string) =>
  menu(page).getByRole('menuitem', { name, exact: true })
const progress = (page: Page) =>
  main(page).locator('[data-announcer="tab-download"]')
const failure = (page: Page) =>
  main(page).getByRole('alert').filter({ hasText: '타브를 내려받지 못했어요.' })
const banner = (page: Page) =>
  main(page).getByRole('alert').filter({ hasText: '음원을 재생하지 못했어요' })

// Synthesis, decoding and peaks take a moment on a loaded machine.
const AUDIO_TIMEOUT = { timeout: 15_000 }
// The PDF code and its fonts load on the first export; tests that export
// are marked slow, so this fits inside them.
const EXPORT_TIMEOUT = { timeout: 20_000 }
// The drawing code loads on its own after the page.
const STAFF_TIMEOUT = { timeout: 15_000 }

function openTask(page: Page, taskId: string, query = '') {
  return page.goto(
    `/tests/browser/harness.html?view=task&task=${taskId}${query}`,
  )
}

async function downloadAs(page: Page, name: string): Promise<Download> {
  const saved = page.waitForEvent('download', EXPORT_TIMEOUT)
  await trigger(page).click()
  await item(page, name).click()
  return saved
}

async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path()
  return readFile(path)
}

// Width and height from the PNG header (IHDR follows the signature).
function pngSize(bytes: Buffer) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test('a finished task offers 구간 수정 and 내려받기 but no 녹음', async ({
  page,
}) => {
  await openTask(page, 'task-verse')
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  await expect(
    main(page).getByRole('button', { name: '구간 수정' }),
  ).toBeVisible()
  await expect(trigger(page)).toBeVisible()
  await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'menu')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(main(page).getByRole('button', { name: '녹음' })).toHaveCount(0)
})

test('내려받기 waits for the tab', async ({ page }) => {
  await openTask(page, 'task-verse', '&scenario=pending-tab')
  await expect(panel(page).getByRole('status')).toBeVisible()
  await expect(
    main(page).getByRole('button', { name: '구간 수정' }),
  ).toBeVisible()
  await expect(trigger(page)).toHaveCount(0)

  await page.evaluate(() => window.workspaceTest.failTab('tab-unavailable'))
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(trigger(page)).toHaveCount(0)

  await panel(page).getByRole('button', { name: '다시 시도' }).click()
  await page.evaluate(() => window.workspaceTest.resolveTab())
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  await expect(trigger(page)).toBeVisible()
})

test('내려받기 waits for the drawn tab, and goes if it cannot be drawn', async ({
  page,
}) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let failing = true
  await page.route('**/src/features/tab/TabStaff.tsx*', async (route) => {
    if (!failing) return route.continue()
    await held
    return route.abort()
  })
  await openTask(page, 'task-verse')
  // The score is in; the drawing code is not.
  await expect(panel(page).getByRole('status')).toHaveText(
    '타브를 불러오는 중이에요',
  )
  await expect(
    main(page).getByRole('button', { name: '구간 수정' }),
  ).toBeVisible()
  await expect(trigger(page)).toHaveCount(0)

  release()
  await expect(panel(page).getByRole('alert')).toContainText(
    '타브를 표시하지 못했어요',
  )
  await expect(trigger(page)).toHaveCount(0)

  failing = false
  await panel(page).getByRole('button', { name: '다시 시도' }).click()
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  await expect(trigger(page)).toBeVisible()
})

test('a running task has nothing to download', async ({ page }) => {
  await openTask(page, 'task-solo')
  await expect(main(page).getByRole('heading', { name: '솔로' })).toBeVisible()
  await expect(trigger(page)).toHaveCount(0)
})

test('the download menu works from the keyboard', async ({ page }) => {
  await openTask(page, 'task-verse')
  await expect(trigger(page)).toBeVisible()

  await trigger(page).focus()
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeVisible()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(page, 'PNG 이미지')).toBeFocused()
  await expect(item(page, 'PNG 이미지')).toHaveAccessibleDescription(
    '보이는 타브를 그림 한 장으로',
  )
  await expect(item(page, 'PDF')).toHaveAccessibleDescription(
    '인쇄하기 좋게 페이지로 나눠서',
  )

  await page.keyboard.press('ArrowDown')
  await expect(item(page, 'PDF')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item(page, 'PNG 이미지')).toBeFocused()
  await page.keyboard.press('End')
  await expect(item(page, 'PDF')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(item(page, 'PNG 이미지')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(menu(page)).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')

  // A press elsewhere closes it too.
  await trigger(page).click()
  await expect(menu(page)).toBeVisible()
  await panel(page).getByRole('heading', { name: '타브' }).click()
  await expect(menu(page)).toHaveCount(0)
})

test('PNG saves the tab on screen at twice its size', async ({ page }) => {
  test.slow()
  await openTask(page, 'task-verse')
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  const width = Number(await staff(page).getAttribute('width'))
  const height = Number(await staff(page).getAttribute('height'))

  const download = await downloadAs(page, 'PNG 이미지')
  expect(download.suggestedFilename()).toBe('neon_harbor_live_벌스 1.png')
  const bytes = await bytesOf(download)
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
  expect(pngSize(bytes)).toEqual({ width: width * 2, height: height * 2 })
  // The menu closes and focus goes back to where it opened.
  await expect(menu(page)).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()
  await expect(failure(page)).toHaveCount(0)
  // The busy button's new name is not read out; a status line is.
  await expect(progress(page)).toHaveText('타브를 내려받았어요.')
})

test('PDF saves the tab as vector pages with its font', async ({ page }) => {
  test.slow()
  // Three minutes from the start: about ninety bars, more than a page.
  await openTask(page, 'task-verse', '&refresh=150')
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  await page.evaluate(() => {
    window.workspaceTest.reviseTaskOnServer('task-verse', {
      sectionName: '벌스 1',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 0,
      rangeEndSeconds: 180,
    })
    window.workspaceTest.updateTaskOnServer('task-verse', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    })
  })
  await expect(staff(page)).toHaveAccessibleName('타브 악보 90마디')

  const download = await downloadAs(page, 'PDF')
  expect(download.suggestedFilename()).toBe('neon_harbor_live_벌스 1.pdf')
  const text = (await bytesOf(download)).toString('latin1')
  expect(text.startsWith('%PDF-')).toBe(true)
  const pages = text.match(/\/Type\s*\/Page(?!s)/g) ?? []
  expect(pages.length).toBeGreaterThan(1)
  // Both faces of JetBrains Mono are embedded and in use: each lists the
  // widths of the glyphs it draws, frets in bold and the rest in regular.
  const faces = [
    ...text.matchAll(
      /\/BaseFont \/JetBrains#20Mono\s*\/FontDescriptor \d+ 0 R\s*\/W \[(.*)\]/g,
    ),
  ].map((match) => match[1])
  expect(faces).toHaveLength(2)
  for (const widths of faces) expect(widths.trim()).not.toBe('')
  // Drawn as paths and text, never as a picture.
  expect(text).not.toMatch(/\/Subtype\s*\/Image/)
})

test('a failed download keeps the tab and can be tried again', async ({
  page,
}) => {
  test.slow()
  await openTask(page, 'task-verse')
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  // Hold the PDF font until the test lets it fail.
  let failFont: () => void = () => {}
  const held = new Promise<void>((resolve) => (failFont = resolve))
  await page.route('**/*.ttf', async (route) => {
    await held
    await route.abort()
  })

  await trigger(page).click()
  await item(page, 'PDF').click()
  await expect(busyTrigger(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(progress(page)).toHaveText('타브를 내려받는 중이에요.')
  await busyTrigger(page).click({ force: true })
  await expect(menu(page)).toHaveCount(0)

  failFont()
  await expect(failure(page)).toBeVisible(EXPORT_TIMEOUT)
  // The alert tells of the failure; the status line goes quiet.
  await expect(progress(page)).toHaveText('')
  const retry = failure(page).getByRole('button', { name: '다시 시도' })
  await expect(retry).toBeVisible()
  // The tab and the player stay as they were.
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)
  await expect(player(page)).toBeVisible()
  await expect(trigger(page)).toHaveAttribute('aria-disabled', 'false')

  await page.unroute('**/*.ttf')
  const saved = page.waitForEvent('download', EXPORT_TIMEOUT)
  await retry.click()
  const download = await saved
  expect(download.suggestedFilename()).toBe('neon_harbor_live_벌스 1.pdf')
  await expect(failure(page)).toHaveCount(0)
  // The notice goes with its button; focus returns to 내려받기.
  await expect(trigger(page)).toBeFocused()
})

test('the download notice sits above the player bar', async ({ page }) => {
  test.slow()
  await openTask(page, 'task-verse', '&refresh=150')
  await expect(staff(page)).toHaveAccessibleName('타브 악보 12마디')
  await page.route('**/*.ttf', (route) => route.abort())
  await trigger(page).click()
  await item(page, 'PDF').click()
  await expect(failure(page)).toBeVisible(EXPORT_TIMEOUT)

  const notice = (await failure(page).boundingBox())!
  const bar = (await player(page).boundingBox())!
  expect(notice.y + notice.height).toBeLessThanOrEqual(bar.y)
  const centre = notice.x + notice.width / 2
  expect(Math.abs(centre - (bar.x + bar.width / 2))).toBeLessThan(2)

  // Another section starts without it.
  await page.evaluate(() => {
    window.workspaceTest.reviseTaskOnServer('task-verse', {
      sectionName: '벌스 1',
      part: 'rhythm',
      tuningId: 'e-standard',
      rangeStartSeconds: 42.1,
      rangeEndSeconds: 50,
    })
    window.workspaceTest.updateTaskOnServer('task-verse', {
      processingStatus: 'completed',
      progressPercent: null,
      hasSeparatedAudio: true,
    })
  })
  await expect(staff(page)).toHaveAccessibleName('타브 악보 4마디')
  await expect(failure(page)).toHaveCount(0)
})

test('the menu and its trigger fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openTask(page, 'task-verse')
  await expect(trigger(page)).toBeVisible()
  await trigger(page).click()
  await expect(menu(page)).toBeVisible()
  const box = (await menu(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('a track that fails to play leaves the tab to read and download', async ({
  page,
}) => {
  // Waits on audio, drawing code and an export, one after another.
  test.slow()
  await openTask(page, 'task-verse', '&scenario=separated-error')
  const guitar = lane(page, '분리 기타')
  await expect(guitar).toHaveAttribute('data-state', 'failed', AUDIO_TIMEOUT)
  await expect(banner(page)).toContainText(
    '분리 기타 음원을 재생하지 못했어요. 타브는 그대로 볼 수 있어요.',
  )
  // The banner sits above the tracks and holds the one retry.
  const above = (await banner(page).boundingBox())!
  const below = (await tracks(page).boundingBox())!
  expect(above.y + above.height).toBeLessThanOrEqual(below.y)
  await expect(
    guitar.getByRole('button', { name: '분리 기타 다시 시도' }),
  ).toHaveCount(0)
  await expect(staff(page)).toBeVisible(STAFF_TIMEOUT)

  const download = await downloadAs(page, 'PNG 이미지')
  expect(download.suggestedFilename()).toBe('neon_harbor_live_벌스 1.png')

  await page.evaluate(() => window.workspaceTest.healAudio())
  await banner(page).getByRole('button', { name: '다시 불러오기' }).click()
  await expect(guitar).toHaveAttribute('data-state', 'ready', AUDIO_TIMEOUT)
  await expect(banner(page)).toHaveCount(0)
  // The button goes with the banner; focus lands on the track it reloaded.
  await expect(guitar).toBeFocused()
})

test('playing the original hands the retry back to the guitar row', async ({
  page,
}) => {
  await openTask(page, 'task-verse', '&scenario=separated-error')
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'failed',
    AUDIO_TIMEOUT,
  )
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await expect(banner(page)).toBeVisible()

  await choice(page, '원곡').check()
  await expect(banner(page)).toHaveCount(0)
  await expect(
    lane(page, '분리 기타').getByRole('button', {
      name: '분리 기타 다시 시도',
    }),
  ).toBeVisible()
})

test('a running task keeps the retry in its track row', async ({ page }) => {
  await openTask(page, 'task-solo', '&scenario=separated-error')
  const guitar = lane(page, '분리 기타')
  await expect(guitar).toHaveAttribute('data-state', 'failed', AUDIO_TIMEOUT)
  await expect(banner(page)).toHaveCount(0)
  await expect(
    guitar.getByRole('button', { name: '분리 기타 다시 시도' }),
  ).toBeVisible()
})
