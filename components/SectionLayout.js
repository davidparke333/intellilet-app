import styles from './SectionLayout.module.css';
export default function SectionLayout({ children }) { return <div className={styles.root}>{children}</div>; }
export function SectionGrid({ children, wide = false }) { return <div className={wide ? styles.wideGrid : styles.grid}>{children}</div>; }
export function SectionSummary({ items }) { return <div className={styles.summary}>{items.map(({ label, value, hint, danger }) => <div className={styles.metric} key={label} data-danger={danger || undefined}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>)}</div>; }
