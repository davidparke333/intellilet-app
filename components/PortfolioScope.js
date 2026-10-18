import Link from 'next/link';
import { endPortfolioPreview } from '@/app/team/actions';
export default function PortfolioScope({ base, scope, profile, q }) {
  const href = (value) => base + '?' + new URLSearchParams({ scope: value, ...(q ? { q } : {}) });
  return <div className="stack" style={{ gap: 8 }}>
    {profile?.preview && <form action={endPortfolioPreview} className="note row" style={{ flexWrap: 'wrap' }}><span className="small"><b>Portfolio preview: {profile.full_name}</b><br />Your own account remains responsible for any changes.</span><button className="btn ghost small">Exit preview</button></form>}
    <nav className="row" aria-label="Portfolio view" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
      <Link href={href('mine')} className={'btn small ' + (scope === 'mine' ? '' : 'ghost')} aria-current={scope === 'mine' ? 'page' : undefined}>My portfolio</Link>
      <Link href={href('all')} className={'btn small ' + (scope === 'all' ? '' : 'ghost')} aria-current={scope === 'all' ? 'page' : undefined}>All properties</Link>
      {profile && <span className="muted small">{profile.full_name}</span>}
    </nav>
  </div>;
}
