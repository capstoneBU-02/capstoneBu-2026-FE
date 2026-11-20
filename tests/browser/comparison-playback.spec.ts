import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'
import type {} from './harness/recording.ts'

// A status is asked for every 2.5 seconds, and both sounds decode after it.
const RESULT_TIMEOUT = { timeout: 20_000 }

test.describe.configure({ timeout: 90_000 })

const SECTION_START = 42.1
const SECTION_SECONDS = 23.7

const bar = (page: Page) => page.getByRole('region', { name: '구간 재생' })
const sound = (page: Page, name: string) =>
  bar(page).getByRole('radio', { name, exact: true })
const playButton = (page: Page) =>
  bar(page).getByRole('button', { name: '재생', exact: true })
const pauseButton = (page: Page) =>
  bar(page).getByRole('button', { name: '일시정지', exact: true })
const regionButton = (page: Page, number: number) =>
  page
    .getByRole('region', { name: '다시 들어볼 곳' })
    .getByRole('button', { name: new RegExp(`^${number}번 구간`) })
const position = (page: Page) =>
  page
    .getByRole('region', { name: '구간 타임라인' })
    .getByRole('slider', { name: '재생 위치' })

// The file behind the sound that started last. A take lasts as long as asked;
// the original is the whole song.
const lastSourceSeconds = (page: Page) =>
  page.evaluate(() => window.workspaceTest.sourceDurations().at(-1) ?? 0)
const lastOffset = (page: Page) =>
  page.evaluate(() => window.workspaceTest.sourceOffsets().at(-1) ?? 0)
const lastSource = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioSources().at(-1))
const sourceCount = (page: Page) =>
  page.evaluate(() => window.workspaceTest.sourceDurations().length)

// The take lasts as long as the section; the original is the whole song.
const isTake = (seconds: number) => Math.abs(seconds - SECTION_SECONDS) < 0.5

// Which sound each source started since `from` played.
const soundsSince = (page: Page, from: number) =>
  page.evaluate(
    ([from, section]) =>
      window.workspaceTest
        .sourceDurations()
        .slice(from)
        .map((seconds) =>
          Math.abs(seconds - section) < 0.5 ? 'take' : 'baseline',
        ),
    [from, SECTION_SECONDS] as const,
  )

// Each source started since `from`, with how far into the section it began,
// read at once. Only those begun before `until` count: a turn lasts four
// seconds, and a slow machine may reach the next one before the test reads.
const startsBefore = (page: Page, from: number, until: number) =>
  page.evaluate(
    ([from, until, section, songStart]) => {
      const offsets = window.workspaceTest.sourceOffsets()
      return window.workspaceTest
        .sourceDurations()
        .map((seconds, index) => {
          const take = Math.abs(seconds - section) < 0.5
          const offset = offsets[index] ?? 0
          return {
            sound: take ? 'take' : 'baseline',
            at: take ? offset : offset - songStart,
          }
        })
        .slice(from)
        .filter(({ at }) => at < until)
    },
    [from, until, SECTION_SECONDS, SECTION_START] as const,
  )

// Tenths after the start of what plays, stepped with the slider's keys.
async function seekWithKeys(page: Page, tenths: number) {
  await position(page).press('Home')
  for (let step = 0; step < Math.floor(tenths / 10); step += 1)
    await position(page).press('Shift+ArrowRight')
  for (let step = 0; step < tenths % 10; step += 1)
    await position(page).press('ArrowRight')
}

async function elapsedTenths(page: Page) {
  const text = (await bar(page).getByTestId('elapsed').textContent()) ?? ''
  const [minutes, seconds] = text.split(':')
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 10)
}

