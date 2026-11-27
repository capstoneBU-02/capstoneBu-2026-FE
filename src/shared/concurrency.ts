// How many requests a list sends to the server at once. A browser holds only
// a few to one server (six over HTTP/1.1) and queues the rest, and the
// screen's other requests should not wait behind a long list.
export const REQUESTS_AT_ONCE = 4

// Maps items with at most `limit` jobs running at once. Results keep the
// items' order. The first failure rejects, and no job starts after it; jobs
// already running settle on their own.
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  async function worker() {
    while (!failed && next < items.length) {
      const index = next
      next += 1
      try {
        results[index] = await job(items[index], index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

// Waits for work the caller does not own, giving up with the signal's reason
// once it aborts. The work itself goes on.
export function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}
