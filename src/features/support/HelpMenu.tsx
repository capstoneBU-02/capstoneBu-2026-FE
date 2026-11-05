import { useEffect, useRef, type RefObject } from 'react'
import fileIcon from '../../assets/figma/support/file-16.svg'
import helpIcon from '../../assets/figma/support/help-16.svg'
import infoIcon from '../../assets/figma/support/info-16.svg'
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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) menuRef.current?.querySelector('button')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, onClose, triggerRef])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      className="support-help-menu"
      role="menu"
      aria-label="도움말"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
          }
          onClose()
          triggerRef.current?.focus({ preventScroll: true })
          return
        }
        const buttons = [...event.currentTarget.querySelectorAll('button')]
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        let next: number | null = null
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length
        if (event.key === 'ArrowUp')
          next = (current - 1 + buttons.length) % buttons.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = buttons.length - 1
        if (next !== null) {
          event.preventDefault()
          event.stopPropagation()
          buttons[next]?.focus()
        }
      }}
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
    </div>
  )
}
