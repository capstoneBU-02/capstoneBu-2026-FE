import { readObject } from '../../api/guards.ts'
import type { WorkspaceMeResponse } from './apiTypes.ts'

export function readWorkspaceMe(data: unknown): WorkspaceMeResponse {
  return { workspace_id: readObject(data).integer('workspace_id') }
}
