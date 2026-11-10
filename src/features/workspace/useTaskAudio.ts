import { useState } from 'react'
import { useSongAudio, type SongAudio } from '../waveform/useSongAudio.ts'
import type { TaskDetail } from './model.ts'
import {
  preferredTrack,
  taskTracks,
  type TaskTrack,
  type TrackId,
} from './tracks.ts'

export interface TaskAudioSource {
  loadSongAudio(songId: string, signal: AbortSignal): Promise<Blob>
  loadSeparatedAudio(taskId: string, signal: AbortSignal): Promise<Blob>
  onExpired(): void
}

export interface TaskAudio {
  readonly tracks: readonly TaskTrack[]
  // Each track's audio; null for a track without a waveform to load.
  readonly audio: Readonly<Record<TrackId, SongAudio | null>>
  // The track the player plays.
  readonly playback: TrackId
  onPlayingChange(playing: boolean): void
}

// The task's tracks and their audio while the task is open. The input loads
// right away, the separated guitar once there is one.
export function useTaskAudio(
  { task, song }: TaskDetail,
  source: TaskAudioSource,
): TaskAudio {
  const tracks = taskTracks(task, song.inputKind)
  const preferred = preferredTrack(tracks)
  const input = useSongAudio(song.id, source.loadSongAudio, source.onExpired)
  // Playback keeps its track until it stops, so a refresh that finishes
  // separation, or finds no guitar after all, never cuts the sound off.
  const [playing, setPlaying] = useState(false)
  const [playback, setPlayback] = useState(preferred)
  if (!playing && playback !== preferred) setPlayback(preferred)
  // The guitar that still plays stays loaded until playback lets it go.
  const separated = useSongAudio(
    preferred === 'separated' || playback === 'separated' ? task.id : null,
    source.loadSeparatedAudio,
    source.onExpired,
  )
  return {
    tracks,
    audio: { input, separated },
    playback,
    onPlayingChange: setPlaying,
  }
}
