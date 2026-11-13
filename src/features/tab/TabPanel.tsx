import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { TabLoadBoundary } from './TabLoadBoundary.tsx'
import styles from './TabPanel.module.css'
import type { TabStaffProps } from './TabStaff.tsx'

export type TabPanelProps = TabStaffProps

interface StaffModule {
  readonly default: ComponentType<TabStaffProps>
}

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

// The tab area of a completed task. The heading shows at once; the drawing
// code arrives as its own chunk.
export function TabPanel(props: TabPanelProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Remounting the boundary clears its failure and renders the fresh Staff.
  const [attempt, setAttempt] = useState(0)

  const retry = () => {
    // The button goes away with the failure, so focus stays in the tab area.
    headingRef.current?.focus({ preventScroll: true })
    setAttempt((last) => last + 1)
  }

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
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
      <TabLoadBoundary key={attempt} onRetry={retry}>
        <Suspense
          fallback={
            <p className={styles.message} role="status">
              타브를 불러오는 중이에요
            </p>
          }
        >
          <Staff {...props} />
        </Suspense>
      </TabLoadBoundary>
    </section>
  )
}
