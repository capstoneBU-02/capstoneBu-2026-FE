export type DemoScenario =
  'default' | 'empty' | 'error' | 'expired' | 'consent-error'

export type ConsentChoice = 'undecided' | 'accepted' | 'declined'
export type SavedConsentChoice = Exclude<ConsentChoice, 'undecided'>

export interface WorkspaceInfo {
  readonly id: string
  readonly name: string
  readonly testerCode: string
}

// Screen domain data. These shapes do not prescribe the future API response;
// an adapter will map the confirmed API into them.
export type SongInputKind = 'original' | 'separated-guitar'

export interface WorkspaceSong {
  readonly id: string
  readonly name: string
  readonly fileName: string
  readonly inputKind: SongInputKind
  readonly durationSeconds: number
}

// What the add-song dialog hands to the repository. The file stays in memory;
// the mock never transmits it.
export interface NewSongInput {
  readonly file: File
  readonly inputKind: SongInputKind
  readonly durationSeconds: number
}

export type SectionPart = 'rhythm' | 'lead'

// What the new-section screen hands to the repository. Labels for the part
// and tuning come from the repository, not from the screen.
export interface NewTaskInput {
  readonly songId: string
  readonly sectionName: string
  readonly part: SectionPart
  readonly tuningId: string
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
}

// What 구간 수정 hands to the repository: the task keeps its song.
export type ReviseTaskInput = Omit<NewTaskInput, 'songId'>

export interface WorkspaceTask {
  readonly id: string
  readonly songId: string
  readonly sectionName: string
  // The ids prefill 구간 수정; the labels are what the screens show.
  readonly part: SectionPart
  readonly tuningId: string
  readonly partLabel: string
  readonly tuningLabel: string
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
  // queued: created and waiting for its turn before separation starts.
  readonly processingStatus: 'queued' | 'processing' | 'completed' | 'failed'
  readonly failureKind: 'transcription' | 'no-guitar' | null
  readonly progressPercent: number | null
  readonly hasSeparatedAudio: boolean
  readonly comparisonCount: number
  readonly copyStatus: 'confirmed' | 'needs-review' | 'unreviewed'
  readonly updatedAtLabel: string
}

// A result kept when its task's section changed (D10, SEG-04). It carries the
// section it was made from, so it is never shown as the new section's result.
export interface PreviousTaskResult {
  readonly id: string
  readonly sectionName: string
  readonly partLabel: string
  readonly tuningLabel: string
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
  readonly comparisonCount: number
  readonly copyStatus: WorkspaceTask['copyStatus']
}

// Separation and transcription succeed or fail separately (JOB-01).
// Separated-guitar input skips separation (JOB-02).
export type TaskStageId = 'separation' | 'transcription'
export type TaskStageStatus =
  'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export interface TaskStage {
  readonly id: TaskStageId
  readonly status: TaskStageStatus
}

export interface TaskDetail {
  readonly task: WorkspaceTask
  readonly song: WorkspaceSong
  // Newest first. The storage limit per workspace (D10) is still open.
  readonly previousResults: readonly PreviousTaskResult[]
  // Separation first, then transcription.
  readonly stages: readonly TaskStage[]
  // Tasks ahead of a queued task; null when not queued or not known.
  readonly queueAhead: number | null
}

export interface WorkspaceSnapshot {
  readonly workspace: WorkspaceInfo
  readonly songs: readonly WorkspaceSong[]
  readonly tasks: readonly WorkspaceTask[]
  readonly consentChoice: ConsentChoice
}
