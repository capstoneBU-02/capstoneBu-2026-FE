import type { SectionRange, TimeWindow } from '../waveform/timeline.ts'
import type { SongInputKind, WorkspaceTask } from './model.ts'

// separated: the guitar the task separated from the section.
// input: the uploaded song, which is the guitar itself for separated input.
export type TrackId = 'separated' | 'input'

// audio: a waveform to load; pending: separation has not finished;
// flat: separation found almost no guitar; missing: separation failed.
export type TrackContent = 'audio' | 'pending' | 'flat' | 'missing'

export interface TaskTrack {
  readonly id: TrackId
  readonly label: string
  readonly content: TrackContent
}

type TrackTask = Pick<
  WorkspaceTask,
  'processingStatus' | 'failureKind' | 'hasSeparatedAudio'
>
type TaskSection = Pick<WorkspaceTask, 'rangeStartSeconds' | 'rangeEndSeconds'>

function separatedContent(task: TrackTask): TrackContent {
  if (task.failureKind === 'no-guitar') return 'flat'
  if (task.hasSeparatedAudio) return 'audio'
  // A failed task without the guitar failed to separate it, as its stages say.
  return task.processingStatus === 'failed' ? 'missing' : 'pending'
}

// Rows top to bottom. Separated-guitar input skips separation (JOB-02);
// a failed tab keeps the separated guitar (JOB-04).
export function taskTracks(
  task: TrackTask,
  inputKind: SongInputKind,
): readonly TaskTrack[] {
  if (inputKind === 'separated-guitar')
    return [{ id: 'input', label: '올린 음원', content: 'audio' }]
  return [
    { id: 'separated', label: '분리 기타', content: separatedContent(task) },
    { id: 'input', label: '원곡', content: 'audio' },
  ]
}

const hasAudio = (tracks: readonly TaskTrack[], id: TrackId) =>
  tracks.some((track) => track.id === id && track.content === 'audio')

// The separated guitar once there is one to hear, the input until then.
export function preferredTrack(tracks: readonly TaskTrack[]): TrackId {
  return hasAudio(tracks, 'separated') ? 'separated' : 'input'
}

// The track the listener chose while it has audio to play, the preferred
// one otherwise.
export function wantedTrack(
  tracks: readonly TaskTrack[],
  choice: TrackId | null,
): TrackId {
  return choice !== null && hasAudio(tracks, choice)
    ? choice
    : preferredTrack(tracks)
}

export interface TrackChoice {
  readonly id: TrackId
  readonly label: string
  readonly enabled: boolean
}

// The player's switch, the original first. A single track has nothing to
// switch to. A track shows but cannot be chosen until its audio is ready to
// play: without audio, still loading, or failed to load.
export function trackChoices(
  tracks: readonly TaskTrack[],
  playable: (id: TrackId) => boolean,
): readonly TrackChoice[] {
  if (tracks.length < 2) return []
  return [...tracks].reverse().map((track) => ({
    id: track.id,
    label: track.label,
    enabled: track.content === 'audio' && playable(track.id),
  }))
}

// Seconds within the track's own audio. The input is the whole song; the
// separated guitar covers only the section and starts at its start.
export function trackWindow(id: TrackId, task: TaskSection): TimeWindow {
  return id === 'input'
    ? { start: task.rangeStartSeconds, end: task.rangeEndSeconds }
    : { start: 0, end: task.rangeEndSeconds - task.rangeStartSeconds }
}

// The same span in whole tenths, for the player. Both tracks round to the
// same length, so switching tracks keeps the length the player shows.
export function trackRange(id: TrackId, task: TaskSection): SectionRange {
  const startTenths = Math.round(task.rangeStartSeconds * 10)
  const endTenths = Math.round(task.rangeEndSeconds * 10)
  return id === 'input'
    ? { startTenths, endTenths }
    : { startTenths: 0, endTenths: endTenths - startTenths }
}

// Seconds from the start of the track's window to where its player counts
// from. The input plays from the section start rounded to tenths; the
// separated guitar from its own start.
export function trackLead(id: TrackId, task: TaskSection): number {
  return trackRange(id, task).startTenths / 10 - trackWindow(id, task).start
}
