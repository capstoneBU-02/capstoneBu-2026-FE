import {
  createSectionForm,
  parseSectionName,
  sectionFormReducer,
  type SectionForm,
  type SectionFormAction,
} from '../new-section/sectionForm.ts'
import {
  SECTION_POLICY,
  type SectionPolicy,
} from '../new-section/sectionPolicy.ts'
import {
  formatSectionTime,
  secondsToTenths,
} from '../new-section/sectionTime.ts'
import { isTaskInProgress } from '../workspace/format.ts'
import type {
  ReviseTaskInput,
  TaskDetail,
  WorkspaceTask,
} from '../workspace/model.ts'

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

// Why the edit URL of a task shows no form. A task still being made gets its
// tab later; the previous results say it had one before (M9).
export function sectionEditUnavailableText({
  task,
  previousResults,
}: Pick<TaskDetail, 'task' | 'previousResults'>): string {
  if (!isTaskInProgress(task))
    return '타브가 완성된 작업과 기타를 찾지 못한 작업만 구간을 바꿀 수 있어요.'
  const making = previousResults.length > 0 ? '다시 만드는' : '만드는'
  return `타브를 ${making} 중이에요. 타브가 완성되면 구간을 바꿀 수 있어요.`
}

const inPolicy = (options: SectionPolicy['tunings'], id: string) =>
  options.some((option) => option.id === id)

// The form opens with the task's values, untouched so no error shows yet.
// A name, part or tuning outside the policy falls back to the policy's first
// entry, so the form never sends a value its inputs cannot show. A replaced
// name follows the next free number, as a new name does.
export function sectionFormFromTask(
  task: WorkspaceTask,
  policy: SectionPolicy = SECTION_POLICY,
): SectionForm {
  const fresh = createSectionForm(policy)
  const name = parseSectionName(task.sectionName, policy)
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

// Names what sectionFormFromTask replaced, so the change is not silent (M4).
// The particle follows the last noun: 이름은, 파트는, 튜닝은.
export function replacedSectionNotice(
  task: WorkspaceTask,
  policy: SectionPolicy = SECTION_POLICY,
): string | null {
  const replaced = [
    !parseSectionName(task.sectionName, policy) && {
      text: `‘${task.sectionName}’ 이름`,
      particle: '은',
    },
    !inPolicy(policy.parts, task.part) && {
      text: `‘${task.partLabel}’ 파트`,
      particle: '는',
    },
    !inPolicy(policy.tunings, task.tuningId) && {
      text: `‘${task.tuningLabel}’ 튜닝`,
      particle: '은',
    },
  ].filter((value) => value !== false)
  const last = replaced.at(-1)
  if (!last) return null
  const values = replaced.map((value) => value.text).join(', ')
  return `${values}${last.particle} 지금 고를 수 없어서 바꿨어요. 바꾼 값을 확인해 주세요.`
}

// A new name takes its next free number, as on 새 구간, so the renamed
// section does not share a name with another of the song. Its own name
// brings its number back. The number follows the name while it is the
// suggested one or the task's own number on its own name. Any other number
// the user typed, an empty one too, stays with every name.
export function sectionEditReducer(
  task: WorkspaceTask,
  policy: SectionPolicy = SECTION_POLICY,
): (form: SectionForm, action: SectionFormAction) => SectionForm {
  const opened = sectionFormFromTask(task, policy)
  return (form, action) => {
    const next = sectionFormReducer(form, action)
    if (action.type !== 'name') return next
    const followsName =
      form.number === null ||
      (form.baseName === opened.baseName && form.number === opened.number)
    if (!followsName) return next
    const number = next.baseName === opened.baseName ? opened.number : null
    return { ...next, number }
  }
}

// 다른 파일 올리기 starts a new section on the new file. The name and tuning
// still fit; the range and part were chosen for the old file, as when a file
// is replaced.
export function otherFileSectionForm(task: WorkspaceTask): SectionForm {
  return sectionFormReducer(sectionFormFromTask(task), { type: 'replace-file' })
}
