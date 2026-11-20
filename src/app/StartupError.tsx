import { ProblemState } from '../features/workspace/components/StateMessage.tsx'

// Shown when startup fails: a bad build setting, or a chunk that could not be
// downloaded after a new deploy. The details go to the console.
export function StartupError() {
  return (
    <ProblemState
      title="화면을 열지 못했어요"
      message="잠시 후 다시 불러와 주세요."
      actionLabel="다시 불러오기"
      onAction={() => window.location.reload()}
    />
  )
}
