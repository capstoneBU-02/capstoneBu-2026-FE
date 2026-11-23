// Readers for the task APIs (segments, stems, tabs), the values the screen's
// section turns into before it is sent, and a tab result as the renderer's
// converter takes it.

import {
  readObject,
  readString,
  ResponseShapeError,
  type ObjectReader,
} from '../../api/guards.ts'
import { parseSectionName } from '../new-section/sectionForm.ts'
import type { NoteTranscription } from '../tab/scoreFromNotes.ts'
import {
  STEM_STATUSES,
  TAB_STATUSES,
  type CancelResponse,
  type FailureView,
  type ProcessingStatusResponse,
  type RetryResponse,
  type SegmentNameValue,
  type SegmentResponse,
  type StemCreatedResponse,
  type StemPlaybackResponse,
  type StemPlaybackTrack,
  type StemStatusView,
  type TabCreatedResponse,
  type TabCreateRequest,
  type TabResultNote,
  type TabResultResponse,
  type TabStatusView,
  type WorkFailureResponse,
} from './apiTypes.ts'

export function readSegment(data: unknown): SegmentResponse {
  const segment = readObject(data)
  return {
    segment_id: segment.integer('segment_id'),
    start_ms: segment.integer('start_ms'),
    end_ms: segment.integer('end_ms'),
    updated_at: segment.string('updated_at'),
  }
}

export function readStemCreated(data: unknown): StemCreatedResponse {
  const stem = readObject(data)
  return {
    stem_id: stem.integer('stem_id'),
    status: stem.oneOf('status', STEM_STATUSES),
    is_reused: stem.boolean('is_reused'),
  }
}

export function readTabCreated(data: unknown): TabCreatedResponse {
  const tab = readObject(data)
  return {
    tab_id: tab.integer('tab_id'),
    status: tab.oneOf('status', TAB_STATUSES),
    is_reused: tab.boolean('is_reused'),
  }
}

const TIME_SIGNATURE = /^([1-9]\d*)\/([1-9]\d*)$/

function readTimeSignature(value: unknown, path: string): string {
  const text = readString(value, path)
  if (!TIME_SIGNATURE.test(text))
    throw new ResponseShapeError(path, 'a time signature such as 4/4')
  return text
}

function readTabNote(value: unknown, path: string): TabResultNote {
  const note = readObject(value, path)
  return {
    start: note.number('start'),
    string: note.integer('string'),
    fret: note.integer('fret'),
    beat: note.number('beat'),
    duration: note.number('duration'),
    confidence: note.number('confidence'),
  }
}

export function readTabResult(data: unknown): TabResultResponse {
  const tab = readObject(data)
  const condition = tab.object('condition')
  return {
    condition: { tuning_notes: condition.array('tuning_notes', readString) },
    tempo_bpm: tab.number('tempo_bpm'),
    time_signature: readTimeSignature(
      tab.raw('time_signature'),
      `${tab.path}.time_signature`,
    ),
    notes: tab.array('notes', readTabNote),
  }
}

// What the tab renderer's converter takes: the tuning turned highest string
// first and the meter as numbers.
export function tabTranscriptionOf(
  result: TabResultResponse,
): NoteTranscription {
  const [, beats, unit] = TIME_SIGNATURE.exec(result.time_signature) ?? []
  return {
    tuning: [...result.condition.tuning_notes].reverse(),
    timeSignature: [Number(beats), Number(unit)],
    tempoBpm: result.tempo_bpm,
    notes: result.notes.map((note) => ({
      startSeconds: note.start,
      beat: note.beat,
      beats: note.duration,
      string: note.string,
      fret: note.fret,
      confidence: note.confidence,
    })),
  }
}

function readStemStatus(stem: ObjectReader): StemStatusView {
  return {
    stem_id: stem.integer('stem_id'),
    status: stem.oneOf('status', STEM_STATUSES),
    current_stage: stem.nullable('current_stage', readString),
    playable: stem.boolean('playable'),
    retryable: stem.boolean('retryable'),
  }
}

function readTabStatus(tab: ObjectReader): TabStatusView {
  return {
    tab_id: tab.integer('tab_id'),
    status: tab.oneOf('status', TAB_STATUSES),
    current_stage: tab.nullable('current_stage', readString),
    retryable: tab.boolean('retryable'),
  }
}

export function readProcessingStatus(data: unknown): ProcessingStatusResponse {
  const status = readObject(data)
  const stem = status.nullableObject('stem')
  const tab = status.nullableObject('tab')
  return {
    segment_id: status.integer('segment_id'),
    stem: stem && readStemStatus(stem),
    tab: tab && readTabStatus(tab),
    updated_at: status.nullable('updated_at', readString),
  }
}

function readFailure(failure: ObjectReader): FailureView {
  return {
    error_code: failure.string('error_code'),
    retryable: failure.boolean('retryable'),
    max_retries: failure.integer('max_retries'),
    retries_left: failure.integer('retries_left'),
  }
}

export function readWorkFailure(data: unknown): WorkFailureResponse {
  const failure = readObject(data).nullableObject('failure')
  return { failure: failure && readFailure(failure) }
}

export function readRetry(data: unknown): RetryResponse {
  return { status: readObject(data).string('status') }
}

export function readCancel(data: unknown): CancelResponse {
  const cancel = readObject(data)
  return {
    stem_id: cancel.integer('stem_id'),
    status: cancel.oneOf('status', STEM_STATUSES),
  }
}

function readPlaybackTrack(value: unknown, path: string): StemPlaybackTrack {
  const track = readObject(value, path)
  return {
    type: track.string('type'),
    available: track.boolean('available'),
    url: track.nullable('url', readString),
  }
}

export function readStemPlayback(data: unknown): StemPlaybackResponse {
  const playback = readObject(data)
  return {
    tracks: playback.array('tracks', readPlaybackTrack),
    expires_at: playback.string('expires_at'),
  }
}

// Keyed by SECTION_POLICY's names. 솔로 has no server name.
const SEGMENT_NAME_VALUES: Readonly<Record<string, SegmentNameValue>> = {
  인트로: 'INTRO',
  벌스: 'VERSE',
  프리코러스: 'PRE_CHORUS',
  코러스: 'CHORUS',
  브리지: 'BRIDGE',
  인터루드: 'INTERLUDE',
  아웃트로: 'OUTRO',
}

// The server's name for a section name, or undefined for one it lacks. Its
// number stays on the screen.
export function segmentNameValue(
  sectionName: string,
): SegmentNameValue | undefined {
  const parsed = parseSectionName(sectionName)
  return parsed ? SEGMENT_NAME_VALUES[parsed.baseName] : undefined
}

// The section inputs are whole tenths, so rounding only removes float noise.
export function toMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000)
}

// The tunings the server takes (GET /tabs/conditions answers E standard
// only). The other tunings on screen wait for the supported list.
const TAB_TUNINGS: Readonly<Record<string, string>> = {
  'e-standard': 'e_standard',
}

export function tabRequestFor(tuningId: string): TabCreateRequest | null {
  const tuning = Object.hasOwn(TAB_TUNINGS, tuningId)
    ? TAB_TUNINGS[tuningId]
    : undefined
  return tuning ? { result_type: 'original', tuning_id: tuning, capo: 0 } : null
}
