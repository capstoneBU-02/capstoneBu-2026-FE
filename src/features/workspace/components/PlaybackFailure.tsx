import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import type { SongAudio } from '../../waveform/useSongAudio.ts'
import { playbackFailureText } from '../format.ts'
import styles from './PlaybackFailure.module.css'

// Across a finished task when the track it plays failed to load: the tab
// stays to read and download, and the banner holds the one retry.
export function PlaybackFailure({
  label,
  audio,
}: {
  label: string
  audio: SongAudio
}) {
  const { retrying } = audio
  return (
    <div className={styles.banner} role="alert">
      <Icon name="alertTriangle" />
      <p>{playbackFailureText(label)}</p>
      <Button
        compact
        className={styles.retry}
        aria-disabled={retrying}
        data-busy={retrying}
        onClick={() => {
          if (!retrying) audio.retry()
        }}
      >
        다시 불러오기
      </Button>
    </div>
  )
}
