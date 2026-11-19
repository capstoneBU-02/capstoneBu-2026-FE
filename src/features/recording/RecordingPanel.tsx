import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { restoreFocus } from '../../shared/ui/dialogFocus.ts'
import { Icon } from '../../shared/ui/Icon.tsx'
import type {
  NewTake,
  SubmitTakeOutcome,
} from '../comparison/useComparisonSession.ts'
import { formatRecordingClock } from './recordingMeter.ts'
import { RecordingMonitor } from './RecordingMonitor.tsx'
import styles from './RecordingPanel.module.css'
import type { RecordingState } from './recordingState.ts'
import {
  CloseButton,
  ConsoleButton,
  MicrophoneIcon,
  PanelHeading,
  ProblemView,
  ReviewView,
  UploadButton,
} from './RecordingViews.tsx'
import { DiscardTakeDialog } from './DiscardTakeDialog.tsx'
import { useRecorder } from './useRecorder.ts'

export interface RecordingPanelProps {
  readonly sectionName: string
  readonly sectionSeconds: number
  readonly onSubmit: (take: NewTake) => Promise<SubmitTakeOutcome>
  readonly onUploadInstead: () => void
  readonly onClose: () => void
  // True while a take is being recorded, for whatever plays along with it.
  // 처음부터 reports false and then true, because a new take begins.
  readonly onCaptureChange?: (capturing: boolean) => void
  // True while leaving the screen would lose a take.
  readonly onUnsavedChange?: (unsaved: boolean) => void
}

const READY_COPY =
  '녹음을 시작하면 브라우저가 마이크 권한을 물어봐요. 정지를 누르면 바로 멈춰요.'
const REQUESTING_COPY = '브라우저에서 마이크를 허용해 주세요.'
const RECORDING_HINT = '이어폰으로 원곡을 들으며 기타 소리만 녹음해 주세요.'

const ANNOUNCEMENTS: Readonly<Record<RecordingState['phase'], string>> = {
  idle: '',
  requesting: '마이크 권한을 기다리고 있어요.',
  recording: '녹음을 시작했어요.',
  blocked: '',
  review: '녹음을 마쳤어요.',
  saving: '연주를 저장하고 있어요.',
  'save-failed': '',
}

// A save still under way ends with the screen, so it counts as unsaved.
function hasUnsavedTake({ phase }: RecordingState) {
  return (
    phase === 'recording' ||
    phase === 'review' ||
    phase === 'saving' ||
    phase === 'save-failed'
  )
}

// Read by the player bar, which rests on top of the panel.
const PANEL_HEIGHT_PROPERTY = '--recording-panel-height'

function focusCurrentStep(panel: HTMLElement | null) {
  panel
    ?.querySelector<HTMLElement>('[data-autofocus="true"]')
    ?.focus({ preventScroll: true })
}

