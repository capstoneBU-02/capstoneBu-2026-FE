import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from 'react'
import { formatSectionTime } from '../new-section/sectionTime.ts'
import type { SectionRange } from '../waveform/timeline.ts'
import {
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RestartIcon,
  VolumeIcon,
} from './PlayerIcons.tsx'
import { useSectionPlayer } from './useSectionPlayer.ts'
import styles from './PlayerBar.module.css'

type Props = {
  // The decoded song; null while it loads or when it failed.
  buffer: AudioBuffer | null
  range: SectionRange | null
  // The name of the track that plays, on screens built from tracks.
  source?: string
  onPlayingChange?: (playing: boolean) => void
}

// Rounded down, so the display never reads the full length before wrapping.
function formatElapsed(seconds: number): string {
  return formatSectionTime(Math.floor(seconds * 10 + 1e-6))
}

function paintTime(element: HTMLElement | null, seconds: number): void {
  if (!element) return
  const text = formatElapsed(seconds)
  if (element.textContent !== text) element.textContent = text
}

export function PlayerBar({ buffer, range, source, onPlayingChange }: Props) {
  const playback = useSectionPlayer(buffer, range)
  const { available, length, playing, repeat, volume, muted, elapsed } =
    playback
  const timeRef = useRef<HTMLSpanElement>(null)
  const percent = Math.round(volume * 100)
  const reportPlaying = useEffectEvent((next: boolean) =>
    onPlayingChange?.(next),
  )

  useEffect(() => {
    reportPlaying(playing)
  }, [playing])

  // The playback time is written straight into the element, which React
  // leaves empty: a frame updates one text node and renders nothing.
  useLayoutEffect(() => {
    paintTime(timeRef.current, elapsed())
  })

  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      paintTime(timeRef.current, elapsed())
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, elapsed])

  return (
    <section className={styles.bar} aria-label="구간 재생">
      <div className={styles.row}>
        <div className={styles.transport}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="구간 처음으로"
            aria-disabled={!available}
            onClick={() => {
              if (!available) return
              playback.restart()
              paintTime(timeRef.current, elapsed())
            }}
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            className={styles.play}
            aria-label={playing ? '일시정지' : '재생'}
            aria-disabled={!available}
            onClick={() => {
              if (available) playback.toggle()
            }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.repeat}`}
            aria-label="구간 반복"
            aria-pressed={repeat}
            onClick={() => playback.setRepeat(!repeat)}
          >
            <RepeatIcon />
          </button>
        </div>
        <p className={styles.time}>
          <span
            ref={timeRef}
            className={styles.elapsed}
            data-testid="elapsed"
          />
          <span className={styles.length}>
            / {formatSectionTime(Math.round(length * 10))}
          </span>
        </p>
        {source && (
          <p className={styles.source}>
            <span className={styles.hidden}>재생 트랙 </span>
            {source}
          </p>
        )}
        <div className={styles.output}>
          {/* The repeat button's pressed state says the same to assistive tech. */}
          <span className={styles.mode} aria-hidden="true">
            {repeat ? '선택 구간 반복' : '선택 구간 한 번 재생'}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="음소거"
            aria-pressed={muted}
            onClick={() => playback.setMuted(!muted)}
          >
            <VolumeIcon muted={muted || volume === 0} />
          </button>
          <input
            type="range"
            className={styles.volume}
            min={0}
            max={100}
            step={1}
            value={percent}
            aria-label="볼륨"
            aria-valuetext={`${percent}%`}
            data-muted={muted}
            style={{ '--fill': `${percent}%` } as CSSProperties}
            onChange={(event) =>
              playback.setVolume(Number(event.currentTarget.value) / 100)
            }
          />
        </div>
      </div>
    </section>
  )
}
