import { readObject } from '../../api/guards.ts'
import { songNameFromFileName } from '../add-song/songFile.ts'
import type { TrackUploadResponse, WorkspaceMeResponse } from './apiTypes.ts'
import type { WorkspaceSong } from './model.ts'

export function readWorkspaceMe(data: unknown): WorkspaceMeResponse {
  return { workspace_id: readObject(data).integer('workspace_id') }
}

export function readTrackUpload(data: unknown): TrackUploadResponse {
  const track = readObject(data)
  return {
    track_id: track.integer('track_id'),
    filename: track.string('filename'),
    duration_ms: track.integer('duration_ms'),
    is_separated_stem: track.boolean('is_separated_stem'),
  }
}

// The server's length, not the browser's, so the section editor and the
// server agree on where the song ends.
export function toWorkspaceSong(track: TrackUploadResponse): WorkspaceSong {
  return {
    id: String(track.track_id),
    name: songNameFromFileName(track.filename),
    fileName: track.filename,
    inputKind: track.is_separated_stem ? 'separated-guitar' : 'original',
    durationSeconds: track.duration_ms / 1000,
  }
}
