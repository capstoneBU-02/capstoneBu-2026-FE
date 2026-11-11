import {
  createSectionForm,
  parseSectionName,
  sectionFormReducer,
  type SectionForm,
} from '../new-section/sectionForm.ts'
import {
  SECTION_POLICY,
  type SectionPolicy,
} from '../new-section/sectionPolicy.ts'
import {
  formatSectionTime,
  secondsToTenths,
} from '../new-section/sectionTime.ts'
import type { ReviseTaskInput, WorkspaceTask } from '../workspace/model.ts'

// 구간 수정 replaces a finished result. A queued or running task has none
// yet; a failed one is sent again, or moved when no guitar was found.
export function canReviseSection(
  task: Pick<WorkspaceTask, 'processingStatus'>,
): boolean {
  return task.processingStatus === 'completed'
}

// The same editor changes a finished section (구간 수정) and moves one where
// separation found no guitar (구간 다시 정하기). A tab failure is sent again
// as it is, and a queued or running task has nothing to change yet.
export type SectionEditKind = 'revise' | 'redefine'

export function sectionEditKind(
  task: Pick<WorkspaceTask, 'processingStatus' | 'failureKind'>,
): SectionEditKind | null {
  if (canReviseSection(task)) return 'revise'
  return task.processingStatus === 'failed' && task.failureKind === 'no-guitar'
    ? 'redefine'
    : null
}

type SectionValues = Pick<
  WorkspaceTask,
  'part' | 'tuningId' | 'rangeStartSeconds' | 'rangeEndSeconds'
>

// Times compare in tenths, the precision of the inputs.
function changesSectionRange(
  task: SectionValues,
  input: ReviseTaskInput,
): boolean {
  return (
    secondsToTenths(task.rangeStartSeconds) !==
      secondsToTenths(input.rangeStartSeconds) ||
    secondsToTenths(task.rangeEndSeconds) !==
      secondsToTenths(input.rangeEndSeconds)
  )
}

// The tab is made from the range, part and tuning; a new name alone keeps it.
export function changesSectionResult(
  task: SectionValues,
  input: ReviseTaskInput,
): boolean {
  return (
    changesSectionRange(task, input) ||
    task.part !== input.part ||
    task.tuningId !== input.tuningId
  )
}

// Separation listens to the range alone, so the same range would find no
// guitar again whatever the part or tuning.
export function canSendSectionEdit(
  task: SectionValues & Pick<WorkspaceTask, 'processingStatus' | 'failureKind'>,
  input: ReviseTaskInput,
): boolean {
  switch (sectionEditKind(task)) {
    case 'revise':
      return changesSectionResult(task, input)
    case 'redefine':
      return changesSectionRange(task, input)
    case null:
      return false
  }
}

// The form opens with the task's values, untouched so no error shows yet.
// A name, part or tuning outside the policy falls back to the policy's first
// entry, so the form never sends a value its inputs cannot show.
export function sectionFormFromTask(
  task: WorkspaceTask,
  policy: SectionPolicy = SECTION_POLICY,
): SectionForm {
  const fresh = createSectionForm(policy)
  const name = parseSectionName(task.sectionName, policy)
  const inPolicy = (options: SectionPolicy['tunings'], id: string) =>
    options.some((option) => option.id === id)
  return {
    ...fresh,
    baseName: name?.baseName ?? fresh.baseName,
    number: name?.number ?? null,
    start: formatSectionTime(secondsToTenths(task.rangeStartSeconds)),
    end: formatSectionTime(secondsToTenths(task.rangeEndSeconds)),
    part: inPolicy(policy.parts, task.part) ? task.part : fresh.part,
    tuningId: inPolicy(policy.tunings, task.tuningId)
      ? task.tuningId
      : fresh.tuningId,
  }
}

// 다른 파일 올리기 starts a new section on the new file. The name and tuning
// still fit; the range and part were chosen for the old file, as when a file
// is replaced.
export function otherFileSectionForm(task: WorkspaceTask): SectionForm {
  return sectionFormReducer(sectionFormFromTask(task), { type: 'replace-file' })
}
