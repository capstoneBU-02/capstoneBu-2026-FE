import type { RefObject } from 'react'
import { ConfirmDialog } from '../workspace/components/ConfirmDialog.tsx'

type Props = {
  onConfirm: () => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

// Replacing the file clears the range and part (IN-05), so the user confirms
// first.
export function ReplaceFileDialog(props: Props) {
  return (
    <ConfirmDialog
      title="다른 파일로 바꿀까요?"
      description="정해 둔 구간과 파트는 새 파일에 맞춰 다시 골라야 해요. 지금 곡과 이미 만든 작업은 그대로 남아요."
      confirmLabel="파일 바꾸기"
      {...props}
    />
  )
}
