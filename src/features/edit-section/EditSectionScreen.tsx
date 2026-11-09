import { useReducer, type ReactNode } from 'react'
import { sectionFormReducer } from '../new-section/sectionForm.ts'
import {
  SectionEditor,
  type SectionEditorText,
} from '../new-section/SectionEditor.tsx'
import type {
  ReviseTaskInput,
  WorkspaceSong,
  WorkspaceTask,
} from '../workspace/model.ts'
import type { ReviseTaskResult } from '../workspace/useWorkspace.ts'
import { changesSectionResult, sectionFormFromTask } from './sectionEdit.ts'

type Props = {
  // A finished task; WorkspacePage turns the others away.
  task: WorkspaceTask
  song: WorkspaceSong
  // All of the song's tasks, the edited one included.
  songTasks: readonly WorkspaceTask[]
  onCancel: () => void
  onSubmit: (
    taskId: string,
    input: ReviseTaskInput,
    signal: AbortSignal,
  ) => Promise<ReviseTaskResult>
  onRevised: (task: WorkspaceTask) => void
  loadAudio: (songId: string, signal: AbortSignal) => Promise<Blob>
  onExpired: () => void
  notice?: ReactNode
}

const NOTICE =
  '구간을 바꾸면 타브를 새로 만들어요. 지금 타브는 이전 결과로 남아요.'
// The name is part of 구간 too, so say what the tab is made from.
const UNCHANGED =
  '시작이나 끝, 파트, 튜닝 중 하나를 바꿔야 타브를 다시 만들 수 있어요. 이름만 바꿀 수는 없어요.'

// The change is not kept as a draft: leaving the screen drops it, and the
// next visit starts from the task again.
export function EditSectionScreen({
  task,
  song,
  songTasks,
  onCancel,
  onSubmit,
  onRevised,
  loadAudio,
  onExpired,
  notice,
}: Props) {
  const [form, dispatch] = useReducer(
    sectionFormReducer,
    task,
    sectionFormFromTask,
  )
  const text: SectionEditorText = {
    title: '구간 수정',
    current: task.sectionName,
    submit: '타브 다시 만들기',
    // The request only queues the task; the tab is made after it.
    submitting: '타브 다시 만들기를 요청하고 있어요.',
    failed:
      '타브를 다시 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.',
  }
  return (
    <SectionEditor
      song={song}
      text={text}
      otherSections={songTasks.filter((other) => other.id !== task.id)}
      form={form}
      onChange={dispatch}
      onCancel={onCancel}
      intro={NOTICE}
      blockedReason={(request) =>
        changesSectionResult(task, request) ? null : UNCHANGED
      }
      onSubmit={async (request, signal) => {
        const result = await onSubmit(task.id, request, signal)
        return result.status === 'revised'
          ? { status: 'saved', task: result.task }
          : result
      }}
      onSaved={onRevised}
      loadAudio={loadAudio}
      onExpired={onExpired}
      notice={notice}
    />
  )
}
