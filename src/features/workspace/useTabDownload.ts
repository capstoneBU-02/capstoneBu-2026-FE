import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { tabFileName } from '../tab/export/fileName.ts'
import { saveFile } from '../tab/export/saveFile.ts'
import type { TabSource } from '../tab/TabPanel.tsx'

export type TabFormat = 'png' | 'pdf'

// The last download that failed. The count tells one failure from the next,
// so the same notice is read out again.
export interface DownloadFailure {
  readonly format: TabFormat
  readonly count: number
}

export interface TabDownload {
  readonly busy: TabFormat | null
  // The last download was saved.
  readonly saved: boolean
  readonly failure: DownloadFailure | null
  // 내려받기, where focus goes once a notice it was on is gone.
  readonly triggerRef: RefObject<HTMLButtonElement | null>
  // The failure notice.
  readonly noticeRef: RefObject<HTMLDivElement | null>
  // Told by the menu and the notice as they go while holding focus, which
  // happens when the tab they were for loads again.
  dropFocus(): void
  // Asked by the tab as it mounts: whether to take focus dropped in the same
  // commit, which would otherwise fall to the page.
  takeFocus(): boolean
  start(format: TabFormat): void
}

interface State {
  readonly key: string
  readonly busy: TabFormat | null
  readonly saved: boolean
  readonly failure: DownloadFailure | null
}

const idle = (key: string): State => ({
  key,
  busy: null,
  saved: false,
  failure: null,
})

// The PNG is the SVG on screen; the PDF is laid out again for the page.
async function makeFile(
  format: TabFormat,
  tab: Extract<TabSource, { readonly status: 'ready' }>,
  svg: SVGSVGElement,
  signal: AbortSignal,
): Promise<Blob> {
  if (format === 'pdf') {
    const { tabPdf } = await import('../tab/export/tabPdf.tsx')
    return tabPdf(tab.score, signal)
  }
  const { tabPng } = await import('../tab/export/tabPng.ts')
  return tabPng(svg)
}

// Saves the tab on screen as a file, one at a time. A failure stays until a
// download succeeds or the tab changes; the tab on screen stays either way.
// `key` names the tab: a new one drops the failure and stops any file being
// made for the old one. `svg` is the tab drawn on screen, null until then.
export function useTabDownload({
  tab,
  svg,
  songName,
  sectionName,
  key,
}: {
  tab: TabSource
  svg: SVGSVGElement | null
  songName: string
  sectionName: string
  key: string
}): TabDownload {
  const [state, setState] = useState<State>(() => idle(key))
  const current: State = state.key === key ? state : idle(key)
  if (current !== state) setState(current)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // The file being made. A change of tab, or leaving the screen, aborts it:
  // its result is dropped and a PDF stops before its next page.
  const making = useRef<AbortController | null>(null)
  useEffect(() => () => making.current?.abort(), [key])
  const focusDropped = useRef(false)
  const dropFocus = useCallback(() => {
    focusDropped.current = true
  }, [])
  const takeFocus = useCallback(() => {
    const dropped = focusDropped.current
    focusDropped.current = false
    return dropped
  }, [])
  // Runs after the tab's own layout effects: a drop no tab took is stale.
  useLayoutEffect(() => {
    focusDropped.current = false
  })

  function start(format: TabFormat) {
    if (current.busy !== null || tab.status !== 'ready' || svg === null) return
    const controller = new AbortController()
    making.current = controller
    const { signal } = controller
    const name = tabFileName(songName, sectionName, format)
    setState({ ...current, busy: format, saved: false })
    makeFile(format, tab, svg, signal).then(
      (blob) => {
        if (signal.aborted) return
        saveFile(blob, name)
        // The notice goes; its button should not take focus with it.
        if (noticeRef.current?.contains(document.activeElement))
          triggerRef.current?.focus({ preventScroll: true })
        setState((previous) => ({
          ...previous,
          busy: null,
          saved: true,
          failure: null,
        }))
      },
      () => {
        if (signal.aborted) return
        setState((previous) => ({
          ...previous,
          busy: null,
          failure: { format, count: (previous.failure?.count ?? 0) + 1 },
        }))
      },
    )
  }

  return {
    busy: current.busy,
    saved: current.saved,
    failure: current.failure,
    triggerRef,
    noticeRef,
    dropFocus,
    takeFocus,
    start,
  }
}
