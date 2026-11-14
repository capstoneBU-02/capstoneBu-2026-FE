import { useCallback, useId, useState } from 'react'
import fileIcon from '../../../assets/figma/support/file-16.svg'
import { Button } from '../../../shared/ui/Button.tsx'
import { Icon } from '../../../shared/ui/Icon.tsx'
import { Menu } from '../../../shared/ui/Menu.tsx'
import type { TabDownload, TabFormat } from '../useTabDownload.ts'
import pageStyles from '../WorkspacePage.module.css'
import styles from './TabDownload.module.css'

const FORMATS = [
  {
    format: 'png',
    label: 'PNG 이미지',
    description: '보이는 타브를 그림 한 장으로',
  },
  { format: 'pdf', label: 'PDF', description: '인쇄하기 좋게 페이지로 나눠서' },
] as const satisfies readonly {
  format: TabFormat
  label: string
  description: string
}[]

function progressText({ busy, saved }: Pick<TabDownload, 'busy' | 'saved'>) {
  if (busy !== null) return '타브를 내려받는 중이에요.'
  return saved ? '타브를 내려받았어요.' : ''
}

// 내려받기 and its menu of file kinds. While a file is being made the button
// says so and opens nothing. A failure has a notice of its own; the status
// line reads out the rest.
export function TabDownloadMenu({
  download,
}: {
  download: Pick<TabDownload, 'busy' | 'saved' | 'triggerRef' | 'start'>
}) {
  const { busy, triggerRef, start } = download
  const [open, setOpen] = useState(false)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className={styles.anchor}>
      <Button
        ref={triggerRef}
        compact
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={busy !== null}
        onClick={() => {
          if (busy === null) setOpen((last) => !last)
        }}
      >
        <Icon name="download" />
        {busy === null ? '내려받기' : '내려받는 중…'}
      </Button>
      <Menu
        open={open}
        label="내려받기"
        onClose={close}
        triggerRef={triggerRef}
        className={styles.menu}
      >
        {FORMATS.map(({ format, label, description }) => (
          <button
            type="button"
            role="menuitem"
            key={format}
            tabIndex={-1}
            className={styles.item}
            aria-labelledby={`${id}-${format}`}
            aria-describedby={`${id}-${format}-about`}
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus({ preventScroll: true })
              start(format)
            }}
          >
            <img
              src={fileIcon}
              width={16}
              height={16}
              alt=""
              aria-hidden="true"
              draggable="false"
            />
            <span className={styles.text}>
              <span id={`${id}-${format}`} className={styles.label}>
                {label}
              </span>
              <span id={`${id}-${format}-about`} className={styles.about}>
                {description}
              </span>
            </span>
          </button>
        ))}
      </Menu>
      <span
        className={pageStyles.srOnly}
        role="status"
        data-announcer="tab-download"
      >
        {progressText(download)}
      </span>
    </div>
  )
}

// Shown above the player bar after a download fails; the tab stays as it
// is. Its button tries the same file again.
export function TabDownloadFailure({
  download,
}: {
  download: Pick<TabDownload, 'busy' | 'failure' | 'noticeRef' | 'start'>
}) {
  const { busy, failure, noticeRef, start } = download
  if (failure === null) return null
  return (
    <div ref={noticeRef} className={styles.failure} role="alert">
      <Icon name="alertTriangle" />
      {/* A new failure is a new line, read out again. */}
      <p key={failure.count}>타브를 내려받지 못했어요.</p>
      <Button
        compact
        className={styles.retry}
        aria-disabled={busy !== null}
        data-busy={busy !== null}
        onClick={() => {
          if (busy === null) start(failure.format)
        }}
      >
        다시 시도
      </Button>
    </div>
  )
}
