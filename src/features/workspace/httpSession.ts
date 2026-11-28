// The session check both http repositories make: right after logging in, and
// each time the workspace opens or its list is read again.

import type { HttpClient } from '../../api/http.ts'
import { readWorkspaceMe } from './adapter.ts'

// The session cookie names another workspace than the one this page entered.
// Entering another code in another tab replaces the cookie, and a browser
// that did not keep the login's cookie still sends an older one.
export class WorkspaceMismatchError extends Error {
  readonly expectedWorkspaceId: string
  readonly receivedWorkspaceId: string

  constructor(expectedWorkspaceId: string, receivedWorkspaceId: string) {
    super(
      `The session belongs to workspace ${receivedWorkspaceId}, not ${expectedWorkspaceId}.`,
    )
    this.name = 'WorkspaceMismatchError'
    this.expectedWorkspaceId = expectedWorkspaceId
    this.receivedWorkspaceId = receivedWorkspaceId
  }
}

// Fails with the server's ApiError when there is no session, and with
// WorkspaceMismatchError when it belongs to another workspace.
export async function confirmSession(
  client: HttpClient,
  workspaceId: string,
  signal: AbortSignal,
): Promise<void> {
  const { data } = await client.request('GET', '/workspaces/me', {
    signal,
    read: readWorkspaceMe,
  })
  const received = String(data.workspace_id)
  if (received !== workspaceId)
    throw new WorkspaceMismatchError(workspaceId, received)
}
