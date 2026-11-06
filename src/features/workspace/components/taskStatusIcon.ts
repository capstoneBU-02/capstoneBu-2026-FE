import type { IconName } from '../../../shared/ui/Icon.tsx'
import type { WorkspaceTask } from '../model.ts'

export function taskStatusIcon(task: WorkspaceTask): IconName {
  if (task.processingStatus === 'completed') return 'statusDone'
  if (task.processingStatus === 'processing') return 'statusProcessing'
  if (task.processingStatus === 'queued') return 'statusQueued'
  return 'statusFailed'
}
