import {
  createSectionForm,
  parseSectionName,
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
// yet, and a failed one is recovered through #17's 구간 다시 정하기.
export function canReviseSection(
  task: Pick<WorkspaceTask, 'processingStatus'>,
): boolean {
  return task.processingStatus === 'completed'
}

// The tab is made from the range, part and tuning; a new name alone keeps it.
// Times compare in tenths, the precision of the inputs.
export function changesSectionResult(
  task: Pick<
    WorkspaceTask,
    'part' | 'tuningId' | 'rangeStartSeconds' | 'rangeEndSeconds'
  >,
  input: ReviseTaskInput,
): boolean {
  return (
    secondsToTenths(task.rangeStartSeconds) !==
      secondsToTenths(input.rangeStartSeconds) ||
    secondsToTenths(task.rangeEndSeconds) !==
      secondsToTenths(input.rangeEndSeconds) ||
    task.part !== input.part ||
    task.tuningId !== input.tuningId
  )
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
