// Request and response bodies of the workspace APIs as the backend sends them
// (snake_case). Responses list only the fields the screens use.

// GET /workspaces/me. owner_type, session_active and created_at also arrive.
export interface WorkspaceMeResponse {
  readonly workspace_id: number
}