async function openResult(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-seed=compared${query}`,
  )
  await page.getByRole('tab', { name: /^비교/ }).click()
  await expect(page.getByRole('region', { name: '구간 타임라인' })).toBeVisible(
    RESULT_TIMEOUT,
  )
}

async function openListening(page: Page, query = '') {
  await openResult(page, query)
  await expect(sound(page, '번갈아')).toBeEnabled(RESULT_TIMEOUT)
}

test('a result opens on the take with every sound to choose', async ({
  page,
}) => {
  await openListening(page)
  await expect(sound(page, '내 연주')).toBeChecked()
  await expect(sound(page, '원곡')).toBeEnabled()

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(await lastSourceSeconds(page)).toBeCloseTo(SECTION_SECONDS, 0)
})

test('both lanes draw their sound', async ({ page }) => {
  await openListening(page)
  for (const lane of ['baseline', 'performance']) {
    const painted = await page
      .locator(`[data-lane="${lane}"] canvas`)
      .evaluate((canvas: HTMLCanvasElement) => {
        const { width, height } = canvas
        const pixels = canvas
          .getContext('2d')
          ?.getImageData(0, 0, width, height)
        return pixels?.data.some((value) => value !== 0) ?? false
      })
    expect(painted).toBe(true)
  }
})

test('switching sounds keeps the place in the music', async ({ page }) => {
  // Nearly twice as long as the section, so a place sits nearly twice as far in.
  await openListening(page, '&comparison-take-seconds=47')
  await regionButton(page, 1).click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  // 3.15 seconds into the section, the first place less its lead-in.
  const inTake = await lastOffset(page)
  expect(inTake).toBeGreaterThanOrEqual(6.2)
  expect(inTake).toBeLessThan(6.5)

  await sound(page, '원곡').click()
  await expect
    .poll(() => lastSourceSeconds(page))
    .toBeGreaterThan(SECTION_SECONDS * 2)
  const inSong = (await lastOffset(page)) - SECTION_START
  expect(inSong).toBeGreaterThanOrEqual(3.1)
  expect(inSong).toBeLessThan(5.6)
})

test('choosing a place plays around it and letting go plays the section', async ({
  page,
}) => {
  await openListening(page)
  await regionButton(page, 1).click()
  await expect(bar(page).getByText('/ 00:02.4')).toBeVisible()

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const source = await lastSource(page)
  expect(source?.loop).toBe(true)
  expect(source?.loopStart).toBeCloseTo(3.1, 5)
  expect(source?.loopEnd).toBeCloseTo(5.6, 5)

  await regionButton(page, 1).click()
  await expect(
    bar(page).getByText(`/ 00:${SECTION_SECONDS.toFixed(1)}`),
  ).toBeVisible()
})

test('번갈아 changes the sound on every pass of a chosen place', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await regionButton(page, 1).click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  expect(isTake(await lastSourceSeconds(page))).toBe(false)
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(true)
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(false)
})

test('번갈아 changes the sound every four seconds of the section', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  expect(isTake(await lastSourceSeconds(page))).toBe(false)
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(true)
})

for (const from of ['내 연주', '원곡']) {
  test(`choosing 번갈아 from ${from} plays the sound whose turn it is at the place`, async ({
    page,
  }) => {
    await openListening(page)
    await sound(page, from).click()
    // 6 seconds in is the take's turn.
    await seekWithKeys(page, 60)
    await sound(page, '번갈아').click()
    const sources = await sourceCount(page)

    await playButton(page).click()
    await expect(pauseButton(page)).toBeVisible()
    const starts = await startsBefore(page, sources, 7.5)
    expect(starts.map(({ sound }) => sound)).toEqual(['take'])
    expect(starts[0]?.at).toBeCloseTo(6, 1)
  })
}

test('a seek in 번갈아 while paused plays the sound whose turn it is there', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await seekWithKeys(page, 60)
  const from = await sourceCount(page)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const starts = await startsBefore(page, from, 7.5)
  expect(starts.map(({ sound }) => sound)).toEqual(['take'])
  expect(starts[0]?.at).toBeCloseTo(6, 1)
})

test('a seek onto the edge of a turn in 번갈아 plays that turn alone', async ({
  page,
}) => {
  // With a take this long, 4 seconds read back from its clock comes out a
  // rounding error short of the edge.
  await openListening(page, '&comparison-take-seconds=24')
  await sound(page, '번갈아').click()
  await seekWithKeys(page, 40)
  const from = await sourceCount(page)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  // Long enough for a wrong turn to have been taken and put back.
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThanOrEqual(45)
  expect(
    (await startsBefore(page, from, 7.5)).map(({ sound }) => sound),
  ).toEqual(['take'])
})

test('going back to the start in 번갈아 plays the first turn', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await playButton(page).click()
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(true)
  await pauseButton(page).click()
  await bar(page).getByRole('button', { name: '구간 처음으로' }).click()
  const from = await sourceCount(page)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(
    (await startsBefore(page, from, 3.5)).map(({ sound }) => sound),
  ).toEqual(['baseline'])
})

test('letting go of a place in 번갈아 plays the turn of the section there', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await regionButton(page, 1).click()
  // 1.4 seconds into the place, 3.1 s, is 4.5 s into the section: the take's.
  await seekWithKeys(page, 14)
  await regionButton(page, 1).click()
  await expect(
    bar(page).getByText(`/ 00:${SECTION_SECONDS.toFixed(1)}`),
  ).toBeVisible()
  const from = await sourceCount(page)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(
    (await startsBefore(page, from, 7.5)).map(({ sound }) => sound),
  ).toEqual(['take'])
})

test('번갈아 gives the next play of a place to the other sound', async ({
  page,
}) => {
  await openListening(page)
  await sound(page, '번갈아').click()
  await regionButton(page, 1).click()
  await bar(page).getByRole('button', { name: '구간 반복' }).click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(isTake(await lastSourceSeconds(page))).toBe(false)
  // The place plays once and stops.
  await expect(playButton(page)).toBeVisible(RESULT_TIMEOUT)
  const from = await sourceCount(page)

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(await soundsSince(page, from)).toEqual(['take'])
})

test('번갈아 keeps changing the sound while the page is hidden', async ({
  page,
}) => {
  // A hidden page gets no animation frames, but its sound plays on.
  await page.addInitScript(() => {
    let hidden = false
    const frame = window.requestAnimationFrame.bind(window)
    Object.defineProperty(document, 'hidden', { get: () => hidden })
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    window.requestAnimationFrame = (callback) => (hidden ? 0 : frame(callback))
    Object.assign(window, {
      hidePage() {
        hidden = true
        document.dispatchEvent(new Event('visibilitychange'))
      },
    })
  })
  await openListening(page)
  await sound(page, '번갈아').click()
  await regionButton(page, 1).click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(isTake(await lastSourceSeconds(page))).toBe(false)

  await page.evaluate(() =>
    (window as unknown as { hidePage(): void }).hidePage(),
  )
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(true)
  await expect
    .poll(async () => isTake(await lastSourceSeconds(page)), RESULT_TIMEOUT)
    .toBe(false)
})

test('a sound that cannot play leaves the others to choose', async ({
  page,
}) => {
  await openResult(page, '&comparison-partial=1')
  await expect(sound(page, '내 연주')).toBeEnabled(RESULT_TIMEOUT)
  await expect(sound(page, '내 연주')).toBeChecked()
  await expect(sound(page, '원곡')).toBeDisabled()
  await expect(sound(page, '번갈아')).toBeDisabled()
})

test('a take that failed to load can be loaded again', async ({ page }) => {
  await openResult(page, '&comparison-take-audio=fails-once')
  const retry = page.getByRole('button', { name: '다시 불러오기' })
  await expect(retry).toBeVisible(RESULT_TIMEOUT)
  await expect(sound(page, '원곡')).toBeChecked(RESULT_TIMEOUT)
  await expect(sound(page, '내 연주')).toBeDisabled()

  await retry.click()
  await expect(sound(page, '내 연주')).toBeEnabled(RESULT_TIMEOUT)
  await expect(retry).toBeHidden()
})

test('loading a failed take again keeps the sound being heard', async ({
  page,
}) => {
  await openResult(page, '&comparison-take-audio=fails-then-slow')
  const retry = page.getByRole('button', { name: '다시 불러오기' })
  await expect(retry).toBeVisible(RESULT_TIMEOUT)
  await expect(sound(page, '원곡')).toBeChecked(RESULT_TIMEOUT)

  await retry.click()
  await expect(sound(page, '원곡')).toBeChecked({ timeout: 500 })
  await expect(sound(page, '내 연주')).toBeEnabled(RESULT_TIMEOUT)
})

test('a take that loads again takes over at the same place in the music', async ({
  page,
}) => {
  // Nearly twice as long as the section, so a place sits nearly twice as far in.
  await openResult(
    page,
    '&comparison-take-seconds=47&comparison-take-audio=fails-then-slow',
  )
  const retry = page.getByRole('button', { name: '다시 불러오기' })
  await expect(retry).toBeVisible(RESULT_TIMEOUT)
  await expect(sound(page, '원곡')).toBeChecked(RESULT_TIMEOUT)
  await playButton(page).click()
  await expect.poll(() => elapsedTenths(page)).toBeGreaterThan(30)
  await pauseButton(page).click()
  const held = await elapsedTenths(page)

  await retry.click()
  await expect(sound(page, '내 연주')).toBeChecked(RESULT_TIMEOUT)
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  expect(await lastSourceSeconds(page)).toBeCloseTo(47, 0)
  expect(await lastOffset(page)).toBeCloseTo(
    (held / 10) * (47 / SECTION_SECONDS),
    0,
  )
})

test('a take from an earlier section plays the range it was played on', async ({
  page,
}) => {
  await openListening(page, '&comparison-seed-range=30,45')
  await expect(bar(page)).toContainText('/ 00:15.0')

  await sound(page, '원곡').click()
  await expect(bar(page)).toContainText('/ 00:15.0')
})

test('leaving the comparison stops its sound and gives the bar back', async ({
  page,
}) => {
  await openListening(page)
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  await page.getByRole('tab', { name: '타브', exact: true }).click()
  await expect(sound(page, '번갈아')).toHaveCount(0)
  await expect(playButton(page)).toBeVisible()
})

test('recording over a result gives the bar to the section until it stops', async ({
  page,
}) => {
  await openListening(page)
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  await page
    .locator('#workspace-content')
    .getByRole('button', { name: '다시 녹음', exact: true })
    .click()
  const panel = page.getByRole('region', { name: '벌스 1 녹음', exact: true })
  await panel.getByRole('button', { name: '녹음 시작', exact: true }).click()
  await expect(panel.getByText('녹음 중', { exact: true })).toBeVisible()
  await expect(sound(page, '번갈아')).toHaveCount(0)
  await expect(pauseButton(page)).toBeVisible()

  await panel.getByRole('button', { name: '정지', exact: true }).click()
  await expect(sound(page, '번갈아')).toBeVisible()
  await expect(playButton(page)).toBeVisible()
})

test('recording plays the section once along with the take', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1',
  )
  // The original holds the whole song, so the section starts inside the file.
  await sound(page, '원곡').click()
  await expect(playButton(page)).toHaveAttribute(
    'aria-disabled',
    'false',
    RESULT_TIMEOUT,
  )
  await page
    .locator('#workspace-content')
    .getByRole('button', { name: '녹음', exact: true })
    .click()
  const panel = page.getByRole('region', { name: '벌스 1 녹음', exact: true })
  await panel.getByRole('button', { name: '녹음 시작', exact: true }).click()
  await expect(panel.getByText('녹음 중', { exact: true })).toBeVisible()

  await expect(pauseButton(page)).toBeVisible()
  const source = await lastSource(page)
  expect(source?.loop).toBe(false)
  expect(await lastOffset(page)).toBeCloseTo(SECTION_START, 1)

  await panel.getByRole('button', { name: '정지', exact: true }).click()
  await expect(playButton(page)).toBeVisible()
  await expect(
    bar(page).getByRole('button', { name: '구간 반복' }),
  ).toHaveAttribute('aria-pressed', 'true')
})
