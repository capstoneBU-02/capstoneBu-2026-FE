import { expect, test, type Page } from '@playwright/test'
import { DEMO_TAB_INPUTS } from '../../src/features/tab/demoTabScores.ts'
import {
  fretLabel,
  layoutTab,
  type TabLayout,
} from '../../src/features/tab/layout.ts'
import type { TabScore } from '../../src/features/tab/model.ts'
import {
  palmMuteMarks,
  rhythmMarks,
  tieMarks,
} from '../../src/features/tab/notation.ts'
import { parseTabScore } from '../../src/features/tab/parseTabScore.ts'
import type {} from './tab-harness.tsx'

declare global {
  interface Window {
    tabWatch?: { svg: Element | null; mutations: number }
    loadingShown?: boolean
  }
}

const HARNESS = '/tests/browser/tab-harness.html'

function demo(name: string): TabScore {
  const parsed = parseTabScore(DEMO_TAB_INPUTS[name])
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.score
}

const standard = demo('e-standard')

const panel = (page: Page) =>
  page.getByRole('region', { name: '타브', exact: true })
const staff = (page: Page) => page.getByRole('img', { name: /^타브 악보/ })
const marks = (page: Page, mark: string) =>
  staff(page).locator(`[data-mark="${mark}"]`)
const overlay = (page: Page) => panel(page).locator('[data-mark="current-bar"]')

async function open(page: Page, query = '') {
  await page.goto(`${HARNESS}${query}`)
  await expect(staff(page)).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

// The layout the panel drew, rebuilt from the width it was given.
async function drawnLayout(page: Page, score: TabScore): Promise<TabLayout> {
  const width = Number(await staff(page).getAttribute('width'))
  return layoutTab(score, width)
}

async function rowCount(page: Page): Promise<number> {
  const rows = await marks(page, 'bar-number').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('y')),
  )
  return new Set(rows).size
}

// Remounts the panel and reports whether the loading message showed.
async function remountShowsLoading(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    window.loadingShown = false
    new MutationObserver(() => {
      if (document.querySelector('[role="status"]')) window.loadingShown = true
    }).observe(document.body, { childList: true, subtree: true })
    window.tabTest.remount()
  })
  await expect(staff(page)).toBeVisible()
  return page.evaluate(() => window.loadingShown === true)
}

async function expectOverlayOn(page: Page, layout: TabLayout, number: number) {
  await expect(overlay(page)).toHaveAttribute('data-bar', String(number))
  await expect(overlay(page)).toBeVisible()
  const origin = (await staff(page).boundingBox())!
  const box = (await overlay(page).boundingBox())!
  const bar = layout.bars.find((candidate) => candidate.number === number)!
  expect(box.x - origin.x).toBeCloseTo(bar.x, 0)
  expect(box.y - origin.y).toBeCloseTo(bar.y, 0)
  expect(box.width).toBeCloseTo(bar.width, 0)
  expect(box.height).toBeCloseTo(bar.height, 0)
}

test('타브 영역 머리에 자동 생성 초안임을 표시', async ({ page }) => {
  await open(page)
  await expect(
    panel(page).getByRole('heading', { level: 2, name: '타브' }),
  ).toBeVisible()
  await expect(panel(page).getByText('초안 · 자동 생성')).toBeVisible()
  await expect(staff(page)).toHaveAccessibleName('타브 악보 4마디')
})

test('데모 악보의 표기를 모두 그림', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  const layout = await drawnLayout(page, standard)
  expect(layout.barsPerRow).toBe(4)
  const rhythm = rhythmMarks(layout)
  const frets = standard.bars.flatMap((bar) =>
    bar.beats.flatMap((beat) => beat.notes.map(fretLabel)),
  )

  await expect(marks(page, 'string-name')).toHaveText([
    'e',
    'B',
    'G',
    'D',
    'A',
    'E',
  ])
  await expect(marks(page, 'bar-number')).toHaveText(['1', '2', '3', '4'])
  await expect(marks(page, 'fret')).toHaveText(frets)
  await expect(marks(page, 'fret').filter({ hasText: '(2)' })).toHaveCount(2)
  await expect(marks(page, 'hammer-on')).toHaveText(['h'])
  const palmMuteLines = palmMuteMarks(layout).filter(
    (mark) => mark.x2 > mark.lineX1,
  )
  // The expected counts come from the drawing functions, so each must find
  // something, or a mark that vanished from both would still pass.
  for (const count of [
    palmMuteLines.length,
    tieMarks(layout).length,
    rhythm.stems.length,
    rhythm.beams.length,
    rhythm.flags.length,
    rhythm.dots.length,
  ]) {
    expect(count).toBeGreaterThan(0)
  }
  await expect(marks(page, 'palm-mute')).toHaveText(['P.M.'])
  await expect(marks(page, 'palm-mute-line')).toHaveCount(palmMuteLines.length)
  await expect(marks(page, 'tie')).toHaveCount(tieMarks(layout).length)
  await expect(marks(page, 'rest')).toHaveCount(3)
  await expect(marks(page, 'stem')).toHaveCount(rhythm.stems.length)
  await expect(marks(page, 'beam')).toHaveCount(rhythm.beams.length)
  await expect(marks(page, 'flag')).toHaveCount(rhythm.flags.length)
  await expect(marks(page, 'dot')).toHaveCount(rhythm.dots.length)
})

