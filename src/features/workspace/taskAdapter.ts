// Readers for the task APIs (segments, stems, tabs) and the values the
// screen's section turns into before it is sent.

import { readObject, readString, type ObjectReader } from '../../api/guards.ts'
import { parseSectionName } from '../new-section/sectionForm.ts'
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
