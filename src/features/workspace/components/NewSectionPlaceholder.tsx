import { useId } from 'react'
import { formatClockDuration } from '../../add-song/songFile.ts'
import { songInputShortLabel } from '../format.ts'
import type { WorkspaceSong } from '../model.ts'
import styles from './TaskWorkspace.module.css'

// Entry point of the new-section screen. Segment input arrives with #15; this
// view only confirms which file the next step will use.
export function NewSectionPlaceholder({ song }: { song: WorkspaceSong }) {
  const pendingId = useId()
  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1>새 구간</h1>
        </div>
        <p className={styles.meta}>
          <span className={styles.truncate}>{song.fileName}</span>
          <span className={styles.range}>
            {formatClockDuration(song.durationSeconds)}
          </span>
          <span>{songInputShortLabel(song.inputKind)}</span>
        </p>
      </header>
      <section className={styles.pending} aria-labelledby={pendingId}>
        <h2 id={pendingId}>구간 입력 준비 중</h2>
        <p>
          곡은 이 워크스페이스에 추가됐어요. 파형에서 구간을 고르고 이름, 파트,
          튜닝을 정하는 화면은 다음 단계에서 연결돼요.
        </p>
      </section>
    </div>
  )
}
