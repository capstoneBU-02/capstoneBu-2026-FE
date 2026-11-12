import { expect, test, type Locator, type Page } from '@playwright/test'
import type {} from './harness.tsx'

// neon_harbor_live in the fixture: 04:12, with 벌스 1 and 솔로.
const SONG_SECONDS = 252

const main = (page: Page) => page.locator('#workspace-content')
const form = (page: Page) => main(page).getByRole('form', { name: '새 구간' })
const startInput = (page: Page) =>
  form(page).getByLabel('시작', { exact: true })
const endInput = (page: Page) => form(page).getByLabel('끝', { exact: true })
const waveform = (page: Page) =>
  form(page).getByRole('group', { name: '구간 파형' })
const startHandle = (page: Page) =>
  waveform(page).getByRole('slider', { name: '구간 시작' })
const endHandle = (page: Page) =>
  waveform(page).getByRole('slider', { name: '구간 끝' })
const overview = (page: Page) => waveform(page).getByTestId('overview-track')
const zoom = (page: Page) => waveform(page).getByTestId('zoom-track')

const TOO_LONG = '구간은 30초까지 정할 수 있어요. 범위를 줄여 주세요.'
const DECODE_FAILED =
  '파형을 불러오지 못했어요. 시작과 끝 시간은 직접 입력할 수 있어요.'

async function openNewSection(page: Page, scenario?: string) {
  const query = new URLSearchParams({
    ...(scenario ? { scenario } : {}),
    view: 'new-section',
    song: 'song-neon-harbor',
  })
  await page.goto(`/tests/browser/harness.html?${query}`)
  await expect(form(page)).toBeVisible()
}

async function waitForWaveform(page: Page) {
  // Synthesis, decoding and peaks take a moment on a loaded machine.
  await expect(waveform(page)).toHaveAttribute('data-state', 'ready', {
    timeout: 15_000,
  })
}

async function fillRange(page: Page, start: string, end: string) {
  await startInput(page).fill(start)
  await startInput(page).press('Tab')
  await endInput(page).fill(end)
  await endInput(page).press('Tab')
}

function seconds(text: string) {
  const [minutes, rest] = text.split(':')
  return Number(minutes) * 60 + Number(rest)
}

function tenths(text: string) {
  const [minutes, rest] = text.split(':')
  return Number(minutes) * 600 + Math.round(Number(rest) * 10)
}

async function inputSeconds(page: Page) {
  return {
    start: seconds(await startInput(page).inputValue()),
    end: seconds(await endInput(page).inputValue()),
  }
}

// The sliders and the inputs must always describe the same range.
async function expectInSync(page: Page) {
  await expect(startHandle(page)).toHaveAttribute(
    'aria-valuenow',
    String(tenths(await startInput(page).inputValue()) / 10),
  )
  await expect(endHandle(page)).toHaveAttribute(
    'aria-valuenow',
    String(tenths(await endInput(page).inputValue()) / 10),
  )
}

async function trackPoint(track: Locator, ratio: number) {
  const box = (await track.boundingBox())!
  return { x: box.x + box.width * ratio, y: box.y + box.height / 2 }
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

// Pointer moves may render just after the release; wait for the range.
async function expectRangeNear(
  page: Page,
  expected: { start: number; end: number },
  tolerance = 0.4,
) {
  await expect
    .poll(async () => {
      const range = await inputSeconds(page)
      return [range.start - expected.start, range.end - expected.end].every(
        (difference) => Math.abs(difference) <= tolerance,
      )
    }, `range near ${expected.start}–${expected.end}`)
    .toBe(true)
  return inputSeconds(page)
}

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('the waveform shows the song, its sections and the typed range', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)

  for (const label of ['00:00', '00:30', '02:00', '04:00'])
    await expect(overview(page).getByText(label, { exact: true })).toBeVisible()
  for (const section of ['벌스 1', '솔로'])
    await expect(overview(page).getByText(section)).toBeVisible()
  // The decoded audio is drawn, not just an empty frame.
  expect(
    await overview(page)
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d')!
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
        return data.some((value, index) => index % 4 === 3 && value > 0)
      }),
  ).toBe(true)

  await expect(startHandle(page)).toHaveCount(0)
  await expect(
    waveform(page).getByText('구간을 고르면 여기서 자세히 조정할 수 있어요.'),
  ).toBeVisible()

  await fillRange(page, '00:42.1', '01:05.8')
  await expectInSync(page)
  await expect(startHandle(page)).toHaveAttribute('aria-valuenow', '42.1')
  await expect(startHandle(page)).toHaveAttribute('aria-valuetext', '42.1초')
  await expect(endHandle(page)).toHaveAttribute('aria-valuetext', '1분 5.8초')
  await expect(startHandle(page)).toHaveAttribute('aria-valuemin', '0')
  await expect(startHandle(page)).toHaveAttribute('aria-valuemax', '65.7')
  await expect(endHandle(page)).toHaveAttribute('aria-valuemin', '42.2')
  await expect(endHandle(page)).toHaveAttribute('aria-valuemax', '252')
  await expect(overview(page).getByText('인트로 1')).toBeVisible()
  // 39.6–68.3 s around the range; whole-ten labels show at any common step.
  for (const label of ['00:40', '00:50', '01:00'])
    await expect(zoom(page).getByText(label, { exact: true })).toBeVisible()
})

