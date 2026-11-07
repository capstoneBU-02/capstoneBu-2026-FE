import { useState, type DragEvent } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { uploadHintLabel } from '../../add-song/songFile.ts'
import styles from '../WorkspacePage.module.css'

type Props = {
  hasSongs: boolean
  onAddSong: (returnFocus: HTMLElement | null, files?: readonly File[]) => void
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

// The dashed card reads as a drop area, so a dropped file opens the add-song
// dialog with that file instead of letting the browser navigate to it.
export function EmptyWorkspace({ hasSongs, onAddSong }: Props) {
  const [dragActive, setDragActive] = useState(false)
  return (
    <div className={styles.centeredState}>
      <div
        className={styles.emptyCard}
        data-drag-active={dragActive}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node && event.currentTarget.contains(next)))
            setDragActive(false)
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDragActive(false)
          onAddSong(event.currentTarget.querySelector('button'), [
            ...event.dataTransfer.files,
          ])
        }}
      >
        <span className={styles.uploadCircle}>
          <Icon name="upload" />
        </span>
        <h1>{hasSongs ? '아직 만든 구간이 없어요' : '첫 곡을 올려 주세요'}</h1>
        <p>
          {hasSongs
            ? '구간 입력은 다음 단계에서 연결돼요. 다른 곡을 더 올릴 수 있어요.'
            : uploadHintLabel()}
        </p>
        <Button
          variant="primary"
          className={styles.emptyAction}
          onClick={(event) => onAddSong(event.currentTarget)}
        >
          파일 선택
        </Button>
      </div>
    </div>
  )
}
