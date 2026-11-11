export type RefreshStep = 'continue' | 'stop'

// What the loop watches: whether the tab is hidden, and the window's focus.
export interface RefreshPage {
  readonly document: EventTarget & { readonly hidden: boolean }
  readonly window: EventTarget
}

export interface RefreshLoopOptions {
  // Time between refreshes. null refreshes only when the page comes back.
  readonly delayMs: number | null
  // One refresh. It settles without rejecting and applies nothing once its
  // signal is aborted. 'stop' ends the loop, as after expiry.
  readonly run: (signal: AbortSignal) => Promise<RefreshStep>
  readonly page?: RefreshPage
}

export interface RefreshLoop {
  // Changes the time between refreshes. null drops a wait already started; a
  // number starts one when none waits or runs. A refresh on its way goes on.
  setDelay(delayMs: number | null): void
  // Ends the loop and cancels a refresh still running.
  stop(): void
}

// Shared by the open task and the list (#17, #28). One refresh runs at a
// time and the next waits delayMs after it. A hidden tab stops refreshing.
// A tab shown again or a window that gets focus back refreshes at once,
// unless a refresh is already on its way, and the wait starts over.
export function startRefreshLoop({
  delayMs: initialDelayMs,
  run,
  page = { document, window },
}: RefreshLoopOptions): RefreshLoop {
  let delayMs = initialDelayMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null
  let stopped = false

  function scheduleNext() {
    if (!stopped && delayMs !== null && !page.document.hidden)
      timer = setTimeout(refresh, delayMs)
  }
  function pause() {
    clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = null
  }
  function refresh() {
    timer = undefined
    const current = new AbortController()
    controller = current
    void run(current.signal).then((step) => {
      if (stopped || current.signal.aborted) return
      controller = null
      if (step === 'stop') stop()
      else scheduleNext()
    })
  }
  function catchUp() {
    if (stopped || page.document.hidden || controller !== null) return
    clearTimeout(timer)
    refresh()
  }
  function setDelay(next: number | null) {
    delayMs = next
    if (next === null) {
      clearTimeout(timer)
      timer = undefined
    } else if (timer === undefined && controller === null) scheduleNext()
  }
  function followVisibility() {
    if (page.document.hidden) pause()
    else catchUp()
  }
  function stop() {
    stopped = true
    pause()
    page.document.removeEventListener('visibilitychange', followVisibility)
    page.window.removeEventListener('focus', catchUp)
  }

  page.document.addEventListener('visibilitychange', followVisibility)
  page.window.addEventListener('focus', catchUp)
  scheduleNext()
  return { setDelay, stop }
}
