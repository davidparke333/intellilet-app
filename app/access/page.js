import TopBar from '../topbar';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { grantAccess, revokeAccess } from './actions';

// Who can sign in to the portals. Logins are created by inviting the person from Supabase; this links that login to their record.
export default async function Access({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/portal');
  const [{ data: lls }, { data: tps }, { data: cons }, { data: ms }] = await Promise.all([
    sb.from('landlords').select('contact_id, contacts(full_name, email)').is('archived_at', null),
    sb.from('tenancy_people').select('contact_id, contacts(full_name, email), tenancies!inner(status, properties(address_line1))').in('tenancies.status', ['active', 'pending']),
    sb.from('contractors').select('contact_id, status, contacts(full_name, email)').eq('status', 'approved'),
    sb.from('memberships').select('contact_id, role, active')
  ]);
  const has = (cid, role) => (ms || []).some((m) => m.contact_id === cid && m.role === role && m.active);
  const groups = [
    ['landlord', 'Landlords', (lls || []).map((l) => ({ id: l.contact_id, ...l.contacts }))],
    ['tenant', 'Tenants', (tps || []).map((t) => ({ id: t.contact_id, ...t.contacts, where: t.tenancies.properties && t.tenancies.properties.address_line1 }))],
    ['contractor', 'Contractors', (cons || []).map((c) => ({ id: c.contact_id, ...c.contacts }))]
  ];
  return (<>
    <TopBar here="/access" />
    <div className="pagehead"><h1>Portal access</h1><span className="sub">Let landlords, tenants and contractors sign in to see their own information.</span></div>
    {sp.saved && <div className="note" role="status">{sp.saved}</div>}
    {sp.error && <div className="error" role="alert">{sp.error}</div>}
    <details className="card" open={!!sp.error}><summary><b>How to give someone access (2 steps)</b></summary>
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
        <li>In Supabase, go to <b>Authentication → Users → Add user → Send invitation</b> and enter their email. They get an email to set a password. (If the link in that email doesn't work for them, they can use "Forgotten password" on the sign-in page instead.)</li>
        <li>Back here, press <b>Give access</b> next to their name. Their email here must match the one you invited.</li>
      </ol>
      <span className="muted small">They only ever see their own records: a landlord their properties, a tenant their home, a contractor the jobs booked with them.</span>
    </details>
    {groups.map(([role, title, people]) => (
      <div key={role} className="card"><h3>{title}</h3>
        {!people.length && <span className="muted small">None yet.</span>}
        {people.map((p) => { const on = has(p.id, role); return (
          <div key={p.id + role} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <span className="small"><b>{p.full_name}</b>{p.where ? ' · ' + p.where : ''}<br /><span className="muted">{p.email || 'No email recorded'}</span></span>
            {on ? <form action={revokeAccess.bind(null, p.id, role)}><span className="pill ok" style={{ marginRight: 8 }}>Has access</span><button className="btn ghost small">Remove</button></form>
              : <form action={grantAccess.bind(null, p.id, role)}><button className="btn small" disabled={!p.email}>Give access</button></form>}
          </div>); })}
      </div>))}
  </>);
}