test('keys move the handles and the time inputs follow', async ({ page }) => {
  await openNewSection(page)
  await waitForWaveform(page)
  await fillRange(page, '00:42.1', '01:05.8')

  await startHandle(page).focus()
  await page.keyboard.press('ArrowRight')
  await expect(startInput(page)).toHaveValue('00:42.2')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(startInput(page)).toHaveValue('00:41.2')
  await page.keyboard.press('PageUp')
  await expect(startInput(page)).toHaveValue('00:46.2')
  await expect(startHandle(page)).toBeFocused()
  await expectInSync(page)

  await endHandle(page).focus()
  await page.keyboard.press('PageDown')
  await expect(endInput(page)).toHaveValue('01:00.8')
  await page.keyboard.press('End')
  await expect(endInput(page)).toHaveValue('04:12.0')
  await expect(form(page).getByText(TOO_LONG)).toBeVisible()
  await expect(startHandle(page)).toHaveAttribute('aria-valuemax', '251.9')
  await page.keyboard.press('Home')
  await expect(endInput(page)).toHaveValue('00:46.3')
  await expect(form(page).getByText(TOO_LONG)).toHaveCount(0)
  await expectInSync(page)
})

test('dragging on the overview selects, resizes and moves the range', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)
  const at = (time: number) => trackPoint(overview(page), time / SONG_SECONDS)

  await drag(page, await at(100), await at(110))
  let range = await expectRangeNear(page, { start: 100, end: 110 })
  await expectInSync(page)

  // Grabbing the end line and dropping it at 2:00.
  await drag(page, await at(range.end), await at(120))
  const resized = await expectRangeNear(page, { start: range.start, end: 120 })
  expect(resized.start).toBe(range.start)
  await expect(endHandle(page)).toBeFocused()

  // Inside the selection, away from the handles, a drag moves it whole.
  const middle = (resized.start + resized.end) / 2
  await drag(page, await at(middle), await at(middle + 30))
  range = await expectRangeNear(page, {
    start: resized.start + 30,
    end: resized.end + 30,
  })
  expect(range.end - range.start).toBeCloseTo(resized.end - resized.start, 5)
  await expectInSync(page)

  // A click without a drag keeps the range.
  const before = await inputSeconds(page)
  const point = await at(200)
  await page.mouse.click(point.x, point.y)
  expect(await inputSeconds(page)).toEqual(before)
})

test('a handle moves from where it was grabbed', async ({ page }) => {
  await openNewSection(page)
  await waitForWaveform(page)
  const at = (time: number) => trackPoint(overview(page), time / SONG_SECONDS)
  const secondsPerPixel =
    SONG_SECONDS / (await overview(page).boundingBox())!.width

  // Pressed 4 px off the start line and moved 1 px, the line moves 1 px.
  await fillRange(page, '00:42.1', '01:05.8')
  const line = await at(42.1)
  await drag(page, { x: line.x + 4, y: line.y }, { x: line.x + 5, y: line.y })
  await expectRangeNear(
    page,
    { start: 42.1 + secondsPerPixel, end: 65.8 },
    0.15,
  )
})

