interface YieldingScheduler {
  yield(): Promise<void>
}

// Lets input and rendering run between slices of long work.
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<YieldingScheduler> })
    .scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export interface SliceOptions {
  readonly signal: AbortSignal
  // Work longer than this between yields delays input handling.
  readonly budgetMs?: number
  readonly now?: () => number
  readonly yieldToMain?: () => Promise<void>
}

// Runs step(index) for 0..count-1 in slices, yielding once a slice has used
// its time budget. Cancelling stops at the next slice boundary.
export async function runInSlices(
  count: number,
  step: (index: number) => void,
  {
    signal,
    budgetMs = 8,
    now = () => performance.now(),
    yieldToMain: yieldNow = yieldToMain,
  }: SliceOptions,
): Promise<void> {
  signal.throwIfAborted()
  let sliceStart = now()
  for (let index = 0; index < count; index += 1) {
    step(index)
    if (index + 1 < count && now() - sliceStart >= budgetMs) {
      await yieldNow()
      signal.throwIfAborted()
      sliceStart = now()
    }
  }
}
