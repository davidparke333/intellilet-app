import Link from 'next/link';
import { currentMember } from '@/lib/supabase/server';
import TopBar from '../topbar';
import { PRIORITY, REPAIR_FILTERS, STATUS_LABEL, daysOpen, pastTarget, repairNext, money } from '@/lib/rules';

const addr = (p) => p ? p.address_line1 + (p.postcode ? ', ' + p.postcode : '') : '';

export default async function Repairs({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  const f = REPAIR_FILTERS.find((x) => x[0] === sp.f) || REPAIR_FILTERS[0];
  const { data: all } = await sb.from('repairs').select('id, category, description, priority, is_damp, status, reported_at, verified_at, tenant_confirmed, properties(id, address_line1, postcode), contractors(contacts(full_name))').order('reported_at', { ascending: false }).limit(500);
  const R = all || [];
  const list = R.filter((r) => f[2].includes(r.status)).sort((a, b) => pastTarget(b) - pastTarget(a));
  const late = R.filter(pastTarget).length;
  const { data: toPay } = await sb.from('invoices').select('total_pence').eq('status', 'approved');
  const owed = (toPay || []).reduce((t, i) => t + i.total_pence, 0);
  const agencyName = (member && member.agencies && (member.agencies.trading_name || member.agencies.name)) || 'IntelliLet';
  return (
    <>
      <TopBar sub={`${agencyName} · ${member ? member.role : ''}`} here="/repairs" />
      <div className="row"><div className="pagehead"><h1>Repairs</h1><span className="sub">{R.filter((r) => !['paid', 'cancelled'].includes(r.status)).length} in progress</span></div>
        <Link className="btn small" href="/repairs/new">Log a repair</Link></div>
      {(late > 0 || owed > 0) && <div className="note">{[late ? late + ' past target time' : '', owed ? money(owed) + ' owed to contractors' : ''].filter(Boolean).join(' · ')}</div>}
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {REPAIR_FILTERS.map(([id, label, st]) => <Link key={id} href={'/repairs?f=' + id} className={'btn small ' + (f[0] === id ? '' : 'ghost')}>{label} {R.filter((r) => st.includes(r.status)).length}</Link>)}
      </nav>
      {!list.length && <div className="card"><h3>{f[0] === 'mine' ? 'Nothing for you to do' : 'Nothing here'}</h3><p className="muted">{R.length ? 'No repairs in this group.' : 'Repairs you log appear here.'}</p></div>}
      {list.map((r) => { const st = STATUS_LABEL[r.status] || STATUS_LABEL.reported, pr = PRIORITY[r.priority], late = pastTarget(r), d = daysOpen(r.reported_at), next = repairNext(r);
        return (
          <Link key={r.id} href={'/repairs/' + r.id} className="card proplink">
            <div className="row"><h3>{r.category}</h3><span className={'pill ' + st[0]}>{st[1]}</span></div>
            <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>{addr(r.properties)}</span>
            <span className="small">{r.description}</span>
            <span className="small"><span className={'pill ' + (late ? 'bad' : r.priority === 'routine' ? 'info' : 'due')}>{pr.label}{late ? ' · past ' + pr.days + '-day target' : ' · ' + pr.days + '-day target'}</span>{r.is_damp ? ' · Damp & mould log' : ''} · {d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago'}{r.contractors ? ' · ' + r.contractors.contacts.full_name : ''}</span>
            {next && <div className="nextbox"><span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)' }}>Next step</span><b>{next}</b></div>}
          </Link>); })}
    </>
  );
}
