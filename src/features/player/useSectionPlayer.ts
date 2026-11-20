import {
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SectionRange } from '../waveform/timeline.ts'
import { reportPlaybackDiagnostic } from './playbackDiagnostic.ts'
import {
  createSectionPlayer,
  playableRange,
  type PlayRange,
  type SectionPlayer,
} from './sectionPlayer.ts'

export interface SectionPlayback {
  // The decoded audio covers some of the section.
  readonly available: boolean
  // Seconds that play: the section, cut where the decoded audio ends.
  readonly length: number
  readonly playing: boolean
  // The output has been resuming long enough to say so; not playing yet.
  readonly pending: boolean
  readonly failed: boolean
  readonly failureCount: number
  readonly repeat: boolean
  // 0 to 1; muting keeps it for unmuting.
  readonly volume: number
  readonly muted: boolean
  toggle(): void
  // Stops the sound, wherever it came from, and keeps the time.
  pause(): void
  // The section once from its start, or this many seconds after it,
  // whatever the repeat button says, until it ends or pause() is called.
  playOnce(from?: number): void
  restart(): void
  // To this many seconds after the section start.
  seek(elapsed: number): void
  setRepeat(repeat: boolean): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  // Seconds since the section start, read on demand so that playback time
  // never re-renders anything by itself.
  elapsed(): number
  // Calls the listener whenever the time jumps: back to the start, to a
  // sought position, or with new audio or a new section. Returns the
  // unsubscribe. Stable for the screen's lifetime.
  subscribeSeek(listener: () => void): () => void
}

const DEFAULT_VOLUME = 0.8
// An output still resuming after this long is shown as waiting. WebKit opens
// a new output suspended, so an ordinary first play resumes it too; that
// takes milliseconds, and showing it would flash the waiting state.
const WAITING_NOTICE_MS = 500

function playRange(
  startTenths: number | null,
  endTenths: number | null,
): PlayRange | null {
  return startTenths === null || endTenths === null
    ? null
    : { start: startTenths / 10, end: endTenths / 10 }
}

function lengthOf(range: PlayRange | null): number {
  return range ? range.end - range.start : 0
}

function openAudioContext(): AudioContext {
  return new AudioContext()
}

// Playback of the selected section while a screen is open. One player serves
// the screen: other audio of the section, such as another track, plays on
// from the same time through the same output. The output opens on the first
// play and closes when the screen goes.
export function useSectionPlayer(
  buffer: AudioBuffer | null,
  range: SectionRange | null,
): SectionPlayback {
  // A source is scheduled, whether or not the output has resumed yet.
  const [scheduled, setScheduled] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [failureCount, setFailureCount] = useState(0)
  const [failedAudio, setFailedAudio] = useState<AudioBuffer | null>(null)
  // An output failure belongs to its audio, not the next selected track.
  if (failedAudio && failedAudio !== buffer) setFailedAudio(null)
  const [repeat, setRepeatState] = useState(true)
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME)
  const [muted, setMutedState] = useState(false)
  const playerRef = useRef<SectionPlayer | null>(null)
  const syncPlayback = () => {
    const player = playerRef.current
    setScheduled(player?.playing() ?? false)
    if (player?.pending()) {
      // One timer for the whole wait: a seek meanwhile replaces the source
      // without starting the wait over.
      waitTimerRef.current ??= setTimeout(
        () => setWaiting(playerRef.current?.pending() ?? false),
        WAITING_NOTICE_MS,
      )
      return
    }
    if (waitTimerRef.current !== null) clearTimeout(waitTimerRef.current)
    waitTimerRef.current = null
    setWaiting(false)
  }
  // The audio last given, null while the next one loads. A section changes
  // the player only together with it, so a section given for audio still
  // loading never moves the one the player has.
  const loadedRef = useRef<AudioBuffer | null>(null)
  const listenersRef = useRef(new Set<() => void>())
  const notifySeek = () => {
    for (const listener of listenersRef.current) listener()
  }
  const startTenths = range?.startTenths ?? null
  const endTenths = range?.endTenths ?? null
  const requested = playRange(startTenths, endTenths)
  const playable = buffer && playableRange(requested, buffer.duration)
  const available = Boolean(playable)

  const load = useEffectEvent((audio: AudioBuffer) => {
    const section = playRange(startTenths, endTenths)
    const current = playerRef.current
    if (current) {
      current.switchAudio(audio, section)
      syncPlayback()
      return
    }
    const player = createSectionPlayer(audio, {
      createContext: openAudioContext,
      onStop: syncPlayback,
      onChange: syncPlayback,
      onError: (diagnostic) => {
        syncPlayback()
        setFailedAudio(loadedRef.current)
        setFailureCount((count) => count + 1)
        notifySeek()
        reportPlaybackDiagnostic(diagnostic)
      },
      repeat,
      volume: muted ? 0 : volume,
    })
    player.setRange(section)
    playerRef.current = player
  })

  // The time displays below this screen paint in their own layout effects,
  // which run before these. Each change tells them to paint again, still
  // before the browser shows the commit.
  useLayoutEffect(() => {
    loadedRef.current = buffer
    if (buffer) load(buffer)
    else {
      // Nothing to hear until the audio loads; the time stays where it was.
      const player = playerRef.current
      if (player?.playing()) {
        player.pause()
        syncPlayback()
      }
    }
    notifySeek()
  }, [buffer])

  // New audio gets its section from the effect above; this one moves the
  // section of the audio already there.
  useLayoutEffect(() => {
    if (!loadedRef.current) return
    playerRef.current?.setRange(playRange(startTenths, endTenths))
    notifySeek()
  }, [startTenths, endTenths])

  useLayoutEffect(
    () => () => {
      playerRef.current?.dispose()
      playerRef.current = null
      if (waitTimerRef.current !== null) clearTimeout(waitTimerRef.current)
      waitTimerRef.current = null
      setScheduled(false)
      setWaiting(false)
    },
    [],
  )

  const elapsed = useCallback(() => playerRef.current?.elapsed() ?? 0, [])
  const subscribeSeek = useCallback((listener: () => void) => {
    const listeners = listenersRef.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return {
    available,
    // Before the audio loads, the section as chosen.
    length: lengthOf(buffer ? playable : requested),
    playing: scheduled && !waiting,
    pending: waiting,
    failed: failedAudio !== null && failedAudio === buffer && available,
    failureCount,
    repeat,
    volume,
    muted,
    toggle() {
      const player = playerRef.current
      if (!player || !available) return
      if (player.playing()) player.pause()
      else {
        setFailedAudio(null)
        player.play()
      }
      syncPlayback()
    },
    pause() {
      const player = playerRef.current
      if (!player) return
      player.pause()
      player.setRepeat(repeat)
      syncPlayback()
    },
    playOnce(from = 0) {
      const player = playerRef.current
      if (!player || !available) return
      setFailedAudio(null)
      player.setRepeat(false)
      player.seek(from)
      player.play()
      syncPlayback()
      notifySeek()
    },
    restart() {
      const player = playerRef.current
      if (!player || !available) return
      player.restart()
      notifySeek()
    },
    seek(seconds) {
      const player = playerRef.current
      if (!player || !available) return
      player.seek(seconds)
      notifySeek()
    },
    setRepeat(next) {
      setRepeatState(next)
      playerRef.current?.setRepeat(next)
    },
    setVolume(next) {
      setVolumeState(next)
      setMutedState(false)
      playerRef.current?.setVolume(next)
    },
    setMuted(next) {
      setMutedState(next)
      playerRef.current?.setVolume(next ? 0 : volume)
    },
    elapsed,
    subscribeSeek,
  }
}