export function RecordingPanel({
  sectionName,
  sectionSeconds,
  onSubmit,
  onUploadInstead,
  onClose,
  onCaptureChange,
  onUnsavedChange,
}: RecordingPanelProps) {
  const recorder = useRecorder({
    sectionSeconds,
    onSubmit,
    onSaved: onClose,
    onCaptureChange,
  })
  const { state, capture } = recorder
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)
  const unsaved = hasUnsavedTake(state)
  // A take that ended on its own leaves nothing to ask about.
  if (closing && !unsaved) setClosing(false)

  useEffect(() => {
    if (!unsaved) return
    function askBrowser(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    onUnsavedChange?.(true)
    window.addEventListener('beforeunload', askBrowser)
    return () => {
      window.removeEventListener('beforeunload', askBrowser)
      onUnsavedChange?.(false)
    }
  }, [unsaved, onUnsavedChange])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const { style } = document.documentElement
    const observer = new ResizeObserver(() => {
      style.setProperty(PANEL_HEIGHT_PROPERTY, `${panel.offsetHeight}px`)
    })
    observer.observe(panel)
    return () => {
      observer.disconnect()
      style.removeProperty(PANEL_HEIGHT_PROPERTY)
    }
  }, [])

  // Back to whatever opened the panel, or the page when that is gone.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const page = panelRef.current?.parentElement
    focusCurrentStep(panelRef.current)
    return () => restoreFocus(opener, page)
  }, [])

  // A finished step takes its buttons away, which would drop keyboard focus.
  // Safari leaves focus on the column around a button that was clicked.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const current = document.activeElement
    if (current?.contains(panel) || panel.contains(current)) {
      focusCurrentStep(panel)
    }
  }, [state.phase])

  function leave() {
    recorder.cancel()
    onClose()
  }

  function requestClose() {
    if (state.phase === 'saving') return
    if (unsaved) setClosing(true)
    else leave()
  }

  function uploadInstead() {
    recorder.cancel()
    onUploadInstead()
  }

  const closeButton = (
    <CloseButton
      buttonRef={closeRef}
      disabled={state.phase === 'saving'}
      onClick={requestClose}
    />
  )
  const sectionTitle = `${sectionName} 녹음`

  function body() {
    switch (state.phase) {
      case 'idle':
        return (
          <>
            <PanelHeading
              title={sectionTitle}
              time={formatRecordingClock(sectionSeconds)}
            >
              {closeButton}
            </PanelHeading>
            <p className={styles.copy}>{READY_COPY}</p>
            <div className={styles.actions}>
              <ConsoleButton
                className={styles.record}
                data-autofocus
                onClick={recorder.start}
              >
                <span className={styles.recordDot} aria-hidden="true" />
                녹음 시작
              </ConsoleButton>
              <UploadButton onClick={uploadInstead} />
            </div>
          </>
        )
      case 'requesting':
        return (
          <>
            <PanelHeading
              title={sectionTitle}
              time={formatRecordingClock(sectionSeconds)}
            >
              {closeButton}
            </PanelHeading>
            <p className={styles.copy}>{REQUESTING_COPY}</p>
            <div className={styles.actions}>
              <ConsoleButton data-autofocus onClick={recorder.cancel}>
                취소
              </ConsoleButton>
            </div>
          </>
        )
      case 'recording':
        return (
          capture && (
            <>
              <div className={styles.heading}>
                <span className={styles.recordingMark} aria-hidden="true" />
                <h2 className={styles.title}>녹음 중</h2>
                <div className={styles.headingEnd}>
                  <span className={styles.device}>
                    <MicrophoneIcon />
                    <span className={styles.deviceName}>
                      {capture.deviceLabel || '마이크'}
                    </span>
                  </span>
                  {closeButton}
                </div>
              </div>
              <RecordingMonitor
                capture={capture}
                sectionSeconds={sectionSeconds}
                hint={RECORDING_HINT}
                controls={
                  <>
                    <ConsoleButton
                      className={styles.stop}
                      data-autofocus
                      onClick={recorder.stop}
                    >
                      <span className={styles.stopMark} aria-hidden="true" />
                      정지
                    </ConsoleButton>
                    <ConsoleButton onClick={recorder.restart}>
                      <Icon name="refresh" />
                      처음부터
                    </ConsoleButton>
                  </>
                }
              />
            </>
          )
        )
      case 'blocked':
        return (
          <ProblemView
            problem={state.problem}
            onRetry={recorder.rerecord}
            onUpload={uploadInstead}
            onClose={leave}
          />
        )
      case 'review':
      case 'saving':
      case 'save-failed':
        return (
          <>
            <PanelHeading
              title={sectionTitle}
              time={formatRecordingClock(state.take.durationSeconds)}
            >
              {closeButton}
            </PanelHeading>
            <ReviewView
              take={state.take}
              recorder={recorder}
              failure={state.phase === 'save-failed' ? state.message : null}
            />
          </>
        )
    }
  }

  const content = (
    <>
      <section
        ref={panelRef}
        className={styles.panel}
        aria-label={sectionTitle}
      >
        <p className={styles.srOnly} role="status">
          {ANNOUNCEMENTS[state.phase]}
        </p>
        {body()}
      </section>
      {closing && unsaved && (
        <DiscardTakeDialog
          onConfirm={leave}
          onClose={() => setClosing(false)}
          returnFocusRef={closeRef}
          fallbackFocusRef={panelRef}
        />
      )}
    </>
  )

  // Docked to the main column, so it stays in view on either task view.
  const dock = document.getElementById('workspace-content')
  return dock ? createPortal(content, dock) : content
}
