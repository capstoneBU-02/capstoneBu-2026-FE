import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

// A status is asked for every 2.5 seconds, so a result can take a few rounds.
const RESULT_TIMEOUT = { timeout: 10_000 }

// Every test waits out that polling before it can start checking anything.
test.describe.configure({ timeout: 60_000 })

const timeline = (page: Page) =>
  page.getByRole('region', { name: '구간 타임라인' })
const regionList = (page: Page) =>
  page.getByRole('region', { name: '다시 들어볼 곳' })
const rows = (page: Page) => regionList(page).getByRole('listitem')
const listButton = (page: Page, name: RegExp) =>
  regionList(page).getByRole('button', { name })
const timelineButton = (page: Page, name: RegExp) =>
  timeline(page).getByRole('button', { name })
const mark = (page: Page, number: number) =>
  regionList(page).getByRole('checkbox', {
    name: new RegExp(`^${number}번 구간`),
  })
const bands = (page: Page, lane: 'baseline' | 'performance') =>
  page.locator(`[data-lane="${lane}"] [data-region-id]`)
const chosenBands = (page: Page) =>
  page.locator('[data-lane] [data-region-id][data-selected="true"]')

async function openResult(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=task-verse&comparison=1&comparison-seed=compared${query}`,
  )
  await page.getByRole('tab', { name: /^비교/ }).click()
  await expect(timeline(page)).toBeVisible(RESULT_TIMEOUT)
}

function replaced(source: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(source))
    throw new Error(`The mock no longer contains ${pattern}`)
  return source.replace(pattern, replacement)
}

// The harness seeds only the demo's result on an original song, so these cases
// change what a mock module decides as the dev server hands it to the browser.
function rewriteMock(
  page: Page,
  moduleName: string,
  rewrite: (source: string) => string,
) {
  return page.route(
    `**/src/features/comparison/${moduleName}.ts*`,
    async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: rewrite(await response.text()) })
    },
  )
}

function reportPlaces(page: Page, places: readonly object[]) {
  return rewriteMock(page, 'mockComparisonOutcome', (source) =>
    replaced(
      source,
      /const DEMO_REGIONS = \[[\s\S]*?\n\];/,
      `const DEMO_REGIONS = ${JSON.stringify(places)};`,
    ),
  )
}

test('lists the four places the comparison reported', async ({ page }) => {
  await openResult(page)

  await expect(rows(page)).toHaveCount(4)
  expect(
    await rows(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-kind')),
    ),
  ).toEqual([
    'pitch-difference',
    'missing-note',
    'timing-difference',
    'unavailable',
  ])
  await expect(rows(page).nth(0)).toContainText('1')
  await expect(rows(page).nth(0)).toContainText('00:45.8 – 00:47.2')
  await expect(rows(page).nth(0)).toContainText('다르게 들림')
  await expect(regionList(page)).toContainText('0/3 확인')
})

test('a place that was not compared gives its reason and takes no mark', async ({
  page,
}) => {
  await openResult(page)

  const place = rows(page).nth(3)
  await expect(place).toContainText('비교 못 함')
  await expect(place).toContainText('소리가 또렷하지 않아 비교하지 못했어요')
  await expect(place.getByRole('checkbox')).toHaveCount(0)
  await expect(regionList(page).getByRole('checkbox')).toHaveCount(3)
})

test('both lanes draw each place where it falls in the section', async ({
  page,
}) => {
  await openResult(page)

  for (const lane of ['baseline', 'performance'] as const) {
    await expect(bands(page, lane)).toHaveCount(4)
    const laneBox = await page.locator(`[data-lane="${lane}"]`).boundingBox()
    const bandBox = await bands(page, lane).first().boundingBox()
    if (!laneBox || !bandBox) throw new Error('The lane is not drawn')
    const startRatio = (bandBox.x - laneBox.x) / laneBox.width
    const endRatio = (bandBox.x + bandBox.width - laneBox.x) / laneBox.width
    expect(startRatio).toBeCloseTo(0.154, 2)
    expect(endRatio).toBeCloseTo(0.214, 2)
  }
})

test('a band ends with the lanes however tall the list beside it is', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openResult(page)

  const lane = await page.locator('[data-lane="performance"]').boundingBox()
  const band = await timelineButton(page, /^1번 구간/).boundingBox()
  if (!lane || !band) throw new Error('The timeline is not drawn')
  expect(band.y + band.height).toBeCloseTo(lane.y + lane.height, 0)
})

test('a mark stays after moving on and leaving the view', async ({ page }) => {
  await openResult(page)

  await mark(page, 1).check()
  await expect(regionList(page)).toContainText('1/3 확인')

  await listButton(page, /^2번 구간/).click()
  await expect(mark(page, 1)).toBeChecked()

  await page.getByRole('tab', { name: /^타브/ }).click()
  await page.getByRole('tab', { name: /^비교/ }).click()
  await expect(mark(page, 1)).toBeChecked()
  await expect(regionList(page)).toContainText('1/3 확인')

  await mark(page, 1).uncheck()
  await expect(regionList(page)).toContainText('0/3 확인')
})

test('marking a place does not choose it', async ({ page }) => {
  await openResult(page)

  await mark(page, 2).check()

  await expect(listButton(page, /^2번 구간/)).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(chosenBands(page)).toHaveCount(0)
})

test('choosing a list row lights up its band in both lanes', async ({
  page,
}) => {
  await openResult(page)
  await expect(chosenBands(page)).toHaveCount(0)

  await listButton(page, /^2번 구간/).click()

  await expect(listButton(page, /^2번 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(timelineButton(page, /^2번 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(chosenBands(page)).toHaveCount(2)
  await expect(
    page.locator('[data-lane="baseline"] [data-selected="true"]'),
  ).toHaveAttribute('data-region-id', /-region-2$/)
  await expect(
    page.locator('[data-lane="performance"] [data-selected="true"]'),
  ).toHaveAttribute('data-region-id', /-region-2$/)
})

test('choosing a band lights up its list row and replaces the last choice', async ({
  page,
}) => {
  await openResult(page)

  await timelineButton(page, /^1번 구간/).click()
  await timelineButton(page, /^3번 구간/).click()

  await expect(listButton(page, /^3번 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(rows(page).nth(2)).toHaveAttribute('data-selected', 'true')
  await expect(listButton(page, /^1번 구간/)).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(rows(page).nth(0)).toHaveAttribute('data-selected', 'false')
  await expect(chosenBands(page)).toHaveCount(2)
})

test('a place that was not compared can be chosen too', async ({ page }) => {
  await openResult(page)

  await listButton(page, /^비교 못 함 구간/).click()

  await expect(timelineButton(page, /^비교 못 함 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(chosenBands(page)).toHaveCount(2)
})

test('the keyboard chooses and clears a place', async ({
  page,
  browserName,
}) => {
  // Safari's default Tab skips buttons; Option+Tab reaches them.
  const nextControl = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await openResult(page)

  await timelineButton(page, /^1번 구간/).focus()
  await page.keyboard.press('Enter')
  await expect(listButton(page, /^1번 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.keyboard.press(nextControl)
  await expect(timelineButton(page, /^2번 구간/)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(listButton(page, /^2번 구간/)).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await listButton(page, /^2번 구간/).focus()
  await page.keyboard.press('Enter')
  await expect(chosenBands(page)).toHaveCount(0)
})

test('the list sits beside the timeline on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openResult(page)

  const lanes = await timeline(page).boundingBox()
  const list = await regionList(page).boundingBox()
  if (!lanes || !list) throw new Error('The result is not drawn')
  expect(list.x).toBeGreaterThanOrEqual(lanes.x + lanes.width - 1)
})

for (const width of [1100, 768, 360]) {
  test(`at ${width}px the list moves under the timeline without side scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await openResult(page)
    await expect(rows(page)).toHaveCount(4)

    const lanes = await timeline(page).boundingBox()
    const list = await regionList(page).boundingBox()
    if (!lanes || !list) throw new Error('The result is not drawn')
    expect(list.y).toBeGreaterThanOrEqual(lanes.y + lanes.height - 1)

    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth - root.clientWidth
    })
    expect(overflow).toBe(0)
  })
}

