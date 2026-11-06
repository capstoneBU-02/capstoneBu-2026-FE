import type { SectionPart } from '../workspace/model.ts'

export interface SectionOption<Id extends string = string> {
  readonly id: Id
  readonly label: string
}

export interface SectionPolicy {
  readonly maxDurationSeconds: number
  readonly names: readonly string[]
  readonly maxNumber: number
  readonly parts: readonly SectionOption<SectionPart>[]
  readonly tunings: readonly SectionOption[]
}

// Provisional values. D11 (section minimum/maximum length) and IN-04
// (supported tunings) are still open; the Figma "30초" is a placeholder.
// Change only this object once the policy is confirmed: the inputs, the
// messages and the mock repository check all derive from it. The first entry
// of each list is the default.
export const SECTION_POLICY: SectionPolicy = {
  maxDurationSeconds: 30,
  names: [
    '인트로',
    '벌스',
    '프리코러스',
    '코러스',
    '브리지',
    '인터루드',
    '솔로',
    '아웃트로',
  ],
  maxNumber: 99,
  parts: [
    { id: 'rhythm', label: '리듬 기타' },
    { id: 'lead', label: '리드 기타' },
  ],
  tunings: [
    { id: 'e-standard', label: 'E 표준 6현' },
    { id: 'e-flat', label: 'E♭ 반음 내림 6현' },
    { id: 'drop-d', label: '드롭 D 6현' },
  ],
}
