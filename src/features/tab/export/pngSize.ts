// The largest canvas every browser draws: iOS Safari caps the area at
// 4096², and Chrome and Firefox cap a side at 32,767 pixels. A larger one
// draws nothing and the PNG fails.
export const PNG_LIMIT = { area: 4096 * 4096, side: 32_767 } as const

// Twice the CSS size, sharp on a high-density screen or a print.
const SCALE = 2

// The PNG's size in pixels for a tab of the given CSS size: twice it, or as
// large as a canvas allows, in the same shape.
export function pngSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(
    SCALE,
    PNG_LIMIT.side / Math.max(width, height),
    Math.sqrt(PNG_LIMIT.area / (width * height)),
  )
  return {
    width: Math.floor(width * scale),
    height: Math.floor(height * scale),
  }
}
