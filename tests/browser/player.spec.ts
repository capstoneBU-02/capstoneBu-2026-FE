import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const form = (page: Page) => main(page).getByRole('form', { name: '새 구간' })
const startInput = (page: Page) =>
  form(page).getByLabel('시작', { exact: true })
const endInput = (page: Page) => form(page).getByLabel('끝', { exact: true })
const waveform = (page: Page) =>
  form(page).getByRole('group', { name: '구간 파형' })
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const playButton = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pauseButton = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const restartButton = (page: Page) =>
  player(page).getByRole('button', { name: '구간 처음으로' })
const repeatButton = (page: Page) =>
  player(page).getByRole('button', { name: '구간 반복' })
const muteButton = (page: Page) =>
  player(page).getByRole('button', { name: '음소거' })
const volume = (page: Page) =>
  player(page).getByRole('slider', { name: '볼륨' })
const elapsed = (page: Page) => player(page).getByTestId('elapsed')

async function openNewSection(page: Page, scenario?: string) {
  const query = new URLSearchParams({
    ...(scenario ? { scenario } : {}),
    view: 'new-section',
    song: 'song-neon-harbor',
  })
  await page.goto(`/tests/browser/harness.html?${query}`)
  await expect(form(page)).toBeVisible()
}

async function openWithAudio(page: Page, start: string, end: string) {
  await openNewSection(page)
  // Synthesis, decoding and peaks take a moment on a loaded machine.
  await expect(waveform(page)).toHaveAttribute('data-state', 'ready', {
    timeout: 15_000,
  })
  await fillRange(page, start, end)
}

async function fillRange(page: Page, start: string, end: string) {
  await startInput(page).fill(start)
  await startInput(page).press('Tab')
  await endInput(page).fill(end)
  await endInput(page).press('Tab')
}

// mm:ss.d → tenths of a second.
async function elapsedTenths(page: Page) {
  const text = (await elapsed(page).textContent()) ?? ''
  const [minutes, seconds] = text.split(':')
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 10)
}

const audioContexts = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioContexts())
const audioSources = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioSources())
const outputGain = (page: Page) =>
  page.evaluate(() => window.workspaceTest.outputGain())

test('the bar shows the section length and plays from its start', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await expect(player(page)).toContainText('/ 00:10.0')
  await expect(elapsed(page)).toHaveText('00:00.0')
  await expect(repeatButton(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await audioContexts(page)).toEqual([])

  await playButton(page).click()
  await expect(pauseButton(page)).toBeFocused()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(3)

  await pauseButton(page).click()
  await expect(playButton(page)).toBeVisible()
  const held = await elapsed(page).textContent()
  await page.waitForTimeout(400)
  await expect(elapsed(page)).toHaveText(held!)

  // Play resumes from the held position, not the start.
  const heldTenths = await elapsedTenths(page)
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(heldTenths)
  expect(await audioContexts(page)).toEqual(['running'])
})

test('the time updates without rendering the page', async ({ page }) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(1)

  const commits = await page.evaluate(() => window.workspaceTest.commits())
  const before = await elapsedTenths(page)
  await page.waitForTimeout(600)
  expect(await elapsedTenths(page)).toBeGreaterThan(before + 2)
  expect(await page.evaluate(() => window.workspaceTest.commits())).toBe(
    commits,
  )
})

test('repeat keeps playback inside a short section', async ({ page }) => {
  await openWithAudio(page, '00:10.0', '00:11.0')
  await playButton(page).click()

  // Sample the display for more than two passes of the one-second section.
  const samples = await page.evaluate(async () => {
    const element = document.querySelector('[data-testid="elapsed"]')!
    const seen: string[] = []
    const until = performance.now() + 2600
    while (performance.now() < until) {
      seen.push(element.textContent ?? '')
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    return seen
  })
  const tenths = samples.map((text) => Math.round(Number(text.slice(3)) * 10))
  expect(Math.max(...tenths)).toBeLessThanOrEqual(9)
  expect(tenths.some((value, index) => value < tenths[index - 1])).toBe(true)
  await expect(pauseButton(page)).toBeVisible()
})

test('a change inside the section moves the loop of the running sound', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:11.0')
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(await audioSources(page)).toEqual([
    { loop: true, loopStart: 10, loopEnd: 11 },
  ])

  await endInput(page).fill('00:11.5')
  await endInput(page).press('Tab')
  await expect
    .poll(() => audioSources(page))
    .toEqual([{ loop: true, loopStart: 10, loopEnd: 11.5 }])

  // Turning repeat off continues with a sound that plays once.
  await repeatButton(page).click()
  await expect
    .poll(async () => (await audioSources(page)).at(-1)?.loop)
    .toBe(false)
})

test('without repeat the section plays once and returns to its start', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:11.0')
  await repeatButton(page).click()
  await expect(repeatButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(player(page)).toContainText('선택 구간 한 번 재생')

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect(playButton(page)).toBeVisible({ timeout: 4000 })
  await expect(elapsed(page)).toHaveText('00:00.0')
})

test('going back to the start works while paused and while playing', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(4)
  await pauseButton(page).click()
  await restartButton(page).click()
  await expect(elapsed(page)).toHaveText('00:00.0')

  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(4)
  const before = await elapsedTenths(page)
  await restartButton(page).click()
  // A ten-second section cannot wrap around within the wait.
  await expect.poll(() => elapsedTenths(page)).toBeLessThan(before)
  await expect(pauseButton(page)).toBeVisible()
})

