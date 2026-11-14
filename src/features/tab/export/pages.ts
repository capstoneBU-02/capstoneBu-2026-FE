import type { TabLayout } from '../layout.ts'

// A4 portrait in points. A CSS pixel prints as 0.75 pt, so the tab keeps its
// on-screen type size on paper.
export const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 36,
  ptPerPx: 0.75,
} as const

// The page less its margins, in points.
const CONTENT_WIDTH = PDF_PAGE.width - 2 * PDF_PAGE.margin
const CONTENT_HEIGHT = PDF_PAGE.height - 2 * PDF_PAGE.margin

// The width the PDF lays the tab out at, in CSS pixels. The rows break for
// the page, not for the screen.
export const PDF_TAB_WIDTH = CONTENT_WIDTH / PDF_PAGE.ptPerPx

// Points per CSS pixel on the page. A bar too wide for the page widens the
// layout past PDF_TAB_WIDTH; the whole tab then shrinks to fit the margins.
export function pdfScale(layoutWidth: number): number {
  return Math.min(PDF_PAGE.ptPerPx, CONTENT_WIDTH / layoutWidth)
}

export interface PageSpan {
  readonly top: number
  readonly bottom: number
}

// The part of the tab each page shows, top to bottom. A page takes whole
// rows while they fit, so no row splits across pages, and the gap at a break
// goes. A row taller than a page gets a page of its own.
export function pageSpans(
  layout: Pick<TabLayout, 'rowHeight'> & {
    readonly rows: readonly { readonly y: number }[]
  },
  pageHeight: number,
): readonly PageSpan[] {
  const spans: PageSpan[] = []
  for (const { y } of layout.rows) {
    const bottom = y + layout.rowHeight
    const page = spans.at(-1)
    if (page && bottom - page.top <= pageHeight)
      spans[spans.length - 1] = { top: page.top, bottom }
    else spans.push({ top: y, bottom })
  }
  return spans
}

export interface PdfPlan {
  // The drawn SVG's width, a whole number of CSS pixels.
  readonly width: number
  // Points per CSS pixel.
  readonly scale: number
  readonly spans: readonly PageSpan[]
}

// How a tab laid out at PDF_TAB_WIDTH goes onto the pages.
export function pdfPlan(layout: TabLayout): PdfPlan {
  const width = Math.ceil(layout.width)
  const scale = pdfScale(width)
  return { width, scale, spans: pageSpans(layout, CONTENT_HEIGHT / scale) }
}
