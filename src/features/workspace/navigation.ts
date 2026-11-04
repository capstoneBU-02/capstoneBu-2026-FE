import { readAppMode } from '../../app/demoConfig.ts'

export type WorkspaceView =
  'home' | 'settings' | 'task-not-found' | 'task-inaccessible'

export const WORKSPACE_SCOPE_KEY = 'earmarkWorkspaceScope'

export function readWorkspaceView(search: string): WorkspaceView {
  const view = new URLSearchParams(search).get('view')
  switch (view) {
    case 'settings':
    case 'task-not-found':
    case 'task-inaccessible':
      return view
    default:
      return 'home'
  }
}

export function hasWorkspaceScope(state: unknown, scope?: string): boolean {
  if (!state || typeof state !== 'object' || !(WORKSPACE_SCOPE_KEY in state))
    return false
  const marker = state[WORKSPACE_SCOPE_KEY]
  return typeof marker === 'string' && (scope === undefined || marker === scope)
}

export function scopedWorkspaceView(
  state: unknown,
  search: string,
  scope: string,
): WorkspaceView {
  return hasWorkspaceScope(state, scope) ? readWorkspaceView(search) : 'home'
}

// Retain only known demo selectors, never arbitrary input or serialized data.
export function workspaceUrl(
  pathname: string,
  search: string,
  view: WorkspaceView,
): string {
  const mode = readAppMode(search)
  const params = new URLSearchParams()
  if (mode.kind === 'workspace') {
    params.set('demo', new URLSearchParams(search).get('demo')!)
  } else if (mode.scenario !== 'default') {
    params.set('access', mode.scenario)
  }
  if (view !== 'home') params.set('view', view)
  return pathname + (params.size ? `?${params}` : '')
}

export function clearWorkspaceHistory(entrySearch: string) {
  // Leaving the workspace must also remove a direct-preview selector.
  const mode = readAppMode(entrySearch)
  const params = new URLSearchParams()
  if (mode.kind === 'access' && mode.scenario !== 'default')
    params.set('access', mode.scenario)
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (params.size ? `?${params}` : ''),
  )
}

export function maskTesterCode(code: string): string {
  const parts = code.split('-')
  return parts.length === 3 && parts[2].length >= 4
    ? `${parts[0]}-••••-${parts[2].slice(-4)}`
    : '••••'
}
