import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

export type MenuProps = {
  open: boolean
  // The menu's accessible name.
  label: string
  onClose: () => void
  // The button that opens the menu; focus returns to it on close.
  triggerRef: RefObject<HTMLButtonElement | null>
  className?: string
  // Buttons with role="menuitem" and tabIndex={-1}.
  children: ReactNode
}

const itemsOf = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
]

// A list of actions under its trigger. It opens with the first item focused;
// the arrow keys, Home and End move between items; Escape and Tab close it,
// as does a press outside it.
export function Menu({
  open,
  label,
  onClose,
  triggerRef,
  className,
  children,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && menuRef.current) itemsOf(menuRef.current)[0]?.focus()
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
      className={className}
      role="menu"
      aria-label={label}
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
        const items = itemsOf(event.currentTarget)
        const current = items.indexOf(document.activeElement as HTMLElement)
        let next: number | null = null
        if (event.key === 'ArrowDown') next = (current + 1) % items.length
        if (event.key === 'ArrowUp')
          next = (current - 1 + items.length) % items.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = items.length - 1
        if (next !== null) {
          event.preventDefault()
          event.stopPropagation()
          items[next]?.focus()
        }
      }}
    >
      {children}
    </div>
  )
}
