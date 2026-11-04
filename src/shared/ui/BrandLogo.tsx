import styles from './Ui.module.css'

export function BrandLogo() {
  return (
    <div className={styles.logo} role="img" aria-label="earmark">
      <span className={styles.logoMark} aria-hidden="true">
        <span className={styles.logoSelection} />
        {[1, 2, 3, 4, 5].map((bar) => (
          <span key={bar} className={styles.logoBar} data-bar={bar} />
        ))}
      </span>
      <span className={styles.logoWord} aria-hidden="true">
        earmark
      </span>
    </div>
  )
}
