import type { TabBeat, TabDuration } from './model.ts'
import { TAB_COLORS } from './svgStyle.ts'

// Drawing pieces shared by the tab SVG. Text avoids paint-order and
// dominant-baseline, which svg2pdf.js ignores: a white box hides the line
// behind a number, and the baseline is placed by hand.

// JetBrains Mono advances 0.6 em per character.
const ADVANCE = 0.6
const BASELINE_DROP = 0.35
const MASK_HEIGHT = 0.9

interface SvgTextProps {
  readonly x: number
  // The vertical centre of the text.
  readonly y: number
  readonly text: string
  readonly size: number
  // Fret numbers are bold and labels regular: the PDF registers only these.
  readonly weight: 400 | 700
  readonly color: string
  readonly anchor?: 'start' | 'middle'
  // A white box behind the text hides the string line under it.
  readonly mask?: boolean
  readonly mark: string
  readonly bar?: number
}

export function SvgText({
  x,
  y,
  text,
  size,
  weight,
  color,
  anchor = 'middle',
  mask = false,
  mark,
  bar,
}: SvgTextProps) {
  const width = text.length * size * ADVANCE + 2
  const left = anchor === 'middle' ? x - width / 2 : x - 1
  return (
    <>
      {mask && (
        <rect
          data-mark="mask"
          x={left}
          y={y - (size * MASK_HEIGHT) / 2}
          width={width}
          height={size * MASK_HEIGHT}
          fill={TAB_COLORS.mask}
        />
      )}
      <text
        data-mark={mark}
        data-bar={bar}
        x={x}
        y={y + size * BASELINE_DROP}
        fontSize={size}
        fontWeight={weight}
        fill={color}
        textAnchor={anchor}
      >
        {text}
      </text>
    </>
  )
}

const REST_STROKE = {
  fill: 'none',
  stroke: TAB_COLORS.ink,
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function RestDot({ cx, cy }: { readonly cx: number; readonly cy: number }) {
  return <circle cx={cx} cy={cy} r={1.8} fill={TAB_COLORS.ink} />
}

function restShape(
  duration: TabDuration,
  x: number,
  line: number,
  lineGap: number,
) {
  const mid = line + lineGap / 2
  switch (duration) {
    case 1:
      // Hangs from a line.
      return (
        <rect x={x - 5} y={line} width={10} height={5} fill={TAB_COLORS.ink} />
      )
    case 2:
      // Sits on the next line down.
      return (
        <rect
          x={x - 5}
          y={line + lineGap - 5}
          width={10}
          height={5}
          fill={TAB_COLORS.ink}
        />
      )
    case 4:
      return (
        <path
          d={`M${x - 2} ${mid - 11} l5 6 l-4 5 l5 6 c-4 -2 -7 0 -4 5`}
          {...REST_STROKE}
        />
      )
    case 8:
      return (
        <>
          <RestDot cx={x - 2} cy={mid - 4} />
          <path
            d={`M${x - 3} ${mid - 3} q3 1.5 6 -2 L${x - 1} ${mid + 8}`}
            {...REST_STROKE}
          />
        </>
      )
    case 16:
      return (
        <>
          <RestDot cx={x - 1} cy={mid - 7} />
          <RestDot cx={x - 3} cy={mid} />
          <path
            d={`M${x - 2} ${mid - 6} q3 1.5 6 -2 L${x - 2} ${mid + 11} M${x - 4} ${mid + 1} q3 1.5 6 -2`}
            {...REST_STROKE}
          />
        </>
      )
  }
}

interface RestGlyphProps {
  readonly beat: TabBeat
  readonly x: number
  // The string line nearest the middle of the staff, from above.
  readonly line: number
  readonly lineGap: number
  readonly bar: number
}

// Rests are drawn as paths, so no music font is needed on screen or in a PDF.
export function RestGlyph({ beat, x, line, lineGap, bar }: RestGlyphProps) {
  const mid = line + lineGap / 2
  return (
    <g data-mark="rest" data-bar={bar}>
      {restShape(beat.duration, x, line, lineGap)}
      {beat.dotted && <RestDot cx={x + 7} cy={mid - 3} />}
    </g>
  )
}
