// Request and response bodies of the workspace APIs as the backend sends them
// (snake_case). Responses list only the fields the screens use.

// GET /workspaces/me. owner_type, session_active and created_at also arrive.
export interface WorkspaceMeResponse {
  readonly workspace_id: number
}

// POST /tracks/upload, multipart: `file` and `is_separated_stem` ("true" or
// "false"). media_type and created_at also arrive.
export interface TrackUploadResponse {
  readonly track_id: number
  // The name the file was sent with.
  readonly filename: string
  // Measured by the server and rounded to milliseconds.
  readonly duration_ms: number
  readonly is_separated_stem: boolean
}

// GET /tracks: the workspace's tracks, newest first. media_type and
// created_at also arrive.
export interface TrackListResponse {
  readonly items: readonly TrackResponse[]
}

export interface TrackResponse extends TrackUploadResponse {
  // Only a track with sections is asked for them.
  readonly segment_count: number
}

// Section names the server knows (SEG). It has no solo, and the number in a
// name like "코러스 2" stays on the screen.
export type SegmentNameValue =
  'INTRO' | 'VERSE' | 'PRE_CHORUS' | 'CHORUS' | 'BRIDGE' | 'INTERLUDE' | 'OUTRO'

// POST /tracks/{track_id}/segments. Times are whole milliseconds; a missing
// name stays unset.
export interface SegmentCreateRequest {
  readonly start_ms: number
  readonly end_ms: number
  readonly name?: SegmentNameValue
}

// PATCH /segments/{segment_id}. start_ms and end_ms travel together, name
// cannot be cleared, and an empty body is refused.
export interface SegmentUpdateRequest {
  readonly start_ms?: number
  readonly end_ms?: number
  readonly name?: SegmentNameValue
}

// Both answers above, and each item of GET /tracks/{track_id}/segments.
// track_id, duration_ms and created_at also arrive.
export interface SegmentResponse {
  readonly segment_id: number
  readonly start_ms: number
  readonly end_ms: number
  // One of SegmentNameValue, or null for a section sent without one.
  readonly name: string | null
  // Goes up only when the range or the name changes.
  readonly version: number
  readonly updated_at: string
}

// GET /tracks/{track_id}/segments, by start time and then id. A track of
// another workspace answers 404 TRACK_NOT_FOUND.
export interface SegmentListResponse {
  readonly items: readonly SegmentResponse[]
}

export const STEM_STATUSES = [
  'queued',
  'processing',
  'success',
  'needs_review',
  'failed',
  'canceled',
] as const
export type StemStatusValue = (typeof STEM_STATUSES)[number]

// A tab cannot be cancelled.
export const TAB_STATUSES = [
  'queued',
  'processing',
  'success',
  'needs_review',
  'failed',
] as const
export type TabStatusValue = (typeof TAB_STATUSES)[number]

// POST /segments/{segment_id}/stems: 202 for a new stem, 200 for one reused
// for the same range. segment_id, version, the range, bypass_separation and
// created_at also arrive.
export interface StemCreatedResponse {
  readonly stem_id: number
  readonly status: StemStatusValue
  readonly is_reused: boolean
}

// POST /segments/{segment_id}/tabs. The server takes only these values for
// now (GET /tabs/conditions).
export interface TabCreateRequest {
  readonly result_type: 'original'
  readonly tuning_id: string
  readonly capo: number
}

// 202 for a new tab, 200 for one reused for the same stem and conditions.
// segment_id, stem_id, version and created_at also arrive.
export interface TabCreatedResponse {
  readonly tab_id: number
  readonly status: TabStatusValue
  readonly is_reused: boolean
}

// GET /tabs/{tab_id}/result, only while the tab is success or needs_review
// (409 TAB_NOT_READY otherwise). The ids, version, result_type, status,
// is_draft, segment, tempo_uncertain, review_reasons, summary, musicxml_url
// with its expiry and model also arrive; the tab is drawn from the notes.
export interface TabResultResponse {
  // tuning_id, strings and capo also arrive.
  readonly condition: {
    // Lowest string first: E2 A2 D3 G3 B3 E4.
    readonly tuning_notes: readonly string[]
  }
  readonly tempo_bpm: number
  // Beats over the beat unit, "4/4" for now.
  readonly time_signature: string
  readonly notes: readonly TabResultNote[]
}

// end, pitch, low_confidence, bend and playable also arrive.
export interface TabResultNote {
  // Seconds from the start of the section.
  readonly start: number
  // 1 is the high E string.
  readonly string: number
  readonly fret: number
  // Quarter-note beats from the first bar's first downbeat, on a sixteenth
  // or triplet grid.
  readonly beat: number
  // In beats, already cut at the next onset.
  readonly duration: number
  readonly confidence: number
}

// GET /segments/{segment_id}/processing-status. stem is the newest stem for
// the segment's current range, tab the newest tab made from it; either is
// null until requested. Between two stages the status returns to queued
// while current_stage keeps the stage just finished.
export interface ProcessingStatusResponse {
  readonly segment_id: number
  readonly stem: StemStatusView | null
  readonly tab: TabStatusView | null
  readonly updated_at: string | null
}

export interface StemStatusView {
  readonly stem_id: number
  readonly status: StemStatusValue
  readonly current_stage: string | null
  // The separated guitar can be played.
  readonly playable: boolean
  // Failed and still allowed another try.
  readonly retryable: boolean
}

export interface TabStatusView {
  readonly tab_id: number
  readonly status: TabStatusValue
  readonly current_stage: string | null
  readonly retryable: boolean
}

// The failure of GET /stems/{stem_id} and GET /tabs/{tab_id}, present only
// while failed. stage, message and retry_count also arrive.
export interface FailureView {
  readonly error_code: string
  readonly retryable: boolean
  readonly max_retries: number
  readonly retries_left: number
}

// GET /stems/{stem_id} and GET /tabs/{tab_id}, read only for the failure.
export interface WorkFailureResponse {
  readonly failure: FailureView | null
}

// POST /stems/{stem_id}/retry and POST /tabs/{tab_id}/retry: 202. The id,
// retry_from and the counts also arrive; the task is read again after.
export interface RetryResponse {
  readonly status: string
}

// POST /stems/{stem_id}/cancel, only while queued.
export interface CancelResponse {
  readonly stem_id: number
  readonly status: StemStatusValue
}

// GET /stems/{stem_id}/playback: signed storage URLs, valid until
// expires_at. stem_id and is_partial also arrive.
export interface StemPlaybackResponse {
  readonly tracks: readonly StemPlaybackTrack[]
  readonly expires_at: string
}

export interface StemPlaybackTrack {
  readonly type: string
  readonly available: boolean
  readonly url: string | null
}
