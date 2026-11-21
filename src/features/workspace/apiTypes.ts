// Request and response bodies of the workspace APIs as the backend sends them
// (snake_case). Responses list only the fields the screens use.

// GET /workspaces/me. owner_type, session_active and created_at also arrive.
export interface WorkspaceMeResponse {
  readonly workspace_id: number
}

// POST /tracks/upload, multipart: `file` and `is_separated_stem` ("true" or
// "false"). media_type and created_at also arrive.
export interface TrackUploadResponse {
  readonly track_id: number
  // The name the file was sent with.
  readonly filename: string
  // Measured by the server and rounded to milliseconds.
  readonly duration_ms: number
  readonly is_separated_stem: boolean
}
