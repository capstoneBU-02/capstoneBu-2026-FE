import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import styles from './TabPanel.module.css'

// A failure inside the tab area, with the one way out of it.
export function TabFailure({
  message,
  onRetry,
}: {
  message: string
  onRetry(): void
}) {
  return (
    <div className={styles.failure} role="alert">
      <p className={styles.message}>{message}</p>
      <Button variant="primary" compact onClick={onRetry}>
        <Icon name="refresh" />
        다시 시도
      </Button>
    </div>
  )
}
