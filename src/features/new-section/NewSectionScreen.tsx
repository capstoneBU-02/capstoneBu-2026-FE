import type { ReactNode } from 'react'
import type {
  NewTaskInput,
  WorkspaceSong,
  WorkspaceTask,
} from '../workspace/model.ts'
import type { CreateTaskResult } from '../workspace/useWorkspace.ts'
import type { SectionForm, SectionFormAction } from './sectionForm.ts'
import { SectionEditor, type SectionEditorText } from './SectionEditor.tsx'

type Props = {
  song: WorkspaceSong
  // The song's tasks: drawn on the waveform and used for the next number.
  songTasks: readonly WorkspaceTask[]
  form: SectionForm
  onChange: (action: SectionFormAction) => void
  onCancel: () => void
  onReplaceFile: (returnFocus: HTMLElement) => void
  onSubmit: (
    input: NewTaskInput,
    signal: AbortSignal,
  ) => Promise<CreateTaskResult>
  onCreated: (task: WorkspaceTask) => void
  loadAudio: (songId: string, signal: AbortSignal) => Promise<Blob>
  onExpired: () => void
  notice?: ReactNode
}

const TEXT: SectionEditorText = {
  title: '새 구간',
  current: '새 구간',
  submit: '타브 만들기',
  submitting: '작업을 만들고 있어요.',
  failed:
    '작업을 만들지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.',
}

// The draft lives in WorkspacePage, so leaving and coming back keeps it.
export function NewSectionScreen({
  song,
  songTasks,
  onSubmit,
  onCreated,
  ...editor
}: Props) {
  return (
    <SectionEditor
      {...editor}
      song={song}
      text={TEXT}
      otherSections={songTasks}
      onSubmit={async (request, signal) => {
        const result = await onSubmit({ songId: song.id, ...request }, signal)
        return result.status === 'created'
          ? { status: 'saved', task: result.task }
          : result
      }}
      onSaved={onCreated}
    />
  )
}
