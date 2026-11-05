import fileIcon from '../../assets/figma/support/file-20.svg'
import { Button } from '../../shared/ui/Button.tsx'
import './support.css'

export type TaskUnavailablePanelProps = {
  onReturnToWorkspace: () => void
}

export function TaskUnavailablePanel({
  onReturnToWorkspace,
}: TaskUnavailablePanelProps) {
  return (
    <div className="support-unavailable">
      <span className="support-unavailable-icon" aria-hidden="true">
        <img src={fileIcon} alt="" width={20} height={20} draggable="false" />
      </span>
      <h1>작업을 찾을 수 없어요</h1>
      <p>삭제됐거나 이 워크스페이스의 작업이 아니에요.</p>
      <div className="support-unavailable-action">
        <Button variant="primary" onClick={onReturnToWorkspace}>
          내 작업으로
        </Button>
      </div>
    </div>
  )
}