test('a short range moves from inside and resizes from just outside', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)
  const at = (time: number) => trackPoint(overview(page), time / SONG_SECONDS)
  const secondsPerPixel =
    SONG_SECONDS / (await overview(page).boundingBox())!.width

  // A 1 s range is a few px wide, inside both handles' reach. A press on it
  // moves it whole.
  await fillRange(page, '01:40.0', '01:41.0')
  const middle = await at(100.5)
  await drag(page, middle, { x: middle.x + 30, y: middle.y })
  const moved = await expectRangeNear(page, {
    start: 100 + 30 * secondsPerPixel,
    end: 101 + 30 * secondsPerPixel,
  })
  expect(moved.end - moved.start).toBeCloseTo(1, 5)
  await expectInSync(page)

  // Its handles are taken from outside: a press next to the start line takes
  // the start, though the end handle reaches over it too.
  await fillRange(page, '01:40.0', '01:41.0')
  const start = await at(100)
  await drag(
    page,
    { x: start.x - 2, y: start.y },
    { x: start.x - 32, y: start.y },
  )
  await expectRangeNear(page, { start: 100 - 30 * secondsPerPixel, end: 101 })
  await expect(endInput(page)).toHaveValue('01:41.0')
})

test('while submitting, the selection no longer offers a drag', async ({
  page,
}) => {
  await openNewSection(page, 'pending-create')
  await waitForWaveform(page)
  await fillRange(page, '00:42.1', '01:05.8')
  const middle = await trackPoint(overview(page), 54 / SONG_SECONDS)
  const cursorAt = () =>
    page.evaluate(
      ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
      middle,
    )
  await expect.poll(cursorAt).toBe('grab')

  await main(page).getByRole('button', { name: '타브 만들기' }).focus()
  await page.keyboard.press('Enter')
  await expect(overview(page).locator('[data-disabled="true"]')).toHaveCount(1)
  await expect.poll(cursorAt).not.toBe('grab')
})

test('a second finger on the waveform does not take over a drag', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)
  const at = (time: number) => trackPoint(overview(page), time / SONG_SECONDS)
  const from = await at(100)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const middle = await at(110)
  await page.mouse.move(middle.x, middle.y, { steps: 4 })

  const other = await at(200)
  const finger = {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: false,
    clientX: other.x,
    clientY: other.y,
  }
  const canvas = overview(page).locator('canvas')
  await canvas.dispatchEvent('pointermove', finger)
  await canvas.dispatchEvent('pointerup', finger)

  const to = await at(115)
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
  await expectRangeNear(page, { start: 100, end: 115 })
})

test('the zoom fine-tunes a handle inside the selection area', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)
  await fillRange(page, '00:42.1', '01:05.8')

  const handle = zoom(page).locator('[data-handle="end"]')
  const from = await center(handle)
  const zoomBox = (await zoom(page).boundingBox())!
  // The zoom spans 39.6–68.3 s, so 40 px is about a second.
  const secondsPerPixel = 28.7 / zoomBox.width
  await drag(page, from, { x: from.x - 40, y: from.y })

  const range = await expectRangeNear(
    page,
    { start: 42.1, end: 65.8 - 40 * secondsPerPixel },
    0.15,
  )
  expect(range.start).toBe(42.1)
  await expectInSync(page)
  // The zoom handles are for the pointer; the overview sliders take keys.
  await expect(handle).not.toHaveAttribute('tabindex', '0')
})

test('a song that cannot be decoded still takes typed times', async ({
  page,
}) => {
  await openNewSection(page, 'audio-error')
  await expect(waveform(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 15_000,
  })
  await expect(waveform(page).getByText(DECODE_FAILED)).toBeVisible()

  const callCount = () =>
    page.evaluate(() => window.workspaceTest.audioCalls().length)
  const before = await callCount()
  const retry = waveform(page).getByRole('button', { name: '다시 시도' })
  await retry.click()
  await expect.poll(callCount).toBeGreaterThan(before)
  await expect(waveform(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 15_000,
  })
  // The button stays in place while retrying, so focus is not lost.
  await expect(retry).toBeFocused()

  await fillRange(page, '00:42.1', '01:05.8')
  await main(page).getByRole('button', { name: '타브 만들기' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/view=task&task=task-created-1$/)
})

test('a retry that loads the waveform keeps focus on it', async ({ page }) => {
  await openNewSection(page, 'audio-error')
  await expect(waveform(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 15_000,
  })
  await page.evaluate(() => window.workspaceTest.healAudio())
  const retry = waveform(page).getByRole('button', { name: '다시 시도' })
  await retry.click()
  await waitForWaveform(page)
  await expect(retry).toHaveCount(0)
  await expect(waveform(page)).toBeFocused()
  await expect(startHandle(page)).toHaveCount(0)
})

test('a retry from the keyboard shows where focus went', async ({ page }) => {
  await openNewSection(page, 'audio-error')
  await expect(waveform(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 15_000,
  })
  await page.evaluate(() => window.workspaceTest.healAudio())
  await waveform(page).getByRole('button', { name: '다시 시도' }).focus()
  await page.keyboard.press('Enter')
  await waitForWaveform(page)
  await expect(waveform(page)).toBeFocused()
  expect(
    await waveform(page).evaluate(
      (element) =>
        element.matches(':focus-visible') &&
        getComputedStyle(element).outlineStyle,
    ),
  ).toBe('solid')
})

test('leaving the screen cancels loading the audio', async ({ page }) => {
  await openNewSection(page, 'pending-audio')
  await expect(waveform(page)).toHaveAttribute('data-state', 'loading')
  await expect(
    waveform(page).getByText('파형을 불러오고 있어요.'),
  ).toBeVisible()
  const audioCalls = () =>
    page.evaluate(() => window.workspaceTest.audioCalls())
  expect((await audioCalls()).at(-1)).toEqual({
    songId: 'song-neon-harbor',
    aborted: false,
  })

  await main(page).getByRole('button', { name: '취소' }).click()
  await expect(form(page)).toHaveCount(0)
  expect((await audioCalls()).every((call) => call.aborted)).toBe(true)
})

test('an expired session while loading the audio ends the workspace', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=audio-expired&view=new-section&song=song-neon-harbor',
  )
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(form(page)).toHaveCount(0)
})

