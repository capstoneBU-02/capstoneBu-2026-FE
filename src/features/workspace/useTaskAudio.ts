import { useState } from 'react'
import { useSongAudio, type SongAudio } from '../waveform/useSongAudio.ts'
import type { TaskDetail } from './model.ts'
import {
  preferredTrack,
  taskTracks,
  trackChoices,
  wantedTrack,
  type TaskTrack,
  type TrackChoice,
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
  // The player's switch; empty for a single track.
  readonly choices: readonly TrackChoice[]
  // Plays this track from now on, while it has audio to play. Only a choice
  // the switch enables takes.
  choose(id: string): void
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
  // The listener's choice holds while its track has audio to play.
  const [choice, setChoice] = useState<TrackId | null>(null)
  const wanted = wantedTrack(tracks, choice)
  // A change the listener did not make waits until playback stops, so a
  // refresh that finishes separation, or finds no guitar after all, never
  // cuts the sound off.
  const [playing, setPlaying] = useState(false)
  const [playback, setPlayback] = useState(wanted)
  if (!playing && playback !== wanted) setPlayback(wanted)
  // The guitar that still plays stays loaded until playback lets it go.
  const separated = useSongAudio(
    preferred === 'separated' || playback === 'separated' ? task.id : null,
    source.loadSeparatedAudio,
    source.onExpired,
  )
  const audio = { input, separated }
  const choices = trackChoices(
    tracks,
    (id) => audio[id]?.state.status === 'ready',
  )
  return {
    tracks,
    audio,
    playback,
    choices,
    choose(id) {
      const option = choices.find(
        (candidate) => candidate.id === id && candidate.enabled,
      )
      if (!option) return
      // The listener's own choice plays at once.
      setChoice(option.id)
      setPlayback(option.id)
    },
    onPlayingChange: setPlaying,
  }
}
