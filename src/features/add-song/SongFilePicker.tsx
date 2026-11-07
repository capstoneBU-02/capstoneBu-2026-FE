import { useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { Icon } from '../../shared/ui/Icon.tsx'
import {
  formatClockDuration,
  formatFileSize,
  songFileAccept,
  uploadHintLabel,
  type SongFileCheck,
} from './songFile.ts'
import styles from './AddSongDialog.module.css'

type Props = {
  file: File | null
  check: SongFileCheck | null
  disabled: boolean
  describedBy?: string
  onChoose: (files: readonly File[]) => void
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

function fileMeta(file: File, check: SongFileCheck): string {
  const size = formatFileSize(file.size)
  switch (check.status) {
    case 'checking':
      return `길이 확인 중 · ${size}`
    case 'valid':
    case 'too-long':
      return `${formatClockDuration(check.durationSeconds)} · ${size}`
    case 'unreadable':
      return `길이 알 수 없음 · ${size}`
    case 'invalid-format':
      // A disallowed format is never decoded, so only the size is known.
      return size
  }
}

function StatusMark({ check }: { check: SongFileCheck }) {
  if (check.status === 'checking')
    return <span className={styles.spinner} aria-hidden="true" />
  return (
    <Icon name={check.status === 'valid' ? 'checkDone' : 'alertTriangle'} />
  )
}

export function SongFilePicker({
  file,
  check,
  disabled,
  describedBy,
  onChoose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLButtonElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const titleId = useId()
  const hintId = useId()
  const invalid =
    check !== null && check.status !== 'checking' && check.status !== 'valid'
  const showingFile = file !== null && check !== null

  // The drop area that opened the chooser is replaced by the file card, so
  // focus would otherwise fall back to the document.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (showingFile && (active === null || active === document.body))
      replaceRef.current?.focus()
  }, [showingFile])

  function pick() {
    if (!disabled) inputRef.current?.click()
  }

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (!disabled) setDragActive(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && event.currentTarget.contains(next)))
        setDragActive(false)
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragActive(false)
      if (!disabled) onChoose([...event.dataTransfer.files])
    },
  }

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        type="file"
        accept={songFileAccept()}
        hidden
        onChange={(event) => {
          onChoose([...(event.currentTarget.files ?? [])])
          // Allow choosing the same file again after an error.
          event.currentTarget.value = ''
        }}
      />
      {file && check ? (
        <div
          className={styles.fileCard}
          data-invalid={invalid}
          data-drag-active={dragActive}
          {...dropHandlers}
        >
          <span className={styles.fileIcon}>
            <Icon name="music" />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileName} title={file.name}>
              {file.name}
            </span>
            <span
              className={styles.fileMeta}
              data-alert={check.status === 'too-long'}
            >
              {fileMeta(file, check)}
            </span>
          </span>
          <button
            ref={replaceRef}
            type="button"
            className={styles.replace}
            onClick={pick}
            disabled={disabled}
            aria-describedby={describedBy}
          >
            파일 바꾸기
          </button>
          <StatusMark check={check} />
        </div>
      ) : (
        <button
          type="button"
          className={styles.dropzone}
          data-drag-active={dragActive}
          onClick={pick}
          disabled={disabled}
          aria-labelledby={titleId}
          aria-describedby={describedBy ? `${hintId} ${describedBy}` : hintId}
          {...dropHandlers}
        >
          <Icon name="upload" />
          <span className={styles.dropTitle} id={titleId}>
            파일을 끌어다 놓거나 선택하세요
          </span>
          <span className={styles.dropHint} id={hintId}>
            {uploadHintLabel()}
          </span>
        </button>
      )}
    </div>
  )
}