test('Drop D 악보는 맨 아래 줄 이름이 D', async ({ page }) => {
  await open(page, '?score=drop-d')
  await expect(marks(page, 'string-name')).toHaveText([
    'e',
    'B',
    'G',
    'D',
    'A',
    'D',
  ])
  await expect(staff(page)).toHaveAccessibleName('타브 악보 2마디')
})

test('글자는 PDF로 옮길 수 있는 속성만 사용', async ({ page }) => {
  await open(page)
  // svg2pdf.js reads attributes alone: no CSS, no CSS variables.
  const unsafe = await staff(page).evaluate((svg) =>
    [svg, ...svg.querySelectorAll('*')].flatMap((node) =>
      [...node.attributes]
        .filter(
          (attribute) =>
            ['style', 'class', 'paint-order', 'dominant-baseline'].includes(
              attribute.name,
            ) || attribute.value.includes('var('),
        )
        .map((attribute) => `${node.tagName} ${attribute.name}`),
    ),
  )
  expect(unsafe).toEqual([])
  expect(await staff(page).getAttribute('font-family')).toMatch(
    /^'JetBrains Mono'/,
  )
  const texts = await staff(page)
    .locator('text')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        mark: node.getAttribute('data-mark'),
        weight: node.getAttribute('font-weight'),
        paintOrder: node.getAttribute('paint-order'),
        baseline: node.getAttribute('dominant-baseline'),
        style: node.getAttribute('style'),
        family: getComputedStyle(node).fontFamily,
        masked: node.previousElementSibling?.getAttribute('data-mark'),
      })),
    )
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) {
    expect(text.weight).toBe(text.mark === 'fret' ? '700' : '400')
    expect(text.paintOrder).toBeNull()
    expect(text.baseline).toBeNull()
    expect(text.style).toBeNull()
    expect(text.family).toContain('JetBrains Mono')
    if (text.mark === 'fret' || text.mark === 'hammer-on') {
      expect(text.masked).toBe('mask')
    }
  }
  await expect(marks(page, 'mask').first()).toHaveAttribute('fill', '#fff')
  // Fret numbers are bold, so the self-hosted face has to cover 700.
  const weights = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.family.replace(/['"]/g, '') === 'JetBrains Mono')
      .map((face) => face.weight),
  )
  expect(weights).toEqual(['400 700'])
})

test('390 너비에서 두 마디씩 줄바꿈하고 가로로 넘치지 않음', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const layout = await drawnLayout(page, standard)
  expect(layout.barsPerRow).toBe(2)
  expect(await rowCount(page)).toBe(2)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const box = (await staff(page).boundingBox())!
  const area = (await panel(page).boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width - 16)
})

test('숫자와 쉼표가 자기 마디의 경계 안에 놓임', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    const layout = await drawnLayout(page, standard)
    const boxes = await staff(page)
      .locator('[data-mark="fret"], [data-mark="rest"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = (node as SVGGraphicsElement).getBBox()
          return {
            bar: Number(node.getAttribute('data-bar')),
            left: box.x,
            right: box.x + box.width,
          }
        }),
      )
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      const bar = layout.bars.find((candidate) => candidate.number === box.bar)
      expect(bar).toBeDefined()
      expect(box.left).toBeGreaterThan(bar!.x + 1)
      expect(box.right).toBeLessThan(bar!.x + bar!.width - 1)
    }
  }
})

test('너비가 바뀌면 줄당 마디 수를 다시 계산하고 덮개도 옮김', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  await expect.poll(() => rowCount(page)).toBe(1)
  await page.evaluate(() => window.tabTest.seek(4.5))
  await expectOverlayOn(page, await drawnLayout(page, standard), 3)
  // Bar 3 moves to the second row while the time stays put.
  await page.setViewportSize({ width: 390, height: 900 })
  await expect.poll(() => rowCount(page)).toBe(2)
  await expectOverlayOn(page, await drawnLayout(page, standard), 3)
})

