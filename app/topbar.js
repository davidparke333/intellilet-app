import Link from 'next/link';

export default function TopBar({ sub, here }) {
  const tabs = [['/', 'Homes'], ['/repairs', 'Repairs'], ['/checks', 'Checks'], ['/money', 'Money'], ['/contractors', 'Trades']];
  return (
    <>
      <div className="topbar">
        <div className="brand"><div className="logo" aria-hidden="true">iL</div>
          <div><b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>IntelliLet</b><div className="muted small">{sub}</div></div></div>
        <form action="/auth/signout" method="post"><button className="btn ghost small">Sign out</button></form>
      </div>
      <nav className="segs" aria-label="Sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map(([href, label]) => <Link key={href} href={href} className={'btn small ' + (here === href ? '' : 'ghost')} aria-current={here === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </>
  );
}
