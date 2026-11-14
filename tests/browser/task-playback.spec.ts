import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const tracks = (page: Page) => main(page).getByRole('region', { name: '트랙' })
const row = (page: Page, label: string) =>
  tracks(page)
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${label}`) })
const lane = (page: Page, label: string) =>
  row(page, label).locator('[data-state]')
const position = (page: Page) =>
  tracks(page).getByRole('slider', { name: '재생 위치' })
const playhead = (page: Page) => tracks(page).getByTestId('playhead')
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const switcher = (page: Page) =>
  player(page).getByRole('group', { name: '재생 트랙' })
const choice = (page: Page, label: string) =>
  switcher(page).getByRole('radio', { name: label, exact: true })
const playButton = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pauseButton = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const restartButton = (page: Page) =>
  player(page).getByRole('button', { name: '구간 처음으로' })
const elapsed = (page: Page) => player(page).getByTestId('elapsed')

type Change = Parameters<Window['workspaceTest']['updateTaskOnServer']>[1]

const audioContexts = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioContexts())
const audioSources = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioSources())
const sourceOffsets = (page: Page) =>
  page.evaluate(() => window.workspaceTest.sourceOffsets())
const commits = (page: Page) =>
  page.evaluate(() => window.workspaceTest.commits())

// Synthesis, decoding and peaks take a moment on a loaded machine.
const AUDIO_TIMEOUT = { timeout: 15_000 }
// task-solo: the section 02:31.0–02:52.4 of the original, 21.4 s long.
const SECTION_START = 151
const SECTION_LENGTH = 21.4

// mm:ss.d → seconds.
async function elapsedSeconds(page: Page) {
  const text = (await elapsed(page).textContent()) ?? ''
  const [minutes, seconds] = text.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

// As the slider reads a time: 6초, 10.7초.
function spoken(seconds: number) {
  const tenths = Math.round(seconds * 10)
  return tenths % 10 === 0
    ? `${tenths / 10}초`
    : `${(tenths / 10).toFixed(1)}초`
}

// WCAG relative luminance of a computed rgb() colour.
function luminance(color: string) {
  const [r, g, b] = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map((value) => {
      const channel = Number(value) / 255
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

async function openReadyTask(page: Page, taskId = 'task-solo', query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=${taskId}${query}`,
  )
  await expect(tracks(page)).toBeVisible()
  for (const label of ['분리 기타', '원곡'])
    await expect(lane(page, label)).toHaveAttribute(
      'data-state',
      'ready',
      AUDIO_TIMEOUT,
    )
}

// Opens the list first so the server can change the task before it opens.
async function openChangedTask(
  page: Page,
  taskName: RegExp,
  taskId: string,
  change: Change,
) {
  await page.goto('/tests/browser/harness.html')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.evaluate(
    ([id, next]) => window.workspaceTest.updateTaskOnServer(id, next),
    [taskId, change] as const,
  )
  await sidebar(page).getByRole('button', { name: taskName }).click()
  await expect(tracks(page)).toBeVisible()
}

// Clicks the waveforms this far across the section.
// A slider without audio still takes the click: force skips the wait for it
// to be enabled.
async function clickAt(page: Page, ratio: number, force = false) {
  const box = (await position(page).boundingBox())!
  await position(page).click({
    position: { x: box.width * ratio, y: box.height / 2 },
    force,
  })
}

