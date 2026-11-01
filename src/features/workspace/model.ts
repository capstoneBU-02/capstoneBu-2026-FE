export type DemoScenario =
  'default' | 'empty' | 'error' | 'expired' | 'consent-error'

export type ConsentChoice = 'undecided' | 'accepted' | 'declined'
export type SavedConsentChoice = Exclude<ConsentChoice, 'undecided'>

export interface WorkspaceInfo {
  readonly id: string
  readonly name: string
  readonly testerCode: string
}

// Screen domain data. This shape does not prescribe the future API response.
export interface WorkspaceTask {
  readonly id: string
  readonly sectionName: string
  readonly songName: string
  readonly partLabel: string
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

export interface WorkspaceSnapshot {
  readonly workspace: WorkspaceInfo
  readonly tasks: readonly WorkspaceTask[]
  readonly consentChoice: ConsentChoice
}