test('a new range takes over playback', async ({ page }) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(4)

  // The position falls outside the new range: playback starts it over.
  await startInput(page).fill('00:15.0')
  await startInput(page).press('Tab')
  await expect(player(page)).toContainText('/ 00:05.0')
  await expect
    .poll(async () => (await audioSources(page)).at(-1))
    .toEqual({ loop: true, loopStart: 15, loopEnd: 20 })
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(2)

  // Without a range there is nothing to play.
  await endInput(page).fill('')
  await endInput(page).press('Tab')
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(elapsed(page)).toHaveText('00:00.0')
})

test('the player waits for the audio', async ({ page }) => {
  await openNewSection(page, 'pending-audio')
  await fillRange(page, '00:10.0', '00:20.0')
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(restartButton(page)).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled keeps it focusable; a click does nothing.
  await playButton(page).click({ force: true })
  await expect(playButton(page)).toBeVisible()
  expect(await audioContexts(page)).toEqual([])
})

test('only the part the decoded audio covers plays', async ({ page }) => {
  // The song lists 04:12 but its audio decodes to 04:10.
  await openNewSection(page, 'short-audio')
  await expect(waveform(page)).toHaveAttribute('data-state', 'ready', {
    timeout: 15_000,
  })
  await fillRange(page, '04:11.0', '04:12.0')
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'true')

  await fillRange(page, '04:05.0', '04:12.0')
  await expect(player(page)).toContainText('/ 00:05.0')
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'false')
})

test('volume and mute are adjustable', async ({ page }) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await expect(volume(page)).toHaveValue('80')
  await expect(volume(page)).toHaveAttribute('aria-valuetext', '80%')
  await volume(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(volume(page)).toHaveValue('79')

  await muteButton(page).click()
  await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(volume(page)).toHaveAttribute('data-muted', 'true')

  // Moving the volume brings the sound back.
  await volume(page).focus()
  await page.keyboard.press('ArrowRight')
  await expect(volume(page)).toHaveValue('80')
  await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false')
})

test('the sound starts at the chosen volume and follows it', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await muteButton(page).click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(await outputGain(page)).toBe(0)

  await muteButton(page).click()
  await expect.poll(() => outputGain(page)).toBeCloseTo(0.8, 2)
  await volume(page).fill('30')
  await expect.poll(() => outputGain(page)).toBeCloseTo(0.3, 2)
})

test('keyboard focus in the form stays clear of the bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await openWithAudio(page, '00:10.0', '00:20.0')
  await page.evaluate(() => window.scrollTo(0, 0))
  await main(page).getByRole('button', { name: '파일 바꾸기' }).focus()

  let checked = 0
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press('Tab')
    const clearance = await player(page).evaluate((bar) => {
      const active = document.activeElement
      if (!active || !active.closest('form')) return null
      return (
        bar.getBoundingClientRect().top - active.getBoundingClientRect().bottom
      )
    })
    if (clearance === null) break
    expect(clearance).toBeGreaterThanOrEqual(0)
    checked += 1
  }
  expect(checked).toBeGreaterThan(5)
})

test('leaving the screen stops playback and closes the output', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(1)

  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(form(page)).toBeHidden()
  await expect.poll(() => audioContexts(page)).toEqual(['closed'])
})

test('the bar sits at the bottom and fits the main column', async ({
  page,
}) => {
  await openWithAudio(page, '00:10.0', '00:20.0')
  const viewport = page.viewportSize()!
  const box = (await player(page).boundingBox())!
  expect(Math.round(box.y + box.height)).toBe(viewport.height)

  // 720px keeps the narrow sidebar beside the main column.
  const sizes = [
    { width: 1024, volume: true, length: true },
    { width: 720, volume: true, length: true },
    { width: 390, volume: false, length: true },
    { width: 360, volume: false, length: true },
    { width: 320, volume: false, length: false },
  ]
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: 700 })
    const layout = await player(page).evaluate((bar) => {
      const visible = (element: Element) =>
        element.getBoundingClientRect().width > 0
      const controls = [...bar.querySelectorAll('button, input')].filter(
        visible,
      )
      const time = [...bar.querySelectorAll('p > span')].filter(visible)
      const mute = bar.querySelector('[aria-label="음소거"]')!
      const barBox = bar.getBoundingClientRect()
      return {
        pageOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        // Room left between the last control and the bar's edge.
        endRoom:
          barBox.right -
          Math.max(...controls.map((c) => c.getBoundingClientRect().right)),
        // Room between the time and the mute button.
        timeRoom:
          mute.getBoundingClientRect().left -
          Math.max(...time.map((t) => t.getBoundingClientRect().right)),
      }
    })
    expect(layout.pageOverflow, `${size.width}px`).toBe(0)
    expect(layout.endRoom, `${size.width}px`).toBeGreaterThanOrEqual(15.5)
    expect(layout.timeRoom, `${size.width}px`).toBeGreaterThan(0)
    await expect(playButton(page)).toBeInViewport()
    if (size.volume) await expect(volume(page)).toBeVisible()
    else await expect(volume(page)).toBeHidden()
    const length = player(page).getByText('/ 00:10.0')
    if (size.length) await expect(length).toBeVisible()
    else await expect(length).toBeHidden()
  }
})