// How much of the playing row's waveform shows in the accent, from its
// overlay cut at the play position.
async function playedShare(page: Page, label: string) {
  const clip = await row(page, label).evaluate((item) => {
    const overlay = [...item.querySelectorAll('div')].find(
      (element) => getComputedStyle(element).clipPath !== 'none',
    )
    return overlay ? getComputedStyle(overlay).clipPath : null
  })
  // inset(0px 50% 0px 0px): the right edge is cut.
  const right = clip?.match(/^inset\(\S+ ([\d.]+)%/)
  return right ? 1 - Number(right[1]) / 100 : null
}

async function playheadLeft(page: Page) {
  return (await playhead(page).boundingBox())!.x
}

test('the player switches between the original and the guitar', async ({
  page,
}) => {
  await openReadyTask(page)
  await expect(switcher(page)).toBeVisible()
  // The original comes first, as the tracks above read bottom to top.
  const radios = switcher(page).getByRole('radio')
  await expect(radios).toHaveCount(2)
  await expect(radios.nth(0)).toHaveAccessibleName('원곡')
  await expect(radios.nth(1)).toHaveAccessibleName('분리 기타')
  await expect(choice(page, '분리 기타')).toBeChecked()
  await expect(choice(page, '원곡')).toBeEnabled()
  // The chosen segment stands out from the switch, not by its text alone.
  const colors = await switcher(page).evaluate((group) => {
    const chosen = group.querySelector('label:has(:checked)')!
    return {
      group: getComputedStyle(group).backgroundColor,
      chosen: getComputedStyle(chosen).backgroundColor,
      text: getComputedStyle(chosen).color,
    }
  })
  expect(contrast(colors.chosen, colors.group)).toBeGreaterThanOrEqual(3)
  expect(contrast(colors.text, colors.chosen)).toBeGreaterThanOrEqual(4.5)

  await choice(page, '원곡').check()
  await expect(choice(page, '원곡')).toBeChecked()
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'true')
  await expect(row(page, '분리 기타')).toHaveAttribute('data-playing', 'false')
  await expect(player(page)).toContainText('/ 00:21.4')

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const [played] = await audioSources(page)
  expect(played.loopStart).toBeCloseTo(SECTION_START, 5)

  // The radios move with the arrow keys, as anywhere else.
  await choice(page, '원곡').press('ArrowRight')
  await expect(choice(page, '분리 기타')).toBeChecked()
  await expect(choice(page, '분리 기타')).toBeFocused()
})

test('switching while playing keeps playing from the same time', async ({
  page,
}) => {
  await openReadyTask(page)
  await playButton(page).click()
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(1)

  const before = await elapsedSeconds(page)
  await choice(page, '원곡').check()
  const after = await elapsedSeconds(page)
  await expect(pauseButton(page)).toBeVisible()
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'true')

  // The original plays on from where the guitar was, through the same output.
  const sources = await audioSources(page)
  expect(sources).toHaveLength(2)
  expect(sources[1].loopStart).toBeCloseTo(SECTION_START, 5)
  const offset = (await sourceOffsets(page))[1]! - SECTION_START
  expect(offset).toBeGreaterThanOrEqual(before)
  expect(offset).toBeLessThanOrEqual(after + 0.2)
  expect(await audioContexts(page)).toEqual(['running'])
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(after)

  await choice(page, '분리 기타').check()
  await expect(pauseButton(page)).toBeVisible()
  const [, , back] = await audioSources(page)
  expect(back.loopStart).toBe(0)
  expect((await sourceOffsets(page))[2]).toBeGreaterThan(offset)
  expect(await audioContexts(page)).toEqual(['running'])
})

test('switching while paused keeps the time for the next play', async ({
  page,
}) => {
  await openReadyTask(page)
  await playButton(page).click()
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(1)
  await pauseButton(page).click()
  const held = await elapsedSeconds(page)

  await choice(page, '원곡').check()
  await expect(playButton(page)).toBeVisible()
  expect(await elapsedSeconds(page)).toBeCloseTo(held, 5)
  expect(await audioSources(page)).toHaveLength(1)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const offset = (await sourceOffsets(page))[1]! - SECTION_START
  expect(offset).toBeGreaterThanOrEqual(held)
  expect(offset).toBeLessThan(held + 0.1)
})

test('a guitar track without sound cannot be chosen', async ({ page }) => {
  await openChangedTask(page, /^솔로/, 'task-solo', {
    processingStatus: 'queued',
    progressPercent: null,
    hasSeparatedAudio: false,
  })
  await expect(choice(page, '분리 기타')).toBeDisabled()
  await expect(choice(page, '원곡')).toBeChecked()

  // Separation found almost no guitar.
  await page.goto('/tests/browser/harness.html?view=task&task=task-chorus')
  await expect(tracks(page)).toBeVisible()
  await expect(choice(page, '분리 기타')).toBeDisabled()
  await expect(choice(page, '원곡')).toBeChecked()
})

