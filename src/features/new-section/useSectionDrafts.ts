import { useState } from 'react'
import {
  createSectionForm,
  sectionFormReducer,
  type SectionForm,
  type SectionFormAction,
} from './sectionForm.ts'

export interface SectionDrafts {
  // The stored draft, or a fresh form when the song has none yet.
  form(songId: string): SectionForm
  // Songs whose draft holds something the user typed or chose.
  readonly editedSongIds: ReadonlySet<string>
  dispatch(songId: string, action: SectionFormAction): void
  discard(songId: string): void
  // A replaced file moves the draft to the new song and clears its range.
  replaceFile(fromSongId: string, toSongId: string): void
}

interface DraftState {
  readonly workspaceId: string | null
  readonly activeSongId: string | null
  readonly drafts: ReadonlyMap<string, SectionForm>
}

const emptyDrafts: ReadonlyMap<string, SectionForm> = new Map()

function isEdited(form: SectionForm): boolean {
  const fresh = createSectionForm()
  return (
    form.baseName !== fresh.baseName ||
    form.number !== fresh.number ||
    form.start !== fresh.start ||
    form.end !== fresh.end ||
    form.part !== fresh.part ||
    form.tuningId !== fresh.tuningId
  )
}

// Leaving a form the user never changed drops it, along with any errors a
// submit attempt revealed, so reopening it starts clean.
function withoutUnedited(
  drafts: ReadonlyMap<string, SectionForm>,
  keepSongId: string | null,
): ReadonlyMap<string, SectionForm> {
  return new Map(
    [...drafts].filter(
      ([songId, form]) => songId === keepSongId || isEdited(form),
    ),
  )
}

function withDraft(
  drafts: ReadonlyMap<string, SectionForm>,
  songId: string,
  form: SectionForm | null,
): ReadonlyMap<string, SectionForm> {
  const next = new Map(drafts)
  if (form) next.set(songId, form)
  else next.delete(songId)
  return next
}

// Drafts live in memory per workspace: switching or expiring the workspace
// drops them, and nothing is written to browser storage. activeSongId is the
// song whose new-section screen is open, if any.
export function useSectionDrafts(
  workspaceId: string | null,
  activeSongId: string | null,
): SectionDrafts {
  const [state, setState] = useState<DraftState>({
    workspaceId,
    activeSongId,
    drafts: emptyDrafts,
  })
  if (state.workspaceId !== workspaceId)
    setState({ workspaceId, activeSongId, drafts: emptyDrafts })
  else if (state.activeSongId !== activeSongId)
    setState({
      workspaceId,
      activeSongId,
      drafts: withoutUnedited(state.drafts, activeSongId),
    })
  const drafts = state.workspaceId === workspaceId ? state.drafts : emptyDrafts

  function update(
    change: (
      drafts: ReadonlyMap<string, SectionForm>,
    ) => ReadonlyMap<string, SectionForm>,
  ) {
    setState((previous) =>
      previous.workspaceId === workspaceId
        ? { ...previous, drafts: change(previous.drafts) }
        : previous,
    )
  }

  return {
    form: (songId) => drafts.get(songId) ?? createSectionForm(),
    editedSongIds: new Set(
      [...drafts]
        .filter(([, form]) => isEdited(form))
        .map(([songId]) => songId),
    ),
    dispatch(songId, action) {
      update((current) =>
        withDraft(
          current,
          songId,
          sectionFormReducer(
            current.get(songId) ?? createSectionForm(),
            action,
          ),
        ),
      )
    },
    discard(songId) {
      update((current) => withDraft(current, songId, null))
    },
    replaceFile(fromSongId, toSongId) {
      update((current) => {
        const replaced = sectionFormReducer(
          current.get(fromSongId) ?? createSectionForm(),
          { type: 'replace-file' },
        )
        return withDraft(
          withDraft(current, fromSongId, null),
          toSongId,
          replaced,
        )
      })
    },
  }
}
