import { Component, type ReactNode } from 'react'
import { TabFailure } from './TabFailure.tsx'

interface TabLoadBoundaryProps {
  readonly children: ReactNode
  onRetry(): void
}

interface TabLoadBoundaryState {
  readonly failed: boolean
}

export const TAB_DRAW_FAILED = '타브를 표시하지 못했어요. 다시 시도해 주세요.'

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
    return <TabFailure message={TAB_DRAW_FAILED} onRetry={this.props.onRetry} />
  }
}