test('a typed range turns red only once the length message shows', async ({
  page,
}) => {
  await openNewSection(page)
  await waitForWaveform(page)
  const selection = overview(page).locator('[data-over]').first()

  await startInput(page).fill('00:10.0')
  await startInput(page).press('Tab')
  await endInput(page).fill('00:50.0')
  // The end is still being typed, so neither the message nor the red shows.
  await expect(selection).toHaveAttribute('data-over', 'false')
  await expect(form(page).getByText(TOO_LONG)).toHaveCount(0)

  await endInput(page).press('Tab')
  await expect(form(page).getByText(TOO_LONG)).toBeVisible()
  await expect(selection).toHaveAttribute('data-over', 'true')
})

test('a drag the browser cancels puts the range back', async ({ page }) => {
  await openNewSection(page)
  await waitForWaveform(page)
  await fillRange(page, '01:40.0', '01:50.0')
  const at = (time: number) => trackPoint(overview(page), time / SONG_SECONDS)

  const from = await at(105)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const to = await at(130)
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await expectRangeNear(page, { start: 125, end: 135 })

  // Chrome gives the mouse pointer id 1.
  await overview(page).locator('canvas').dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  })
  await expect(startInput(page)).toHaveValue('01:40.0')
  await expect(endInput(page)).toHaveValue('01:50.0')
  await page.mouse.up()
  await expect(startInput(page)).toHaveValue('01:40.0')
})

