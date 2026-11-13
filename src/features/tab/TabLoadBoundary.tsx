import { Component, type ReactNode } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Icon } from '../../shared/ui/Icon.tsx'
import styles from './TabPanel.module.css'

interface TabLoadBoundaryProps {
  readonly children: ReactNode
  onRetry(): void
}

interface TabLoadBoundaryState {
  readonly failed: boolean
}

// Keeps a failed tab download, or a drawing error, inside the tab area: the
// rest of the workspace and the player stay usable. React logs the error.
export class TabLoadBoundary extends Component<
  TabLoadBoundaryProps,
  TabLoadBoundaryState
> {
  state: TabLoadBoundaryState = { failed: false }

  static getDerivedStateFromError(): TabLoadBoundaryState {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className={styles.failure} role="alert">
        <p className={styles.message}>
          타브를 표시하지 못했어요. 다시 시도해 주세요.
        </p>
        <Button variant="primary" compact onClick={this.props.onRetry}>
          <Icon name="refresh" />
          다시 시도
        </Button>
      </div>
    )
  }
}
