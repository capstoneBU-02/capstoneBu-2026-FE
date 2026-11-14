import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PDF_PAGE,
  PDF_TAB_WIDTH,
  pageSpans,
  pdfPlan,
  pdfScale,
} from '../src/features/tab/export/pages.ts'
import { PNG_LIMIT, pngSize } from '../src/features/tab/export/pngSize.ts'
import { tabFileName } from '../src/features/tab/export/fileName.ts'
import { layoutTab } from '../src/features/tab/layout.ts'
import { parseTabScore } from '../src/features/tab/parseTabScore.ts'
import { mockTabInput } from '../src/features/workspace/mockTab.ts'

const rows = (count, rowHeight, gap) => ({
  rowHeight,
  rows: Array.from({ length: count }, (_, index) => ({
    y: index * (rowHeight + gap),
  })),
})

test('a tab shorter than a page fits on one page', () => {
  assert.deepEqual(pageSpans(rows(3, 100, 20), 500), [{ top: 0, bottom: 340 }])
})

test('pages break between rows and drop the gap at the break', () => {
  // Rows end at 100, 220, 340, 460, 580; a page holds 350.
  assert.deepEqual(pageSpans(rows(5, 100, 20), 350), [
    { top: 0, bottom: 340 },
    { top: 360, bottom: 580 },
  ])
})

test('a row that ends exactly at the page end stays on it', () => {
  assert.deepEqual(pageSpans(rows(2, 100, 20), 220), [{ top: 0, bottom: 220 }])
})

test('a row taller than a page gets a page of its own', () => {
  assert.deepEqual(pageSpans(rows(2, 400, 20), 300), [
    { top: 0, bottom: 400 },
    { top: 420, bottom: 820 },
  ])
})

test('an empty layout has no pages', () => {
  assert.deepEqual(pageSpans(rows(0, 100, 20), 300), [])
})

test('the PDF lays the tab out at its printed size on an A4 page', () => {
  // A CSS pixel is 0.75 pt: the content width of A4 less two margins.
  assert.equal(
    PDF_TAB_WIDTH,
    (PDF_PAGE.width - 2 * PDF_PAGE.margin) / PDF_PAGE.ptPerPx,
  )
  // Three minutes of two-second bars.
  const long = mockTabInput('e-standard', 180)
  const parsed = parseTabScore(long)
  assert.equal(parsed.ok, true, parsed.error)
  const layout = layoutTab(parsed.score, PDF_TAB_WIDTH)
  const { width, scale, spans } = pdfPlan(layout)
  const content = {
    width: PDF_PAGE.width - 2 * PDF_PAGE.margin,
    height: PDF_PAGE.height - 2 * PDF_PAGE.margin,
  }
  // The drawn SVG is a whole number of pixels wide, and still fits.
  assert.equal(width, Math.ceil(layout.width))
  assert.ok(width * scale <= content.width + 1e-9)
  assert.ok(Math.abs(scale - PDF_PAGE.ptPerPx) < 0.001)
  assert.ok(spans.length > 1, 'a long tab takes more than one page')
  for (const span of spans)
    assert.ok((span.bottom - span.top) * scale <= content.height + 1e-9)
  // Every row is on exactly one page.
  for (const row of layout.rows) {
    const holding = spans.filter(
      (span) => span.top <= row.y && row.y + layout.rowHeight <= span.bottom,
    )
    assert.equal(holding.length, 1)
  }
})

test('a tab that fits the page prints at its screen size', () => {
  assert.equal(pdfScale(PDF_TAB_WIDTH), PDF_PAGE.ptPerPx)
  assert.equal(pdfScale(300), PDF_PAGE.ptPerPx)
})

test('a tab wider than the page shrinks to fit it', () => {
  const content = PDF_PAGE.width - 2 * PDF_PAGE.margin
  const scale = pdfScale(PDF_TAB_WIDTH * 2)
  assert.equal(scale, PDF_PAGE.ptPerPx / 2)
  assert.ok(Math.abs(PDF_TAB_WIDTH * 2 * scale - content) < 1e-9)
})

test('a PNG is twice the tab on screen', () => {
  assert.deepEqual(pngSize(900, 480), { width: 1800, height: 960 })
})

test('a PNG too big for a canvas shrinks to fit every browser', () => {
  // A long section on a narrow screen: one bar to a row.
  const tall = pngSize(358, 30_000)
  assert.ok(tall.height <= PNG_LIMIT.side)
  assert.ok(tall.width * tall.height <= PNG_LIMIT.area)
  assert.ok(Math.abs(tall.width / tall.height - 358 / 30_000) < 0.001)
  const wide = pngSize(4000, 4000)
  assert.ok(wide.width * wide.height <= PNG_LIMIT.area)
  assert.equal(wide.width, wide.height)
})

test('the file is named after the song and the section', () => {
  assert.equal(
    tabFileName('neon_harbor_live', '벌스 1', 'png'),
    'neon_harbor_live_벌스 1.png',
  )
})

test('characters a file name cannot hold become underscores', () => {
  assert.equal(
    tabFileName('AC/DC: Live?', '솔로 <2>|"끝"*\\', 'pdf'),
    'AC_DC_ Live__솔로 _2___끝___.pdf',
  )
})

test('control characters, edge dots and spaces leave the name', () => {
  assert.equal(
    tabFileName(' .곡\u0007이름', '구간. ', 'pdf'),
    '곡_이름_구간.pdf',
  )
})

test('a name with nothing left falls back to 타브', () => {
  assert.equal(tabFileName(' ', '...', 'png'), '타브.png')
})