test('separated-guitar input names its one track instead of a switch', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?view=task&task=task-intro')
  await expect(tracks(page)).toBeVisible()
  await expect(player(page)).toContainText('올린 음원')
  await expect(player(page).getByRole('radio')).toHaveCount(0)
})

test('a guitar still loading cannot be chosen yet', async ({ page }) => {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-solo&scenario=pending-separated',
  )
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await expect(lane(page, '분리 기타')).toHaveAttribute('data-state', 'loading')
  // Choosing it would stop the sound until it loads.
  await expect(choice(page, '분리 기타')).toBeDisabled()
  await choice(page, '원곡').check()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect(choice(page, '분리 기타')).toBeDisabled()
  await expect(choice(page, '원곡')).toBeChecked()
})

test('a guitar that fails to load leaves the original to play', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-solo&scenario=separated-error',
  )
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
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(choice(page, '분리 기타')).toBeDisabled()

  await choice(page, '원곡').check()
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'false')
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const [played] = await audioSources(page)
  expect(played.loopStart).toBeCloseTo(SECTION_START, 5)
  // The retry stays within reach above the waveforms' play position.
  await expect(
    lane(page, '분리 기타').getByRole('button', {
      name: '분리 기타 다시 시도',
    }),
  ).toBeVisible()
  await page.evaluate(() => window.workspaceTest.healAudio())
  await lane(page, '분리 기타')
    .getByRole('button', { name: '분리 기타 다시 시도' })
    .click()
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  // The guitar is there to choose; the original plays on until then.
  await expect(choice(page, '분리 기타')).toBeEnabled()
  await expect(choice(page, '원곡')).toBeChecked()
  await expect(pauseButton(page)).toBeVisible()
  expect(await audioSources(page)).toHaveLength(1)
})

test('the play position does nothing without audio to play', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-solo&scenario=separated-error',
  )
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'failed',
    AUDIO_TIMEOUT,
  )
  await expect(position(page)).toHaveAttribute('aria-disabled', 'true')
  await clickAt(page, 0.5, true)
  await expect(elapsed(page)).toHaveText('00:00.0')
  // Its keys still belong to it: the page stays where it is.
  await position(page).focus()
  const scrolled = await page.evaluate(() => window.scrollY)
  for (const key of ['End', 'PageDown', 'ArrowDown']) {
    await position(page).press(key)
    await expect(elapsed(page), key).toHaveText('00:00.0')
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  expect(await audioSources(page)).toEqual([])
})

test('clicking the waveforms moves the play position', async ({ page }) => {
  await openReadyTask(page)
  await expect(position(page)).toHaveAttribute('aria-valuetext', '0초')
  const start = await playheadLeft(page)

  await clickAt(page, 0.5)
  await expect(position(page)).toBeFocused()
  // Paused: only the next play's position moves.
  await expect(playButton(page)).toBeVisible()
  expect(await audioSources(page)).toEqual([])
  const half = await elapsedSeconds(page)
  expect(half).toBeGreaterThan(SECTION_LENGTH / 2 - 0.3)
  expect(half).toBeLessThan(SECTION_LENGTH / 2 + 0.3)
  await expect(position(page)).toHaveAttribute('aria-valuetext', spoken(half))
  expect(await playheadLeft(page)).toBeGreaterThan(start + 100)
  // The guitar plays: its waveform shows the half before the position in the
  // accent; the original has no overlay.
  expect(await playedShare(page, '분리 기타')).toBeCloseTo(
    half / SECTION_LENGTH,
    2,
  )
  expect(await playedShare(page, '원곡')).toBeNull()

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect((await sourceOffsets(page))[0]).toBeCloseTo(half, 1)

  // Playing: the sound moves there and keeps playing.
  await clickAt(page, 0.25)
  await expect(pauseButton(page)).toBeVisible()
  const quarter = (await sourceOffsets(page))[1]!
  expect(quarter).toBeGreaterThan(SECTION_LENGTH / 4 - 0.3)
  expect(quarter).toBeLessThan(SECTION_LENGTH / 4 + 0.3)

  // Back to the start, paused, moves the play position with it.
  await pauseButton(page).click()
  await restartButton(page).click()
  await expect(elapsed(page)).toHaveText('00:00.0')
  await expect(position(page)).toHaveAttribute('aria-valuetext', '0초')
  await expect.poll(() => playheadLeft(page)).toBeCloseTo(start, 0)
})

