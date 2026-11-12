import { useReducer, useState, type ReactNode } from 'react'
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
import {
  canSendSectionEdit,
  replacedSectionNotice,
  sectionEditReducer,
  sectionFormFromTask,
  type SectionEditKind,
} from './sectionEdit.ts'

type Props = {
  // A task sectionEditKind accepts; WorkspacePage turns the others away.
  task: WorkspaceTask
  kind: SectionEditKind
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

interface EditText extends SectionEditorText {
  readonly intro: string
  readonly blocked: string
}

const TEXT: Record<SectionEditKind, Omit<EditText, 'current'>> = {
  revise: {
    title: '구간 수정',
    submit: '타브 다시 만들기',
    // The request only queues the task; the tab is made after it.
    submitting: '타브 다시 만들기를 요청하고 있어요.',
    failed:
      '타브를 다시 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.',
    intro:
      '구간을 바꾸면 타브를 새로 만들어요. 지금 타브는 이전 결과로 남아요.',
    // The name is part of 구간 too, so say what the tab is made from.
    blocked:
      '시작이나 끝, 파트, 튜닝 중 하나를 바꿔야 타브를 다시 만들 수 있어요. 이름만 바꿀 수는 없어요.',
  },
  // The section found no guitar, so there is no tab to keep or remake.
  redefine: {
    title: '구간 다시 정하기',
    submit: '타브 만들기',
    submitting: '타브 만들기를 요청하고 있어요.',
    failed:
      '구간을 바꾸지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.',
    intro: '기타가 잘 들리는 구간으로 바꾸면 기타 분리부터 다시 시작해요.',
    blocked:
      '시작이나 끝을 바꿔야 타브를 만들 수 있어요. 같은 범위에서는 기타를 다시 찾지 못할 수 있어요.',
  },
}

// The change is not kept as a draft: leaving the screen drops it, and the
// next visit starts from the task again.
export function EditSectionScreen({
  task,
  kind,
  song,
  songTasks,
  onCancel,
  onSubmit,
  onRevised,
  loadAudio,
  onExpired,
  notice,
}: Props) {
  // Both follow the task as it was opened, as the form does.
  const [{ reducer, replaced }] = useState(() => ({
    reducer: sectionEditReducer(task),
    replaced: replacedSectionNotice(task),
  }))
  const [form, dispatch] = useReducer(reducer, task, sectionFormFromTask)
  const { intro, blocked, ...text } = TEXT[kind]
  return (
    <SectionEditor
      song={song}
      text={{ ...text, current: task.sectionName }}
      otherSections={songTasks.filter((other) => other.id !== task.id)}
      form={form}
      onChange={dispatch}
      onCancel={onCancel}
      intro={replaced ? [intro, replaced] : [intro]}
      blockedReason={(request) =>
        canSendSectionEdit(task, request) ? null : blocked
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
