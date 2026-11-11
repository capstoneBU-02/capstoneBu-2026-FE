import { useEffect, useState } from 'react'
import { MediaDurationError, type MediaDurationProbe } from './mediaDuration.ts'
import {
  checkSongDuration,
  isAllowedSongFile,
  type SongFileCheck,
} from './songFile.ts'

interface CheckedFile {
  readonly file: File
  readonly round: number
  readonly check: SongFileCheck
}

export interface SongFileCheckResult {
  readonly check: SongFileCheck | null
  // Reads the same file's length again, as after a timeout.
  recheck(): void
}

// A disallowed format is rejected without touching the media stack. Otherwise
// the duration is read once per File object, or again on recheck; replacing
// or dropping the file aborts the read, and a late result for an earlier
// file or round is never shown.
export function useSongFileCheck(
  file: File | null,
  probe: MediaDurationProbe,
): SongFileCheckResult {
  const [round, setRound] = useState(0)
  const [checked, setChecked] = useState<CheckedFile | null>(null)

  useEffect(() => {
    if (!file || !isAllowedSongFile(file)) return
    const controller = new AbortController()
    probe(file, controller.signal).then(
      (seconds) => {
        if (!controller.signal.aborted)
          setChecked({ file, round, check: checkSongDuration(seconds) })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const timedOut =
          error instanceof MediaDurationError && error.reason === 'timeout'
        setChecked({
          file,
          round,
          check: { status: timedOut ? 'timed-out' : 'unreadable' },
        })
      },
    )
    return () => controller.abort()
  }, [file, probe, round])

  const recheck = () => setRound((current) => current + 1)
  if (!file) return { check: null, recheck }
  if (!isAllowedSongFile(file))
    return { check: { status: 'invalid-format' }, recheck }
  return {
    check:
      checked?.file === file && checked.round === round
        ? checked.check
        : { status: 'checking' },
    recheck,
  }
}
