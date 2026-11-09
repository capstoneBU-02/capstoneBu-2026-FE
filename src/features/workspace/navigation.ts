import { readAppMode } from '../../app/demoConfig.ts'

export type WorkspaceView =
  | { readonly name: 'home' }
  | { readonly name: 'settings' }
  | { readonly name: 'task'; readonly taskId: string }
  | { readonly name: 'task-not-found' }
  | { readonly name: 'task-inaccessible' }
  | { readonly name: 'edit-section'; readonly taskId: string }
  | { readonly name: 'new-section'; readonly songId: string }
  | { readonly name: 'song-not-found' }

export const WORKSPACE_SCOPE_KEY = 'earmarkWorkspaceScope'

const HOME_VIEW: WorkspaceView = { name: 'home' }
const TASK_NOT_FOUND_VIEW: WorkspaceView = { name: 'task-not-found' }
const SONG_NOT_FOUND_VIEW: WorkspaceView = { name: 'song-not-found' }
// Opaque mock/API ids: lowercase letters, digits and inner hyphens only. Any
// other shape is never sent to the repository or written back to the URL.
const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && RESOURCE_ID_PATTERN.test(value)
}

export function isSongId(value: unknown): value is string {
  return typeof value === 'string' && RESOURCE_ID_PATTERN.test(value)
}

// Views pushed by the app follow the same id rule as views read from a URL,
// so the rendered view, the repository request and the URL never disagree.
export function canonicalWorkspaceView(view: WorkspaceView): WorkspaceView {
  if (
    (view.name === 'task' || view.name === 'edit-section') &&
    !isTaskId(view.taskId)
  )
    return TASK_NOT_FOUND_VIEW
  if (view.name === 'new-section' && !isSongId(view.songId))
    return SONG_NOT_FOUND_VIEW
  return view
}

export function readWorkspaceView(search: string): WorkspaceView {
  const params = new URLSearchParams(search)
  const view = params.get('view')
  switch (view) {
    case 'settings':
    case 'task-not-found':
    case 'task-inaccessible':
    case 'song-not-found':
      return { name: view }
    case 'task':
    case 'edit-section': {
      const taskId = params.get('task')
      return isTaskId(taskId) ? { name: view, taskId } : TASK_NOT_FOUND_VIEW
    }
    case 'new-section': {
      const songId = params.get('song')
      return isSongId(songId)
        ? { name: 'new-section', songId }
        : SONG_NOT_FOUND_VIEW
    }
    default:
      return HOME_VIEW
  }
}

export function workspaceViewKey(view: WorkspaceView): string {
  if (view.name === 'task') return `task:${view.taskId}`
  if (view.name === 'edit-section') return `edit-section:${view.taskId}`
  if (view.name === 'new-section') return `new-section:${view.songId}`
  return view.name
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
  return hasWorkspaceScope(state, scope) ? readWorkspaceView(search) : HOME_VIEW
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
  const canonical = canonicalWorkspaceView(view)
  if (canonical.name === 'task' || canonical.name === 'edit-section') {
    params.set('view', canonical.name)
    params.set('task', canonical.taskId)
  } else if (canonical.name === 'new-section') {
    params.set('view', 'new-section')
    params.set('song', canonical.songId)
  } else if (canonical.name !== 'home') {
    params.set('view', canonical.name)
  }
  const query = params.toString()
  return pathname + (query ? `?${query}` : '')
}

export function clearWorkspaceHistory(entrySearch: string) {
  // Leaving the workspace must also remove a direct-preview selector.
  const mode = readAppMode(entrySearch)
  const params = new URLSearchParams()
  if (mode.kind === 'access' && mode.scenario !== 'default')
    params.set('access', mode.scenario)
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : ''),
  )
}

export function maskTesterCode(code: string): string {
  const parts = code.split('-')
  return parts.length === 3 && parts[2].length >= 4
    ? `${parts[0]}-••••-${parts[2].slice(-4)}`
    : '••••'
}
