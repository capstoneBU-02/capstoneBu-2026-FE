import type { WorkspaceSnapshot } from './model.ts'

interface Identified {
  readonly id: string
}

// Tasks and songs this tab changed while a list refresh was on its way.
export interface ListChanges {
  readonly tasks: ReadonlySet<string>
  readonly songs: ReadonlySet<string>
}

// Workspace items hold plain values, so equal fields mean the same state.
export function sameFields<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[]
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  )
}

// Adds the item, or replaces the one with its id: a refresh may have
// brought it in before the request that made it answered.
export function upserted<T extends Identified>(
  items: readonly T[],
  item: T,
): readonly T[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item]
}

function mergedItems<T extends Identified>(
  shown: readonly T[],
  loaded: readonly T[],
  changed: ReadonlySet<string>,
): readonly T[] {
  const shownById = new Map(shown.map((item) => [item.id, item]))
  const loadedIds = new Set(loaded.map((item) => item.id))
  const merged: T[] = []
  for (const item of loaded) {
    const local = shownById.get(item.id)
    // A change made here may be newer than the list; one removed here
    // stays removed.
    if (changed.has(item.id)) {
      if (local) merged.push(local)
    } else merged.push(local && sameFields(local, item) ? local : item)
  }
  // Added here after the list was sent.
  for (const item of shown)
    if (changed.has(item.id) && !loadedIds.has(item.id)) merged.push(item)
  return merged.length === shown.length &&
    merged.every((item, index) => item === shown[index])
    ? shown
    : merged
}

// The loaded list replaces the shown one, apart from what this tab changed
// while it was on its way. Items that did not change keep their objects,
// and an unchanged list comes back as the shown snapshot itself, so a
// refresh that finds nothing new renders nothing. Consent is kept: the
// workspace tracks it apart from the list.
export function mergeRefreshedList(
  shown: WorkspaceSnapshot,
  loaded: WorkspaceSnapshot,
  changed: ListChanges,
): WorkspaceSnapshot {
  const tasks = mergedItems(shown.tasks, loaded.tasks, changed.tasks)
  const songs = mergedItems(shown.songs, loaded.songs, changed.songs)
  const workspace = sameFields(shown.workspace, loaded.workspace)
    ? shown.workspace
    : loaded.workspace
  return tasks === shown.tasks &&
    songs === shown.songs &&
    workspace === shown.workspace
    ? shown
    : { ...shown, workspace, songs, tasks }
}
