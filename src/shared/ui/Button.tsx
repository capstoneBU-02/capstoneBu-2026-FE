import type { ComponentPropsWithRef } from 'react'
import styles from './Ui.module.css'

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  compact?: boolean
}

export function Button({
  variant = 'secondary',
  compact = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${compact ? styles.compact : ''} ${className}`}
      {...props}
    />
  )
}
