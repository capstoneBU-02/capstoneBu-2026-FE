import monoUrl from '../../../assets/fonts/jetbrains-mono-latin.woff2?url'
import { TAB_COLORS } from '../svgStyle.ts'
import { base64Of } from './fontData.ts'
import { pngSize } from './pngSize.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

// An SVG drawn as an image cannot reach the page's fonts, so the copy
// carries JetBrains Mono itself, every weight the tab uses in one file.
async function fontFace(): Promise<string> {
  const data = await base64Of(monoUrl)
  return `@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:400 700;}`
}

function decode(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  return image.decode().then(() => image)
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('The PNG was not made')),
      'image/png',
    ),
  )
}

// The tab as it shows on screen, on white, at twice its size or as large as
// a canvas allows. The current bar box sits outside the SVG and stays out of
// the picture.
export async function tabPng(svg: SVGSVGElement): Promise<Blob> {
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height'))
  const copy = svg.cloneNode(true) as SVGSVGElement
  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = await fontFace()
  copy.insertBefore(style, copy.firstChild)

  const source = new XMLSerializer().serializeToString(copy)
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
  try {
    const image = await decode(url)
    const canvas = document.createElement('canvas')
    const size = pngSize(width, height)
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('No canvas to draw on')
    context.fillStyle = TAB_COLORS.mask
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await toPng(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}
