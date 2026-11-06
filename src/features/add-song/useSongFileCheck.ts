import { useEffect, useState } from 'react'
import type { MediaDurationProbe } from './mediaDuration.ts'
import {
  checkSongDuration,
  isAllowedSongFile,
  type SongFileCheck,
} from './songFile.ts'

interface CheckedFile {
  readonly file: File
  readonly check: SongFileCheck
}

// A disallowed format is rejected without touching the media stack. Otherwise
// the duration is read once per File object; replacing or dropping the file
// aborts the read, and a late result for an earlier file is never shown.
export function useSongFileCheck(
  file: File | null,
  probe: MediaDurationProbe,
): SongFileCheck | null {
  const [checked, setChecked] = useState<CheckedFile | null>(null)

  useEffect(() => {
    if (!file || !isAllowedSongFile(file)) return
    const controller = new AbortController()
    probe(file, controller.signal).then(
      (seconds) => {
        if (!controller.signal.aborted)
          setChecked({ file, check: checkSongDuration(seconds) })
      },
      () => {
        if (!controller.signal.aborted)
          setChecked({ file, check: { status: 'unreadable' } })
      },
    )
    return () => controller.abort()
  }, [file, probe])

  if (!file) return null
  if (!isAllowedSongFile(file)) return { status: 'invalid-format' }
  return checked?.file === file ? checked.check : { status: 'checking' }
}