test.describe('on a touch screen', () => {
  test.use({
    viewport: { width: 390, height: 500 },
    hasTouch: true,
    isMobile: true,
  })

  type Point = { x: number; y: number }
  const canvas = (page: Page) => overview(page).locator('canvas')

  // The same step on every move.
  const steady = (step: Point, steps = 12): Point[] =>
    Array.from({ length: steps }, (_, index) => ({
      x: step.x * (index + 1),
      y: step.y * (index + 1),
    }))

  // Real touch input, so the browser decides whether the page scrolls. Each
  // offset is measured from where the finger went down.
  async function swipe(page: Page, from: Point, offsets: Point[]) {
    const client = await page.context().newCDPSession(page)
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      point?: Point,
    ) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [point] : [],
      })
    await touch('touchStart', from)
    for (const offset of offsets) {
      await touch('touchMove', { x: from.x + offset.x, y: from.y + offset.y })
      await page.waitForTimeout(16)
    }
    await touch('touchEnd')
  }

  async function openOnTouch(page: Page) {
    await openNewSection(page)
    await waitForWaveform(page)
  }

  async function scrollY(page: Page) {
    return page.evaluate(() => window.scrollY)
  }

  const at = (page: Page, time: number) =>
    trackPoint(canvas(page), time / SONG_SECONDS)

  test('a finger scrolling over the waveform keeps the range', async ({
    page,
  }) => {
    await openOnTouch(page)
    await fillRange(page, '01:40.0', '01:50.0')
    await canvas(page).scrollIntoViewIfNeeded()
    const before = await scrollY(page)

    // About 18° off vertical: a little sideways on every step.
    await swipe(page, await at(page, 30), steady({ x: 2, y: -6 }))

    await expect.poll(() => scrollY(page)).toBeGreaterThan(before)
    await expect(startInput(page)).toHaveValue('01:40.0')
    await expect(endInput(page)).toHaveValue('01:50.0')
  })

  test('a finger scrolling over an empty waveform leaves no range', async ({
    page,
  }) => {
    await openOnTouch(page)
    await canvas(page).scrollIntoViewIfNeeded()
    const before = await scrollY(page)

    await swipe(page, await at(page, 30), steady({ x: 2, y: -6 }))

    await expect.poll(() => scrollY(page)).toBeGreaterThan(before)
    await expect(startInput(page)).toHaveValue('')
    await expect(endInput(page)).toHaveValue('')
  })

  test('a sideways finger still selects a range', async ({ page }) => {
    await openOnTouch(page)
    await canvas(page).scrollIntoViewIfNeeded()
    const secondsPerPixel =
      SONG_SECONDS / (await canvas(page).boundingBox())!.width

    await swipe(page, await at(page, 100), steady({ x: 3, y: 0 }))

    await expectRangeNear(
      page,
      { start: 100, end: 100 + 36 * secondsPerPixel },
      1,
    )
    await expectInSync(page)
  })

  test('a finger that wobbles up before heading sideways selects a range', async ({
    page,
  }) => {
    await openOnTouch(page)
    await fillRange(page, '01:40.0', '01:50.0')
    await canvas(page).scrollIntoViewIfNeeded()
    const before = await scrollY(page)
    const secondsPerPixel =
      SONG_SECONDS / (await canvas(page).boundingBox())!.width

    // Up a little first, then clearly sideways for 49 px.
    await swipe(page, await at(page, 30), [
      { x: 1, y: -3 },
      ...steady({ x: 6, y: -1 }, 8).map(({ x, y }) => ({
        x: x + 1,
        y: y - 3,
      })),
    ])

    await expectRangeNear(
      page,
      { start: 30, end: 30 + 49 * secondsPerPixel },
      1,
    )
    await expectInSync(page)
    expect(await scrollY(page)).toBe(before)
  })

  test('a finger moves a short range from inside', async ({ page }) => {
    await openOnTouch(page)
    // 7 s is about 10 px here, narrower than the handles' reach.
    await fillRange(page, '01:40.0', '01:47.0')
    await canvas(page).scrollIntoViewIfNeeded()
    const secondsPerPixel =
      SONG_SECONDS / (await canvas(page).boundingBox())!.width
    await swipe(page, await at(page, 103.5), steady({ x: 3, y: 0 }, 10))

    const moved = await expectRangeNear(
      page,
      { start: 100 + 30 * secondsPerPixel, end: 107 + 30 * secondsPerPixel },
      1,
    )
    expect(moved.end - moved.start).toBeCloseTo(7, 5)
    await expectInSync(page)
  })

  test('a finger resting on a handle leaves it in place', async ({ page }) => {
    await openOnTouch(page)
    await fillRange(page, '01:00.0', '01:30.0')
    await canvas(page).scrollIntoViewIfNeeded()
    const secondsPerPixel =
      SONG_SECONDS / (await canvas(page).boundingBox())!.width
    const end = await at(page, 90)
    const grip = { x: end.x + 8, y: end.y }

    // A tap wobbles 2–3 px, about two seconds here.
    await swipe(page, grip, [
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ])
    await expect(endHandle(page)).toBeFocused()
    await expect(endInput(page)).toHaveValue('01:30.0')

    // A clear move still takes the handle along from where it was grabbed.
    await swipe(page, grip, steady({ x: 2, y: 0 }, 10))
    await expectRangeNear(
      page,
      { start: 60, end: 90 + 20 * secondsPerPixel },
      1,
    )
    await expect(startInput(page)).toHaveValue('01:00.0')
  })

  test('a finger that turns to scroll after a sideways start keeps the range', async ({
    page,
  }) => {
    await openOnTouch(page)
    await fillRange(page, '01:40.0', '01:50.0')
    await canvas(page).scrollIntoViewIfNeeded()
    const before = await scrollY(page)

    // Sideways for a moment, so the drag starts, then up the page.
    await swipe(page, await at(page, 30), [
      { x: 4, y: -1 },
      ...steady({ x: 1, y: -6 }, 10).map(({ x, y }) => ({
        x: x + 4,
        y: y - 1,
      })),
    ])

    await expect.poll(() => scrollY(page)).toBeGreaterThan(before)
    await expect(startInput(page)).toHaveValue('01:40.0')
    await expect(endInput(page)).toHaveValue('01:50.0')
    await expectInSync(page)
  })
})
