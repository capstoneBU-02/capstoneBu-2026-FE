import { useEffect, useEffectEvent, useState } from 'react'
import { WorkspaceRepositoryError } from '../workspace/repository.ts'
import { computePeaks, type WaveformPeaks } from './peaks.ts'

export type SongAudioState =
  | { readonly status: 'loading' }
  // The decoded audio is dropped once measured: a long stereo song takes
  // around 100 MB. Playback loads what it needs on its own.
  | { readonly status: 'ready'; readonly peaks: WaveformPeaks }
  | { readonly status: 'failed' }

export interface SongAudio {
  readonly state: SongAudioState
  // Loading again after a failure, so the retry control can stay in place.
  readonly retrying: boolean
  retry(): void
}

type LoadAudio = (songId: string, signal: AbortSignal) => Promise<Blob>

// Common for music files; the browser resamples on playback if needed.
const DECODE_SAMPLE_RATE = 44_100
const LOADING: SongAudioState = { status: 'loading' }

// Decoding needs no audio output, so it runs without an AudioContext and
// without waiting for a user gesture.
async function decodeSongAudio(blob: Blob): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE)
  return context.decodeAudioData(await blob.arrayBuffer())
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  )
}

interface Request {
  readonly songId: string
  readonly version: number
}

// Loads, decodes and measures a song's audio while the screen is open.
// Leaving the screen or switching songs cancels the work in progress.
export function useSongAudio(
  songId: string,
  load: LoadAudio,
  onExpired: () => void,
): SongAudio {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    request: Request
    state: SongAudioState
  } | null>(null)
  const loadAudio = useEffectEvent(load)
  const reportExpired = useEffectEvent(onExpired)
  const current =
    result?.request.songId === songId && result.request.version === version
      ? result.state
      : LOADING

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const request = { songId, version }

    async function run(): Promise<SongAudioState> {
      const blob = await loadAudio(songId, signal)
      signal.throwIfAborted()
      const buffer = await decodeSongAudio(blob)
      signal.throwIfAborted()
      const peaks = await computePeaks(channelsOf(buffer), buffer.sampleRate, {
        signal,
      })
      return { status: 'ready', peaks }
    }

    run().then(
      (state) => {
        if (!signal.aborted) setResult({ request, state })
      },
      (error: unknown) => {
        if (signal.aborted) return
        if (
          error instanceof WorkspaceRepositoryError &&
          error.code === 'expired'
        ) {
          reportExpired()
          return
        }
        setResult({ request, state: { status: 'failed' } })
      },
    )
    return () => controller.abort()
  }, [songId, version])

  return {
    state: current,
    retrying: version > 0 && current.status === 'loading',
    retry: () => setVersion((previous) => previous + 1),
  }
}
