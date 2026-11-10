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

// The separated guitar once there is one to hear, the input until then.
export function preferredTrack(tracks: readonly TaskTrack[]): TrackId {
  return tracks.some(
    (track) => track.id === 'separated' && track.content === 'audio',
  )
    ? 'separated'
    : 'input'
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
