import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';

const CERTS = [['gas', 'Gas safety (CP12)'], ['eicr', 'EICR'], ['epc', 'EPC'], ['alarms', 'Smoke, heat & CO alarms'], ['legionella', 'Legionella risk assessment']];
const fmt = (d) => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const daysUntil = (d) => Math.round((new Date(d + 'T00:00:00Z') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);

export default async function Property({ params }) {
  const { id } = await params;
  const { sb } = await currentMember();
  const { data: p } = await sb.from('properties')
    .select('*, property_owners(landlords(registration_number, registration_expires, contacts(full_name, email, phone))), tenancies(*, tenancy_people(is_lead, contacts(full_name, email, phone)))')
    .eq('id', id).maybeSingle();
  if (!p) notFound();
  const { data: certs } = await sb.from('current_certificates').select('kind, expires_on, passed, result, basis').eq('property_id', id);
  const { count: openRepairs } = await sb.from('repairs').select('id', { count: 'exact', head: true }).eq('property_id', id).in('status', ['reported', 'assigned', 'invoiced']);
  const t = (p.tenancies || []).find((x) => x.status === 'active');
  return (
    <>
      <Link href="/" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Homes</Link>
      <div className="pagehead"><h1>{p.address_line1}</h1><span className="sub">{[p.address_line2, p.town, p.postcode].filter(Boolean).join(', ')}</span></div>
      <div className="card"><h3>Landlord</h3>
        {(p.property_owners || []).length ? p.property_owners.map((o, i) => { const c = (o.landlords && o.landlords.contacts) || {}; return (
          <div key={i} className="stack" style={{ gap: 2 }}><b>{c.full_name}</b><span className="muted small">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}{o.landlords.registration_number ? ' · reg ' + o.landlords.registration_number : ''}</span></div>); })
          : <span className="muted">No landlord recorded yet.</span>}
      </div>
      <div className="card"><h3>Tenancy</h3>
        {t ? (<><span>{(t.tenancy_people || []).map((x) => x.contacts && x.contacts.full_name).filter(Boolean).join(', ') || 'Tenant not recorded'}</span>
          <span className="muted small">Started {fmt(t.start_date)} · £{(t.rent_pence / 100).toFixed(2)} a month · deposit £{(t.deposit_pence / 100).toFixed(2)}</span></>)
          : <span className="muted">Vacant.</span>}
      </div>
      <div className="card"><h3>Certificates</h3>
        {CERTS.map(([k, label]) => { const c = (certs || []).find((x) => x.kind === k); const d = c ? daysUntil(c.expires_on) : null;
          const st = !c ? ['bad', 'Missing'] : !c.passed ? ['bad', 'Failed · remedial work needed'] : d < 0 ? (c.basis === 'policy' ? ['due', 'Review overdue'] : ['bad', 'Expired']) : d <= 60 ? ['due', 'Due in ' + d + ' days'] : ['ok', 'Valid to ' + fmt(c.expires_on)];
          return <div key={k} className="row"><span>{label}</span><span className={'pill ' + st[0]}>{st[1]}</span></div>; })}
      </div>
      <div className="card"><div className="row"><h3>Repairs</h3><span className={'pill ' + (openRepairs ? 'due' : 'ok')}>{openRepairs || 0} open</span></div></div>
      <p className="muted small">This is the first version of the real app. Tenancies, certificates, repairs and the rest of the prototype's screens are added next, one at a time.</p>
    </>
  );
}
