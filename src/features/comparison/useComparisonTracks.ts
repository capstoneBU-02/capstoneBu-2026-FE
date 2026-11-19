import { useState } from 'react'
import { useSongAudio, type SongAudio } from '../waveform/useSongAudio.ts'
import { WorkspaceRepositoryError } from '../workspace/repository.ts'
import type { ListenTrack } from './comparisonListening.ts'
import type { PlaybackTrack, PlaybackTrackKind } from './model.ts'
import {
  ComparisonRepositoryError,
  type ComparisonRepository,
} from './repository.ts'

export type ComparisonTrackAudio = Readonly<
  Record<ListenTrack, SongAudio | null>
>

function isAvailable(
  tracks: readonly PlaybackTrack[],
  kind: PlaybackTrackKind,
) {
  return tracks.some((track) => track.kind === kind && track.available)
}

// The two sounds of an open comparison. Nothing loads until its view is first
// shown, and what loaded stays while the comparison is open.
export function useComparisonTracks({
  repository,
  comparisonId,
  baselineKind,
  tracks,
  visible,
  onExpired,
}: {
  repository: ComparisonRepository | null
  comparisonId: string | null
  baselineKind: PlaybackTrackKind
  tracks: readonly PlaybackTrack[]
  visible: boolean
  onExpired: () => void
}): ComparisonTrackAudio {
  const [opened, setOpened] = useState<string | null>(null)
  if (visible && comparisonId !== null && opened !== comparisonId)
    setOpened(comparisonId)
  const loading = opened === comparisonId ? comparisonId : null

  function idOf(kind: PlaybackTrackKind) {
    return loading !== null && isAvailable(tracks, kind)
      ? `${loading}:${kind}`
      : null
  }

  // Audio loading knows the workspace's expiry, not the comparison's.
  function loaderOf(kind: PlaybackTrackKind) {
    return async (_audioId: string, signal: AbortSignal) => {
      if (repository === null || loading === null)
        throw new ComparisonRepositoryError('audio-unavailable')
      try {
        return await repository.loadTrackAudio(loading, kind, signal)
      } catch (error) {
        if (
          error instanceof ComparisonRepositoryError &&
          error.code === 'expired'
        )
          throw new WorkspaceRepositoryError('expired', error.message)
        throw error
      }
    }
  }

  const baseline = useSongAudio(
    idOf(baselineKind),
    loaderOf(baselineKind),
    onExpired,
  )
  const performance = useSongAudio(
    idOf('performance'),
    loaderOf('performance'),
    onExpired,
  )
  return { baseline, performance }
}
