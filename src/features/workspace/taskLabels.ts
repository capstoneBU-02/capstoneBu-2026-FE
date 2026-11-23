// The checks and records both repositories make for a task: the labels a
// valid section gets, and the result a revised task keeps (D10).

import {
  checkSectionRange,
  isPolicySectionName,
} from '../new-section/sectionForm.ts'
import { SECTION_POLICY } from '../new-section/sectionPolicy.ts'
import type {
  NewTaskInput,
  PreviousTaskResult,
  WorkspaceSong,
  WorkspaceTask,
} from './model.ts'

// A server would refuse what the screen should never have sent.
export function newTaskLabels(
  input: NewTaskInput,
  song: WorkspaceSong | undefined,
): { partLabel: string; tuningLabel: string } | null {
  const part = SECTION_POLICY.parts.find((option) => option.id === input.part)
  const tuning = SECTION_POLICY.tunings.find(
    (option) => option.id === input.tuningId,
  )
  const valid =
    song !== undefined &&
    part !== undefined &&
    tuning !== undefined &&
    isPolicySectionName(input.sectionName) &&
    checkSectionRange(
      input.rangeStartSeconds,
      input.rangeEndSeconds,
      song.durationSeconds,
    )
  return valid ? { partLabel: part.label, tuningLabel: tuning.label } : null
}

const RESTORED_TUNING_ID = 'e-standard'

// What a task the server lists without this page's record shows for what
// the server does not keep: no part, and E standard, the only tuning the
// server makes tabs in.
export const RESTORED_TASK_LABELS: Pick<
  WorkspaceTask,
  'part' | 'partLabel' | 'tuningId' | 'tuningLabel'
> = {
  part: 'unset',
  partLabel: '파트 미정',
  tuningId: RESTORED_TUNING_ID,
  tuningLabel:
    SECTION_POLICY.tunings.find((option) => option.id === RESTORED_TUNING_ID)
      ?.label ?? RESTORED_TUNING_ID,
}

export function keptResult(
  task: WorkspaceTask,
  id: string,
): PreviousTaskResult {
  return {
    id,
    sectionName: task.sectionName,
    partLabel: task.partLabel,
    tuningLabel: task.tuningLabel,
    rangeStartSeconds: task.rangeStartSeconds,
    rangeEndSeconds: task.rangeEndSeconds,
    comparisonCount: task.comparisonCount,
    copyStatus: task.copyStatus,
  }
}
