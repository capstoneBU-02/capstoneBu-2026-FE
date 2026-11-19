import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import styles from './RecordingPanel.module.css'
import {
  microphoneProblemCopy,
  type MicrophoneProblem,
  type RecordedTake,
} from './recordingState.ts'
import type { Recorder } from './useRecorder.ts'

const REVIEW_COPY = '들어 보고 괜찮으면 비교해 보세요.'
const SILENT_WARNING =
  '소리가 녹음되지 않은 것 같아요. 마이크 연결을 확인하고 다시 녹음해 보세요.'
const PREVIEW_FAILED = '녹음을 재생하지 못했어요. 다시 시도해 주세요.'

const RETRY_LABELS: Readonly<Partial<Record<MicrophoneProblem, string>>> = {
  'no-device': '다시 시도',
  busy: '다시 시도',
  interrupted: '다시 녹음',
}

export function MicrophoneIcon() {
  return (
    <svg
      className={styles.microphone}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  )
}

export function ConsoleButton({
  className = '',
  ...props
}: ComponentPropsWithRef<typeof Button>) {
  return (
    <Button compact className={`${styles.button} ${className}`} {...props} />
  )
}

export function UploadButton({ onClick }: { onClick: () => void }) {
  return (
    <ConsoleButton onClick={onClick}>
      <Icon name="upload" className={styles.lightIcon} />
      파일 올리기
    </ConsoleButton>
  )
}

export function CloseButton({
  buttonRef,
  disabled,
  onClick,
}: {
  buttonRef: ComponentPropsWithRef<'button'>['ref']
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.close}
      aria-label="녹음 닫기"
      aria-disabled={disabled}
      onClick={onClick}
    >
      <Icon name="close" className={styles.lightIcon} />
    </button>
  )
}

export function PanelHeading({
  title,
  time,
  children,
}: {
  title: string
  time: string
  children: ReactNode
}) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title}>{title}</h2>
      <span className={styles.time}>{time}</span>
      <div className={styles.headingEnd}>{children}</div>
    </div>
  )
}

export function ProblemView({
  problem,
  onRetry,
  onUpload,
  onClose,
}: {
  problem: MicrophoneProblem
  onRetry: () => void
  onUpload: () => void
  onClose: () => void
}) {
  const { title, description } = microphoneProblemCopy(problem)
  const retryLabel = RETRY_LABELS[problem]
  return (
    <>
      <div role="alert">
        <h2 className={`${styles.title} ${styles.problemTitle}`}>
          <Icon name="alertTriangle" />
          {title}
        </h2>
        <p className={styles.copy}>{description}</p>
      </div>
      <div className={styles.actions}>
        {retryLabel && (
          <ConsoleButton data-autofocus onClick={onRetry}>
            {retryLabel}
          </ConsoleButton>
        )}
        <UploadButton onClick={onUpload} />
        <ConsoleButton data-autofocus={!retryLabel} onClick={onClose}>
          닫기
        </ConsoleButton>
      </div>
    </>
  )
}

export function ReviewView({
  take,
  recorder,
  failure,
}: {
  take: RecordedTake
  recorder: Recorder
  failure: string | null
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const saving = recorder.state.phase === 'saving'

  // The address lives exactly as long as the take is on screen.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const url = URL.createObjectURL(take.audio)
    audio.src = url
    return () => {
      audio.pause()
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [take.audio])

  function togglePreview() {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    setPreviewFailed(false)
    audio.play().catch(() => setPreviewFailed(true))
  }

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        data-recording="preview"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <p className={styles.copy}>{REVIEW_COPY}</p>
      {take.silent && (
        <p className={styles.warning} role="alert">
          {SILENT_WARNING}
        </p>
      )}
      {previewFailed && (
        <p className={styles.warning} role="alert">
          {PREVIEW_FAILED}
        </p>
      )}
      {failure && (
        <p className={styles.warning} role="alert">
          {failure}
        </p>
      )}
      <div className={styles.actions}>
        <ConsoleButton data-autofocus onClick={togglePreview}>
          {playing ? '멈추기' : '들어 보기'}
        </ConsoleButton>
        <ConsoleButton disabled={saving} onClick={recorder.rerecord}>
          다시 녹음
        </ConsoleButton>
        <ConsoleButton
          className={styles.record}
          disabled={saving}
          onClick={recorder.submit}
        >
          {saving ? '저장하는 중' : failure ? '다시 시도' : '비교하기'}
        </ConsoleButton>
      </div>
    </>
  )
}
