// Request and response bodies of the access API as the backend sends them
// (snake_case). Responses list only the fields the screens use.

// POST /auth/tester-login
export interface TesterLoginRequest {
  readonly tester_code: string
}

// owner_type, is_reconnected, notice_message and created_at also arrive.
// The notice text lives in the screen, and whether onboarding is done is not
// something is_reconnected can tell.
export interface TesterLoginResponse {
  readonly workspace_id: number
}
