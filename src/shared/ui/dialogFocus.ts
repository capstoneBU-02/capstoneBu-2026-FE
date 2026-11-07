// Shared by the native <dialog> components: focus restore and backdrop clicks.

export function canFocus(element: HTMLElement | null | undefined) {
  return Boolean(
    element?.isConnected &&
    !element.matches(':disabled, [hidden]') &&
    element.getClientRects().length,
  )
}

// Focus the element that opened a dialog, or the fallback when it is gone.
export function restoreFocus(
  target: HTMLElement | null | undefined,
  fallback: HTMLElement | null | undefined,
) {
  if (target && canFocus(target)) target.focus({ preventScroll: true })
  if (document.activeElement === target && canFocus(target)) return
  if (fallback && canFocus(fallback)) fallback.focus({ preventScroll: true })
}

export function isOutside(
  event: { clientX: number; clientY: number },
  box: DOMRect,
) {
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
}
