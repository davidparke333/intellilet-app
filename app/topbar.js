import Link from 'next/link';
import styles from './TopBar.module.css';

export default function TopBar({ sub, here }) {
  const tabs = [['/today', 'Today'], ['/', 'Homes'], ['/repairs', 'Repairs'], ['/checks', 'Checks'], ['/money', 'Money'], ['/contractors', 'Trades'], ['/access', 'Access'], ['/team', 'Team']];
  return (
    <>
      <div className="topbar">
        <div className="brand"><div className="logo" aria-hidden="true">iL</div>
          <div><b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>IntelliLet</b><div className="muted small">{sub}</div></div></div>
        <form action="/auth/signout" method="post"><button className="btn ghost small">Sign out</button></form>
      </div>
      <nav className={styles.navigation} aria-label="Sections">
        {tabs.map(([href, label]) => <Link key={href} href={href} className={styles.tab + ' btn small ' + (here === href ? '' : 'ghost')} aria-current={here === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </>
  );
}
