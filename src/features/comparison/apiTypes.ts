// Bodies of the performance and comparison API as the backend sends them
// (snake_case). Responses list only the fields the screens use.

export type PerformanceSourceCode = 'RECORDING' | 'UPLOAD'

// One saved take. POST /segments/{segment_id}/performances answers 201 with
// it, adding workspace_id, track_id and segment_id; a list item adds
// track_id.
export interface PerformanceResponse {
  readonly performance_id: number
  readonly source: PerformanceSourceCode
  // The section when the take was saved. A later section change leaves it.
  readonly start_ms: number
  readonly end_ms: number
  readonly created_at: string
}

// GET /segments/{segment_id}/performances, newest first. segment_id also
// arrives. No latest comparison comes with a take yet.
export interface PerformanceListResponse {
  readonly performances: readonly PerformanceResponse[]
}

export type ComparisonStatusValue =
  'queued' | 'processing' | 'success' | 'not_comparable' | 'failed'

export type ComparisonStageName = 'align' | 'transcription' | 'compare'

export type ComparisonStageStatusValue =
  'queued' | 'processing' | 'success' | 'failed' | 'skipped'

// POST /performances/{performance_id}/comparisons: 202 for a new comparison,
// 200 with a finished one the take already has (is_reused). The take, the
// section and the time also arrive.
export interface ComparisonCreatedResponse {
  readonly comparison_id: number
  readonly status: ComparisonStatusValue
}

// POST /comparisons/{comparison_id}/retry: 202, queued again. retry_from and
// the counts also arrive; the stages are read again after.
export type ComparisonRetryResponse = ComparisonCreatedResponse

export interface ComparisonStageView {
  readonly stage: ComparisonStageName
  readonly status: ComparisonStageStatusValue
}

// Present only while failed, as on stems and tabs. message and retry_count
// also arrive.
export interface ComparisonFailureView {
  // Null when the job was given up before its first stage.
  readonly stage: ComparisonStageName | null
  readonly error_code: string
  readonly retryable: boolean
  readonly max_retries: number
  readonly retries_left: number
}

// GET /comparisons/{comparison_id}. A failed job is still 200 and says so in
// failure. updated_at also arrives.
export interface ComparisonStatusResponse {
  readonly comparison_id: number
  readonly status: ComparisonStatusValue
  // Set when a stage starts; while queued between two stages it is the stage
  // that just finished, and after a retry the stage that failed.
  readonly current_stage: ComparisonStageName | null
  readonly not_comparable_reason: string | null
  readonly stages: readonly ComparisonStageView[]
  readonly failure: ComparisonFailureView | null
}

export type ComparisonRegionType =
  'pitch_difference' | 'missing_note' | 'timing_difference' | 'unavailable'

// Times are milliseconds from the section start.
export interface ComparisonRegionView {
  readonly region_id: number
  readonly type: ComparisonRegionType
  readonly start_ms: number
  readonly end_ms: number
  readonly performance_start_ms: number
  readonly performance_end_ms: number
  // Set only for a place the server could not judge.
  readonly reason: string | null
  readonly is_checked: boolean
}

export type BaselineSourceValue = 'original_song' | 'separated_input'

// GET /comparisons/{comparison_id}/result, once success or not_comparable
// (409 COMPARISON_NOT_READY before). is_draft, the baseline's stem, tab and
// section, the slope, summary and config_version also arrive.
export interface ComparisonResultResponse {
  readonly comparison_id: number
  readonly status: 'success' | 'not_comparable'
  readonly not_comparable_reason: string | null
  readonly baseline: { readonly source: BaselineSourceValue }
  readonly overall_tempo: { readonly is_slow: boolean } | null
  readonly regions: readonly ComparisonRegionView[]
}

export type ComparisonTrackType = 'original' | 'stem' | 'performance'

// One sound. url is a signed storage link, null when the sound cannot play.
// label also arrives.
export interface ComparisonPlaybackTrack {
  readonly type: ComparisonTrackType
  readonly available: boolean
  readonly url: string | null
  // Where the section starts inside the file.
  readonly offset_ms: number
}

// GET /comparisons/{comparison_id}/playback, on the same terms as the result.
// tab_id also arrives.
export interface ComparisonPlaybackResponse {
  readonly comparison_id: number
  readonly is_partial: boolean
  readonly tracks: readonly ComparisonPlaybackTrack[]
  readonly expires_at: string
}

// PATCH /comparisons/{comparison_id}/regions/{region_id}.
export interface RegionCheckResponse {
  readonly region_id: number
  readonly is_checked: boolean
}
