import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'
import { formatSpokenTime } from '../../new-section/sectionTime.ts'
import type { SectionPlayback } from '../../player/useSectionPlayer.ts'
import { keyboardSeek, type TimeWindow } from '../../waveform/timeline.ts'
import styles from './TaskTracks.module.css'

type Props = {
  // Takes --played, the share of the section played so far, for every row
  // under it to read.
  rowsRef: RefObject<HTMLElement | null>
  // The section in song time, as the ruler shows it.
  section: TimeWindow
  // Seconds from the section start to where the player counts from.
  lead: number
  player: SectionPlayback
}

// Tenths since the section start, rounded down like the player's display.
function elapsedTenths(seconds: number): number {
  return Math.floor(seconds * 10 + 1e-6)
}

// The play position over the waveforms: a line across the rows and a slider
// to click or step with the keys. The position is written straight into the
// page, so playback moves it without rendering anything.
export function PlayPosition({ rowsRef, section, lead, player }: Props) {
  const { available, length, playing, elapsed, seek, subscribeSeek } = player
  const sliderRef = useRef<HTMLDivElement>(null)
  const lengthTenths = Math.round(length * 10)
  // The last tenth the time display reaches, where End moves to.
  const lastTenths = Math.max(0, lengthTenths - 1)
  const span = section.end - section.start

  // The slider's value is read out on a seek or a render, not every frame:
  // a value that changes ten times a second would talk over the music.
  const paint = useEffectEvent((announce: boolean) => {
    const seconds = elapsed()
    const ratio = span > 0 ? (lead + seconds) / span : 0
    rowsRef.current?.style.setProperty(
      '--played',
      String(Math.min(Math.max(ratio, 0), 1)),
    )
    const slider = sliderRef.current
    if (!announce || !slider) return
    const tenths = elapsedTenths(seconds)
    slider.setAttribute('aria-valuenow', String(tenths / 10))
    slider.setAttribute('aria-valuetext', formatSpokenTime(tenths))
  })

  useLayoutEffect(() => {
    paint(true)
  })

  useEffect(() => subscribeSeek(() => paint(true)), [subscribeSeek])

  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      paint(false)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing])

  return (
    <div
      ref={sliderRef}
      className={styles.position}
      role="slider"
      tabIndex={0}
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={lastTenths / 10}
      aria-disabled={!available}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        if (!available || box.width <= 0) return
        const ratio = Math.min(
          Math.max((event.clientX - box.left) / box.width, 0),
          1,
        )
        seek(Math.round((ratio * span - lead) * 10) / 10)
      }}
      onKeyDown={(event) => {
        const target = keyboardSeek(
          elapsedTenths(elapsed()),
          event,
          lengthTenths,
        )
        if (target === null) return
        // Its keys stay with it, with audio to play or not.
        event.preventDefault()
        if (available) seek(target / 10)
      }}
    >
      <span className={styles.playhead} data-testid="playhead" />
    </div>
  )
}