test('마디가 영역보다 넓을 때만 키보드로 가로 스크롤', async ({ page }) => {
  const scroller = panel(page).getByRole('group', {
    name: '타브 악보 가로 스크롤',
  })
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page)
  await expect(scroller).toHaveCount(0)
  // The page never gets narrower than 320, so the area narrows instead, as a
  // side column would.
  await page.addStyleTag({ content: 'main { width: 160px }' })
  await expect(scroller).toHaveAttribute('tabindex', '0')
  const wider = await scroller.evaluate(
    (node) => node.scrollWidth > node.clientWidth,
  )
  expect(wider).toBe(true)
  await scroller.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0)
})

test('재생 위치가 속한 마디를 덮개로 표시', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page)
  const layout = await drawnLayout(page, standard)
  await expectOverlayOn(page, layout, 1)
  await page.evaluate(() => window.tabTest.seek(4.5))
  await expectOverlayOn(page, layout, 3)
  await page.evaluate(() => window.tabTest.seek(8))
  await expect(overlay(page)).toBeHidden()
  await page.evaluate(() => window.tabTest.seek(7.9))
  await expectOverlayOn(page, layout, 4)
  await page.evaluate(() => window.tabTest.seek(-0.5))
  await expect(overlay(page)).toBeHidden()
})

test('재생 중 마디가 바뀌어도 악보 SVG를 다시 그리지 않음', async ({
  page,
}) => {
  await open(page)
  await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]')
    const watch = { svg, mutations: 0 }
    new MutationObserver((records) => {
      watch.mutations += records.length
    }).observe(svg!, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    window.tabWatch = watch
  })

  await page.evaluate(() => window.tabTest.setPlaying(true))
  await page.evaluate(() => window.tabTest.setTime(2.5))
  await expect(overlay(page)).toHaveAttribute('data-bar', '2')
  await page.evaluate(() => window.tabTest.setTime(6.5))
  await expect(overlay(page)).toHaveAttribute('data-bar', '4')
  await page.evaluate(() => window.tabTest.setPlaying(false))
  // Paused, the time moving on its own leaves the box where it is.
  await page.evaluate(async () => {
    window.tabTest.setTime(0.5)
    for (let frame = 0; frame < 5; frame += 1) {
      await new Promise(requestAnimationFrame)
    }
  })
  await expect(overlay(page)).toHaveAttribute('data-bar', '4')
  await page.evaluate(() => window.tabTest.seek(4.5))
  await expect(overlay(page)).toHaveAttribute('data-bar', '3')
  await page.evaluate(() => window.tabTest.rerender())
  await expect(overlay(page)).toHaveAttribute('data-bar', '3')

  const watch = await page.evaluate(() => ({
    same: window.tabWatch!.svg === document.querySelector('svg[role="img"]'),
    mutations: window.tabWatch!.mutations,
  }))
  expect(watch).toEqual({ same: true, mutations: 0 })
})

test('48마디 악보도 그리고 마지막 마디까지 표시', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, '?score=long')
  await expect(staff(page)).toHaveAccessibleName('타브 악보 48마디')
  await expect(marks(page, 'bar-number')).toHaveCount(48)
  expect(await rowCount(page)).toBe(12)
  const score = await page.evaluate(() => window.tabTest.score())
  await page.evaluate(() => window.tabTest.seek(95))
  await expectOverlayOn(page, await drawnLayout(page, score), 48)
})

test('악보를 불러오는 동안 안내하고, 실패하면 다시 시도', async ({ page }) => {
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
  await page.goto(HARNESS)

  await expect(panel(page).getByRole('status')).toHaveText(
    '타브를 불러오는 중이에요',
  )
  release()
  await expect(panel(page).getByRole('alert')).toContainText(
    '타브를 표시하지 못했어요',
  )
  failing = false
  await panel(page).getByRole('button', { name: '다시 시도' }).focus()
  await page.keyboard.press('Enter')
  // The button goes away, so focus moves to the heading of the same area.
  await expect(
    panel(page).getByRole('heading', { level: 2, name: '타브' }),
  ).toBeFocused()
  await expect(staff(page)).toBeVisible()
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  // The code that loaded on the retry serves the next panel too.
  expect(await remountShowsLoading(page)).toBe(false)
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
})

test('한 번 불러온 뒤 다시 연 타브는 기다림 없이 그림', async ({ page }) => {
  await open(page)
  expect(await remountShowsLoading(page)).toBe(false)
})
