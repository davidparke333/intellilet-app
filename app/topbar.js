export default function TopBar({ sub }) {
  return (
    <div className="topbar">
      <div className="brand"><div className="logo" aria-hidden="true">iL</div>
        <div><b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>IntelliLet</b><div className="muted small">{sub}</div></div></div>
      <form action="/auth/signout" method="post"><button className="btn ghost small">Sign out</button></form>
    </div>
  );
}