test('the play position steps with the keyboard like the section handles', async ({
  page,
}) => {
  await openReadyTask(page)
  await position(page).focus()
  await expect(position(page)).toHaveAttribute('aria-valuemin', '0')
  // The last tenth the time reaches, as End moves there.
  await expect(position(page)).toHaveAttribute('aria-valuemax', '21.3')

  const steps: Array<[string, string, string]> = [
    ['End', '21.3초', '00:21.3'],
    ['Home', '0초', '00:00.0'],
    ['ArrowRight', '0.1초', '00:00.1'],
    ['Shift+ArrowRight', '1.1초', '00:01.1'],
    ['PageUp', '6.1초', '00:06.1'],
    ['ArrowLeft', '6초', '00:06.0'],
    ['PageDown', '1초', '00:01.0'],
    ['Shift+ArrowLeft', '0초', '00:00.0'],
  ]
  for (const [key, spoken, shown] of steps) {
    await position(page).press(key)
    await expect(position(page), key).toHaveAttribute('aria-valuetext', spoken)
    await expect(position(page), key).toHaveAttribute(
      'aria-valuenow',
      String(Number(spoken.replace('초', ''))),
    )
    await expect(elapsed(page), key).toHaveText(shown)
  }
  // Other keys, such as Tab or with a modifier, are left alone.
  await position(page).press('Control+ArrowRight')
  await expect(position(page)).toHaveAttribute('aria-valuetext', '0초')

  // Playing: the sound moves and keeps playing.
  await position(page).press('PageUp')
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(5.5)
  await position(page).press('Home')
  await expect(pauseButton(page)).toBeVisible()
  const offsets = await sourceOffsets(page)
  expect(offsets).toHaveLength(2)
  expect(offsets[1]).toBeLessThan(0.1)
  await expect(position(page)).toHaveAttribute('aria-valuetext', '0초')
})

test('the play position follows playback without rendering the page', async ({
  page,
}) => {
  await openReadyTask(page)
  // The guitar row shows its played part over its waveform.
  await expect(row(page, '분리 기타').locator('canvas')).toHaveCount(2)
  await expect(row(page, '원곡').locator('canvas')).toHaveCount(1)

  await playButton(page).click()
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(0.5)
  const before = await playheadLeft(page)
  const rendered = await commits(page)
  await page.waitForTimeout(800)
  expect(await playheadLeft(page)).toBeGreaterThan(before + 10)
  expect(await commits(page)).toBe(rendered)

  // The line crosses both rows.
  const line = (await playhead(page).boundingBox())!
  const guitar = (await lane(page, '분리 기타').boundingBox())!
  const original = (await lane(page, '원곡').boundingBox())!
  expect(line.y).toBeLessThanOrEqual(guitar.y)
  expect(line.y + line.height).toBeGreaterThanOrEqual(
    original.y + original.height,
  )
})

test('leaving after a switch stops playback and closes the output', async ({
  page,
}) => {
  await openReadyTask(page)
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await choice(page, '원곡').check()
  await expect(pauseButton(page)).toBeVisible()

  await sidebar(page)
    .getByRole('button', { name: /^벌스 1/ })
    .click()
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '벌스 1',
  )
  await expect.poll(() => audioContexts(page)).toEqual(['closed'])
})
