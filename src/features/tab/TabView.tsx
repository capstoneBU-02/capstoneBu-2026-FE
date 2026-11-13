import { Fragment, memo } from 'react'
import {
  fretLabel,
  PALM_MUTE_LABEL,
  stringLabels,
  stringY,
  TAB_METRICS,
  type TabLayout,
} from './layout.ts'
import type { TabScore } from './model.ts'
import {
  hammerOnMarks,
  palmMuteMarks,
  rhythmMarks,
  tieMarks,
} from './notation.ts'
import { TAB_COLORS, TAB_FONT } from './svgStyle.ts'
import { RestGlyph, SvgText } from './tabGlyphs.tsx'

interface TabViewProps {
  readonly score: TabScore
  readonly layout: TabLayout
}

const BAR_NUMBER_RISE = 14
const TIE_SAG = 7
const FLAG_REACH = 6
const SECOND_FLAG_GAP = 4

// The line a rest hangs from: the one nearest the middle, from above.
function restLine(layout: TabLayout, row: number): number {
  const strings = layout.staffHeight / TAB_METRICS.lineGap + 1
  return stringY(layout, row, Math.floor((strings - 1) / 2) + 1)
}

function Staff({ score, layout }: TabViewProps) {
  const { lineGap, smallSize } = TAB_METRICS
  const labels = stringLabels(score.tuning)
  return layout.rows.map((row) => {
    const bars = layout.bars.slice(row.firstBar, row.lastBar + 1)
    const bottom = row.staffTop + layout.staffHeight
    const end = row.x + row.width
    return (
      <g key={row.index}>
        {labels.map((label, index) => {
          const y = row.staffTop + index * lineGap
          return (
            <Fragment key={index}>
              <line
                data-mark="string-line"
                x1={row.x}
                y1={y}
                x2={end}
                y2={y}
                stroke={TAB_COLORS.line}
              />
              <SvgText
                x={4}
                y={y}
                text={label}
                size={smallSize}
                weight={400}
                color={TAB_COLORS.secondary}
                anchor="start"
                mark="string-name"
              />
            </Fragment>
          )
        })}
        {bars.map((bar) => (
          <Fragment key={bar.index}>
            <line
              data-mark="bar-line"
              x1={bar.x}
              y1={row.staffTop}
              x2={bar.x}
              y2={bottom}
              stroke={TAB_COLORS.bar}
            />
            <SvgText
              x={bar.x + 2}
              y={row.staffTop - BAR_NUMBER_RISE}
              text={String(bar.number)}
              size={smallSize}
              weight={400}
              color={TAB_COLORS.secondary}
              anchor="start"
              mark="bar-number"
              bar={bar.number}
            />
          </Fragment>
        ))}
        <line
          data-mark="bar-line"
          x1={end}
          y1={row.staffTop}
          x2={end}
          y2={bottom}
          stroke={TAB_COLORS.bar}
        />
      </g>
    )
  })
}

function PalmMutes({ layout }: { readonly layout: TabLayout }) {
  return palmMuteMarks(layout).map((mark, index) => (
    <Fragment key={index}>
      {mark.labeled && (
        <SvgText
          x={mark.x1}
          y={mark.y}
          text={PALM_MUTE_LABEL}
          size={TAB_METRICS.smallSize}
          weight={400}
          color={TAB_COLORS.secondary}
          anchor="start"
          mark="palm-mute"
        />
      )}
      {mark.x2 > mark.lineX1 && (
        <line
          data-mark="palm-mute-line"
          x1={mark.lineX1}
          y1={mark.y}
          x2={mark.x2}
          y2={mark.y}
          stroke={TAB_COLORS.secondary}
          strokeDasharray="1 2.5"
        />
      )}
    </Fragment>
  ))
}

function Ties({ layout }: { readonly layout: TabLayout }) {
  return tieMarks(layout).map((tie) => (
    <path
      key={`${tie.beatIndex}-${tie.string}`}
      data-mark="tie"
      d={`M${tie.x1} ${tie.y} Q${(tie.x1 + tie.x2) / 2} ${tie.y + TIE_SAG} ${tie.x2} ${tie.y}`}
      fill="none"
      stroke={TAB_COLORS.secondary}
    />
  ))
}

function Notes({ layout }: { readonly layout: TabLayout }) {
  return layout.beats.map((placed, index) => {
    const bar = layout.bars[placed.barIndex].number
    if (placed.beat.notes.length === 0) {
      return (
        <RestGlyph
          key={index}
          beat={placed.beat}
          x={placed.x}
          line={restLine(layout, placed.row)}
          lineGap={TAB_METRICS.lineGap}
          bar={bar}
        />
      )
    }
    return (
      <Fragment key={index}>
        {placed.beat.notes.map((note) => (
          <SvgText
            key={note.string}
            x={placed.x}
            y={stringY(layout, placed.row, note.string)}
            text={fretLabel(note)}
            size={TAB_METRICS.fretSize}
            weight={700}
            color={TAB_COLORS.ink}
            mask
            mark="fret"
            bar={bar}
          />
        ))}
      </Fragment>
    )
  })
}

function HammerOns({ layout }: { readonly layout: TabLayout }) {
  return hammerOnMarks(layout).map((mark) => (
    <SvgText
      key={`${mark.beatIndex}-${mark.string}`}
      x={mark.x}
      y={mark.y}
      text="h"
      size={TAB_METRICS.smallSize}
      weight={400}
      color={TAB_COLORS.secondary}
      mask
      mark="hammer-on"
    />
  ))
}

function Rhythm({ layout }: { readonly layout: TabLayout }) {
  const { stems, beams, flags, dots } = rhythmMarks(layout)
  const ink = TAB_COLORS.ink
  return (
    <>
      {stems.map((stem) => (
        <line
          key={`stem-${stem.beatIndex}`}
          data-mark="stem"
          x1={stem.x}
          y1={stem.y1}
          x2={stem.x}
          y2={stem.y2}
          stroke={ink}
        />
      ))}
      {beams.map((beam, index) => (
        <line
          key={`beam-${index}`}
          data-mark="beam"
          x1={beam.x1}
          y1={beam.y}
          x2={beam.x2}
          y2={beam.y}
          stroke={ink}
          strokeWidth={2}
        />
      ))}
      {flags.map((flag) => (
        <g key={`flag-${flag.beatIndex}`} data-mark="flag">
          {Array.from({ length: flag.count }, (_, level) => {
            const y = flag.y - level * SECOND_FLAG_GAP
            return (
              <line
                key={level}
                x1={flag.x}
                y1={y}
                x2={flag.x + FLAG_REACH}
                y2={y - FLAG_REACH}
                stroke={ink}
                strokeWidth={1.5}
              />
            )
          })}
        </g>
      ))}
      {dots.map((dot) => (
        <circle
          key={`dot-${dot.beatIndex}`}
          data-mark="dot"
          cx={dot.x}
          cy={dot.y}
          r={1.4}
          fill={ink}
        />
      ))}
    </>
  )
}

// The whole tab as one SVG. It depends only on the score and the layout, so
// playback and other panel state never redraw it.
export const TabView = memo(function TabView({ score, layout }: TabViewProps) {
  const width = Math.ceil(layout.width)
  const height = Math.ceil(layout.height)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily={TAB_FONT}
      role="img"
      aria-label={`타브 악보 ${score.bars.length}마디`}
    >
      <Staff score={score} layout={layout} />
      <PalmMutes layout={layout} />
      <Notes layout={layout} />
      <Ties layout={layout} />
      <HammerOns layout={layout} />
      <Rhythm layout={layout} />
    </svg>
  )
})
