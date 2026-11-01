import check from '../../assets/earmark/check.svg'
import chevronDown from '../../assets/earmark/chevron-down.svg'
import chevronRight from '../../assets/earmark/chevron-right.svg'
import close from '../../assets/earmark/close.svg'
import help from '../../assets/earmark/help.svg'
import info from '../../assets/earmark/info.svg'
import list from '../../assets/earmark/list.svg'
import more from '../../assets/earmark/more.svg'
import plus from '../../assets/earmark/plus.svg'
import plusSmall from '../../assets/earmark/plus-small.svg'
import settings from '../../assets/earmark/settings.svg'
import statusDone from '../../assets/earmark/status-done.svg'
import statusFailed from '../../assets/earmark/status-failed.svg'
import statusProcessing from '../../assets/earmark/status-processing.svg'
import upload from '../../assets/earmark/upload.svg'
import styles from './Ui.module.css'

const icons = {
  check: [check, 12],
  chevronDown: [chevronDown, 12],
  chevronRight: [chevronRight, 14],
  close: [close, 16],
  help: [help, 15],
  info: [info, 14],
  list: [list, 15],
  more: [more, 14],
  plus: [plus, 14],
  plusSmall: [plusSmall, 10],
  settings: [settings, 15],
  statusDone: [statusDone, 6],
  statusFailed: [statusFailed, 6],
  statusProcessing: [statusProcessing, 6],
  upload: [upload, 20],
} as const

export type IconName = keyof typeof icons

export function Icon({
  name,
  className = '',
}: {
  name: IconName
  className?: string
}) {
  const [src, size] = icons[name]
  return (
    <img
      className={`${styles.icon} ${className}`}
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  )
}
