import {
  lazy,
  Suspense,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import type { TabScore } from './model.ts'
import { restoreFocus } from '../../shared/ui/dialogFocus.ts'
import { TabFailure } from './TabFailure.tsx'
import { TAB_DRAW_FAILED, TabLoadBoundary } from './TabLoadBoundary.tsx'
import styles from './TabPanel.module.css'
import type { TabStaffProps } from './TabStaff.tsx'

// The tab as its request stands: a request that failed, or an answer the
// screen could not read, can be asked for again.
export type TabSource =
  | { readonly status: 'loading' }
  | {
      readonly status: 'failed'
      readonly reason: 'request' | 'format'
      retry(): void
    }
  | { readonly status: 'ready'; readonly score: TabScore }

export interface TabPanelProps extends Omit<TabStaffProps, 'score'> {
  readonly tab: TabSource
  // Asked once as the panel mounts; true puts focus on its heading, for
  // controls that went away with the tab this panel replaces.
  readonly takeFocus?: () => boolean
  readonly dropFocus?: () => void
}

interface StaffModule {
  readonly default: ComponentType<TabStaffProps>
}

const FAILURE_MESSAGES = {
  request: '타브를 불러오지 못했어요. 다시 시도해 주세요.',
  format: TAB_DRAW_FAILED,
} as const

// A lazy component keeps a failed load for good, so a failure swaps in a
// fresh one: the retry, and every panel after it, loads the code again.
function loadStaff(): Promise<StaffModule> {
  return import('./TabStaff.tsx').catch((error: unknown) => {
    Staff = lazy(loadStaff)
    throw error
  })
}

// Every panel shares one lazy component, so the drawing code downloads once
// and a panel opened later, for another task, draws at once.
let Staff = lazy(loadStaff)

function Loading() {
  return (
    <p className={styles.message} role="status">
      타브를 불러오는 중이에요
    </p>
  )
}

// The tab area of a completed task. The heading shows at once; the tab and
// the drawing code arrive on their own.
export function TabPanel({
  tab,
  takeFocus,
  dropFocus,
  ...staff
}: TabPanelProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Remounting the boundary clears its failure and renders the fresh Staff.
  const [attempt, setAttempt] = useState(0)

  // A layout effect asks in the commit that took the old controls away, and
  // before paint, so focus never rests on the page in between. Only the
  // function given at mount is asked.
  const takeFocusRef = useRef(takeFocus)
  useLayoutEffect(() => {
    if (takeFocusRef.current?.() === true)
      restoreFocus(
        headingRef.current,
        document.getElementById('workspace-content'),
      )
  }, [])

  useLayoutEffect(
    () => () => {
      if (panelRef.current?.contains(document.activeElement)) dropFocus?.()
    },
    [dropFocus],
  )

  // The button goes away with the failure, so focus stays in the tab area.
  const retryWith = (retry: () => void) => () => {
    headingRef.current?.focus({ preventScroll: true })
    retry()
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-labelledby={headingId}
    >
      <div className={styles.header}>
        <h2
          ref={headingRef}
          id={headingId}
          className={styles.title}
          tabIndex={-1}
        >
          타브
        </h2>
        <span className={styles.draft}>초안 · 자동 생성</span>
      </div>
      {tab.status === 'loading' && <Loading />}
      {tab.status === 'failed' && (
        <TabFailure
          message={FAILURE_MESSAGES[tab.reason]}
          onRetry={retryWith(tab.retry)}
        />
      )}
      {tab.status === 'ready' && (
        <TabLoadBoundary
          key={attempt}
          onRetry={retryWith(() => setAttempt((last) => last + 1))}
        >
          <Suspense fallback={<Loading />}>
            <Staff score={tab.score} {...staff} />
          </Suspense>
        </TabLoadBoundary>
      )}
    </section>
  )
}
