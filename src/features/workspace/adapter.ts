import {
  readObject,
  ResponseShapeError,
  type ObjectReader,
} from '../../api/guards.ts'
import { songNameFromFileName } from '../add-song/songFile.ts'
import type {
  TrackListResponse,
  TrackResponse,
  TrackUploadResponse,
  WorkspaceMeResponse,
} from './apiTypes.ts'
import type { WorkspaceSong } from './model.ts'

export function readWorkspaceMe(data: unknown): WorkspaceMeResponse {
  return { workspace_id: readObject(data).integer('workspace_id') }
}

function readTrackFields(track: ObjectReader): TrackUploadResponse {
  return {
    track_id: track.integer('track_id'),
    filename: track.string('filename'),
    duration_ms: track.integer('duration_ms'),
    is_separated_stem: track.boolean('is_separated_stem'),
  }
}

export function readTrackUpload(data: unknown): TrackUploadResponse {
  return readTrackFields(readObject(data))
}

function readTrack(value: unknown, path: string): TrackResponse {
  const track = readObject(value, path)
  const count = track.integer('segment_count')
  if (count < 0)
    throw new ResponseShapeError(
      `${path}.segment_count`,
      'a count of zero or more',
    )
  return { ...readTrackFields(track), segment_count: count }
}

export function readTrackList(data: unknown): TrackListResponse {
  return { items: readObject(data).array('items', readTrack) }
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