test('no differences reads as nothing found, with nothing to list', async ({
  page,
}) => {
  await reportPlaces(page, [])
  await openResult(page)

  await expect(
    page.getByRole('heading', { name: '다르게 들리는 곳이 없어요' }),
  ).toBeVisible()
  await expect(
    page.getByText('원곡과 번갈아 들으며 한 번 더 확인해 보세요.'),
  ).toBeVisible()
  await expect(regionList(page)).toHaveCount(0)
  await expect(bands(page, 'baseline')).toHaveCount(0)
})

test('only uncompared places never read as a clean result', async ({
  page,
}) => {
  await reportPlaces(page, [{ kind: 'unavailable', start: 0.2, end: 0.3 }])
  await openResult(page)

  await expect(
    page.getByRole('heading', { name: '비교하지 못한 곳이 있어요' }),
  ).toBeVisible()
  await expect(page.getByText('다르게 들리는 곳이 없어요')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  await expect(regionList(page)).not.toContainText(/\d+\/\d+ 확인/)
  await expect(regionList(page).getByRole('checkbox')).toHaveCount(0)
})

test('differences need no summary heading of their own', async ({ page }) => {
  await openResult(page)

  await expect(page.getByText('다르게 들리는 곳이 없어요')).toHaveCount(0)
  await expect(page.getByText('비교하지 못한 곳이 있어요')).toHaveCount(0)
})

test('a slow take says so without a number', async ({ page }) => {
  await rewriteMock(page, 'mockComparisonOutcome', (source) =>
    replaced(source, /const SLOW_RATIO = 1\.1;/, 'const SLOW_RATIO = 0;'),
  )
  await openResult(page)

  await expect(page.getByText('전체적으로 느린 연주예요')).toBeVisible()
})

test('a take at the section pace has no tempo note', async ({ page }) => {
  await openResult(page)

  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByText('전체적으로 느린 연주예요')).toHaveCount(0)
})

test('a sound that cannot play is named', async ({ page }) => {
  await openResult(page, '&comparison-partial=1')

  await expect(
    page.getByRole('status').filter({ hasText: '원곡을' }),
  ).toHaveText('원곡을 재생할 수 없어요. 들을 수 있는 음원으로 확인해 주세요.')
})

test('every sound playing leaves no notice', async ({ page }) => {
  await openResult(page)

  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByText('재생할 수 없어요')).toHaveCount(0)
})

test('the baseline lane is named after what was compared against', async ({
  page,
}) => {
  await openResult(page)
  await expect(timeline(page)).toContainText('원곡')
  await expect(timeline(page)).toContainText('내 연주')
})

test('an uploaded guitar names the baseline lane 올린 음원', async ({
  page,
}) => {
  await rewriteMock(page, 'mockComparisonRepository', (source) =>
    replaced(
      source,
      /baseline: section\.inputKind === "separated-guitar" \? "separated-input" : "original-song"/,
      'baseline: "separated-input"',
    ),
  )
  await openResult(page)

  await expect(timeline(page)).toContainText('올린 음원')
  await expect(timeline(page)).not.toContainText('원곡')
})
