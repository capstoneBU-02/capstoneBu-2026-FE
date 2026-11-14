import type { RefObject } from 'react'
import fileIcon from '../../assets/figma/support/file-16.svg'
import helpIcon from '../../assets/figma/support/help-16.svg'
import infoIcon from '../../assets/figma/support/info-16.svg'
import { Menu } from '../../shared/ui/Menu.tsx'
import type { SupportTopic } from './SupportDialog.tsx'
import './support.css'

export type HelpTopic = Exclude<SupportTopic, 'deletion'>

export type HelpMenuProps = {
  open: boolean
  onSelect: (topic: HelpTopic) => void
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

const items = [
  { topic: 'faq', label: '자주 묻는 질문', icon: helpIcon },
  { topic: 'usage', label: '이용 안내 다시 보기', icon: fileIcon },
  { topic: 'contact', label: '문의하기', icon: infoIcon },
] as const

export function HelpMenu({
  open,
  onSelect,
  onClose,
  triggerRef,
}: HelpMenuProps) {
  return (
    <Menu
      open={open}
      label="도움말"
      onClose={onClose}
      triggerRef={triggerRef}
      className="support-help-menu"
    >
      {items.map(({ topic, label, icon }) => (
        <button
          type="button"
          role="menuitem"
          key={topic}
          tabIndex={-1}
          onClick={() => onSelect(topic)}
        >
          <img
            src={icon}
            width={16}
            height={16}
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          {label}
        </button>
      ))}
    </Menu>
  )
}
