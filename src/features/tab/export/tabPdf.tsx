import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import boldUrl from '../../../assets/fonts/jetbrains-mono-700.ttf?url'
import regularUrl from '../../../assets/fonts/jetbrains-mono-400.ttf?url'
import { layoutTab, type TabLayout } from '../layout.ts'
import type { TabScore } from '../model.ts'
import { TabView } from '../TabView.tsx'
import { base64Of } from './fontData.ts'
import { PDF_PAGE, PDF_TAB_WIDTH, pdfPlan } from './pages.ts'

// The family TAB_FONT names first, so svg2pdf.js finds it by name. Fret
// numbers use the bold face, everything else the regular one.
const FAMILY = 'JetBrains Mono'

// A top-level part of the tab SVG and how far down it reaches.
interface Part {
  readonly node: Node
  readonly top: number
  readonly bottom: number
}

// Strokes and glyphs reach a little past their boxes.
const PART_SLACK = 4

// Draws the tab laid out for the page, out of sight, and notes where each of
// its parts sits, so every page holds only the rows it shows.
function drawTab(
  score: TabScore,
  layout: TabLayout,
): { readonly frame: SVGSVGElement; readonly parts: readonly Part[] } {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;top:0;left:-100000px;visibility:hidden'
  document.body.append(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(<TabView score={score} layout={layout} />))
    const svg = host.querySelector('svg')
    if (svg === null) throw new Error('The tab was not drawn')
    const parts = [...svg.children].map((child) => {
      // The tab uses no transforms, so each box is in the SVG's own units.
      const box = (child as SVGGraphicsElement).getBBox()
      return {
        node: child.cloneNode(true),
        top: box.y - PART_SLACK,
        bottom: box.y + box.height + PART_SLACK,
      }
    })
    return { frame: svg.cloneNode(false) as SVGSVGElement, parts }
  } finally {
    root.unmount()
    host.remove()
  }
}

// svg2pdf.js draws a page without handing the browser a turn, so a whole PDF
// would run as one task and leaving the screen would go unseen until it
// ended. A turn between pages lets it be seen, and the PDF stops there.
// A message, unlike a timer, is not slowed in a background tab.
async function nextPage(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => {
      port1.close()
      resolve()
    }
    port2.postMessage(null)
  })
  signal.throwIfAborted()
}

// svg2pdf.js measures text in a hidden svg it adds to the body, and takes it
// away only when the page draws without an error. Match that measurement
// node's shape (svg2pdf.js 2.9), preserving unrelated SVGs added meanwhile.
async function leavingNoSvg(draw: () => Promise<unknown>): Promise<void> {
  const before = new Set(document.body.children)
  try {
    await draw()
  } finally {
    for (const child of [...document.body.children])
      if (
        child instanceof SVGSVGElement &&
        !before.has(child) &&
        child.style.position === 'absolute' &&
        child.style.visibility === 'hidden' &&
        child.children.length === 1 &&
        child.firstElementChild?.localName === 'text'
      )
        child.remove()
  }
}

// The tab as vector A4 pages: paths and real text in JetBrains Mono, rows
// whole on each page. jsPDF and svg2pdf.js load only when a PDF is made.
// Aborting `signal` stops it before the next page.
export async function tabPdf(
  score: TabScore,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted()
  const [{ jsPDF }, { svg2pdf }, regular, bold] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
    base64Of(regularUrl, signal),
    base64Of(boldUrl, signal),
  ])
  // The code and fonts take longest; the tab may be gone by now.
  signal.throwIfAborted()
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  doc.addFileToVFS('JetBrainsMono-Regular.ttf', regular)
  doc.addFont('JetBrainsMono-Regular.ttf', FAMILY, 'normal')
  doc.addFileToVFS('JetBrainsMono-Bold.ttf', bold)
  doc.addFont('JetBrainsMono-Bold.ttf', FAMILY, 'bold')

  const layout = layoutTab(score, PDF_TAB_WIDTH)
  const { frame, parts } = drawTab(score, layout)
  const { width, scale, spans } = pdfPlan(layout)
  for (const [index, span] of spans.entries()) {
    if (index > 0) {
      await nextPage(signal)
      doc.addPage()
    }
    const height = span.bottom - span.top
    const page = frame.cloneNode(false) as SVGSVGElement
    for (const part of parts)
      if (part.bottom > span.top && part.top < span.bottom)
        page.append(part.node.cloneNode(true))
    page.setAttribute('viewBox', `0 ${span.top} ${width} ${height}`)
    page.setAttribute('width', String(width))
    page.setAttribute('height', String(height))
    await leavingNoSvg(() =>
      svg2pdf(page, doc, {
        x: PDF_PAGE.margin,
        y: PDF_PAGE.margin,
        width: width * scale,
        height: height * scale,
      }),
    )
  }
  // A tab of one page, or the last page, can still stop before the file is
  // put together.
  await nextPage(signal)
  return doc.output('blob')
}
