import { readObject } from '../../api/guards.ts'
import type { WorkspaceInfo } from '../workspace/model.ts'
import type { TesterLoginResponse } from './apiTypes.ts'

// The server has no workspace name yet.
const WORKSPACE_NAME = '내 작업'

// Codes are issued as TESTER-XXXX-XXXX in upper case, and the server compares
// them exactly, so spaces from copying and lower-case typing are fixed here.
export function normalizeTesterCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

export function readTesterLogin(data: unknown): TesterLoginResponse {
  return { workspace_id: readObject(data).integer('workspace_id') }
}

// The server keeps only a hash of the code, so the screen shows the code this
// page sent. It stays in memory and is gone after a reload.
export function toWorkspaceInfo(
  login: TesterLoginResponse,
  testerCode: string,
): WorkspaceInfo {
  return { id: String(login.workspace_id), name: WORKSPACE_NAME, testerCode }
}
