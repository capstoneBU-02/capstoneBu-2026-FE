// Bodies of the performance API as the backend sends them (snake_case).
// Responses list only the fields the screens use.

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
