import type { TaskRetry, TaskStageStatus } from '../workspace/model.ts'

// Screen domain data for PoC 2. Times are seconds, as on every other screen;
// an adapter will map the API's milliseconds and codes into these shapes.

export type PerformanceSource = 'recording' | 'upload'

export type ComparisonState =
  'queued' | 'processing' | 'success' | 'not-comparable' | 'failed'

export interface ComparisonRef {
  readonly id: string
  readonly state: ComparisonState
}

// Named apart from the browser's global Performance.
export interface SavedPerformance {
  readonly id: string
  readonly taskId: string
  readonly source: PerformanceSource
  // The section when it was played. It never follows a later section change,
  // which is how the screen tells a take from an earlier section (REC-04).
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
  readonly createdAtLabel: string
  // Measured in the browser; the API does not report it, so a take from an
  // earlier session may have none.
  readonly durationSeconds: number | null
  // Asked of the backend so a kept result can be opened again (REC-04).
  readonly latestComparison: ComparisonRef | null
}

export interface NewPerformanceInput {
  readonly taskId: string
  readonly source: PerformanceSource
  readonly audio: Blob
  readonly durationSeconds: number
}

export type ComparisonStageId = 'align' | 'transcription' | 'compare'

export interface ComparisonStage {
  readonly id: ComparisonStageId
  readonly status: TaskStageStatus
}

export interface ComparisonFailure {
  readonly stage: ComparisonStageId
  readonly code: string
  // Set for a failure that can be sent again, even with no tries left.
  readonly retry: TaskRetry | null
}

export interface ComparisonStatus {
  readonly id: string
  readonly state: ComparisonState
  // While queued between stages this is the stage that just finished.
  readonly currentStage: ComparisonStageId | null
  readonly stages: readonly ComparisonStage[]
  // The server's code, kept as sent: its full list is still open.
  readonly notComparableReason: string | null
  readonly failure: ComparisonFailure | null
}

export type ComparisonRegionKind =
  'pitch-difference' | 'missing-note' | 'timing-difference' | 'unavailable'

export interface ComparisonRegion {
  readonly id: string
  readonly kind: ComparisonRegionKind
  // Seconds from the section start, on the baseline sound.
  readonly startSeconds: number
  readonly endSeconds: number
  // The same place in the performance file.
  readonly performanceStartSeconds: number
  readonly performanceEndSeconds: number
  // The server's code, set only for a place it could not compare (CMP-05).
  readonly unavailableReason: string | null
  readonly checked: boolean
}

export interface ComparisonResult {
  readonly comparisonId: string
  readonly state: 'success' | 'not-comparable'
  readonly notComparableReason: string | null
  // What the performance was compared against (CMP-01).
  readonly baseline: 'original-song' | 'separated-input'
  // Null when the comparison ended before aligning the two (CMP-02).
  readonly overallTempo: { readonly isSlow: boolean } | null
  readonly regions: readonly ComparisonRegion[]
}

export type PlaybackTrackKind = 'original' | 'stem' | 'performance'

export interface PlaybackTrack {
  readonly kind: PlaybackTrackKind
  readonly available: boolean
  // Where the section starts inside this track's file.
  readonly offsetSeconds: number
}

export interface ComparisonPlayback {
  readonly comparisonId: string
  // A sound that cannot play leaves the others to check (CMP-04).
  readonly isPartial: boolean
  readonly tracks: readonly PlaybackTrack[]
}
