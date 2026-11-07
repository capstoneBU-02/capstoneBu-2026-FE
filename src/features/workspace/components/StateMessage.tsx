import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import styles from '../WorkspacePage.module.css'

export function LoadingState({ title }: { title: string }) {
  return (
    <div className={styles.centeredState} role="status">
      <div className={styles.stateMessage}>
        <span className={styles.loadingDot} aria-hidden="true" />
        <h1>{title}</h1>
      </div>
    </div>
  )
}

export function ProblemState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string
  message: string | null
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className={styles.centeredState}>
      <div className={styles.stateMessage}>
        <Icon name="info" />
        <h1>{title}</h1>
        <p role="alert">{message}</p>
        <Button onClick={onAction}>{actionLabel}</Button>
      </div>
    </div>
  )
}
