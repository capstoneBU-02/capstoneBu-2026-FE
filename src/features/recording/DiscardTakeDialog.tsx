import type { RefObject } from 'react'
import { ConfirmDialog } from '../workspace/components/ConfirmDialog.tsx'

// Asked before a take that was never saved is thrown away.
export function DiscardTakeDialog({
  onConfirm,
  onClose,
  returnFocusRef,
  fallbackFocusRef,
}: {
  onConfirm: () => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}) {
  return (
    <ConfirmDialog
      title="녹음을 그만둘까요?"
      description="지금까지 녹음한 내용은 저장되지 않아요."
      confirmLabel="그만두기"
      onConfirm={onConfirm}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
    />
  )
}
