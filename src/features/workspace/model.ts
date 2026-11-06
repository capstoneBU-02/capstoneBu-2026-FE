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

export interface WorkspaceTask {
  readonly id: string
  readonly songId: string
  readonly sectionName: string
  readonly partLabel: string
  readonly tuningLabel: string
  readonly rangeStartSeconds: number
  readonly rangeEndSeconds: number
  readonly processingStatus: 'completed' | 'processing' | 'failed'
  readonly failureKind: 'transcription' | 'no-guitar' | null
  readonly progressPercent: number | null
  readonly hasSeparatedAudio: boolean
  readonly comparisonCount: number
  readonly copyStatus: 'confirmed' | 'needs-review' | 'unreviewed'
  readonly updatedAtLabel: string
}

export interface TaskDetail {
  readonly task: WorkspaceTask
  readonly song: WorkspaceSong
}

export interface WorkspaceSnapshot {
  readonly workspace: WorkspaceInfo
  readonly songs: readonly WorkspaceSong[]
  readonly tasks: readonly WorkspaceTask[]
  readonly consentChoice: ConsentChoice
}
