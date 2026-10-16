import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty, docLink } from '@/lib/property';
import { CERTS, certStatus, depositStatus, prescribedInfo, onboardingChecklist, fmt, money } from '@/lib/rules';
import { markLive } from './actions';

const SAVED = { details: 'Property and landlord saved', tenancy: 'Tenancy saved', deposit: 'Deposit saved', certificate: 'Certificate recorded', live: 'Onboarding finished. This property is now live' };

export default async function Property({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  const data = await loadProperty(sb, id);
  if (!data) notFound();
  const { p, owners, tenancy, tenants, certs } = data;
  const staff = isStaff(member);
  const L = owners[0] && owners[0].landlords, lc = (L && L.contacts) || {};
  const list = onboardingChecklist(data);
  const ds = depositStatus(tenancy), pi = prescribedInfo(tenancy);
  const certDocs = Object.fromEntries(await Promise.all(certs.map(async (c) => [c.kind, await docLink(sb, c.document_id)])));
  const piDoc = tenancy ? await docLink(sb, tenancy.pi_document_id) : null;
  const { count: openRepairs } = await sb.from('repairs').select('id', { count: 'exact', head: true }).eq('property_id', id).in('status', ['reported', 'assigned', 'invoiced']);
  const live = p.onboarding_status === 'live';

  return (
    <>
      <Link href="/" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Homes</Link>
      <div className="pagehead"><h1>{p.address_line1}</h1><span className="sub">{[p.address_line2, p.town, p.postcode].filter(Boolean).join(', ')}{p.bedrooms != null ? ` · ${p.bedrooms} bed ${String(p.property_type).toLowerCase()}` : ''}</span></div>
      {sp.saved && <div className="note" role="status">{SAVED[sp.saved] || 'Saved'}</div>}
      {sp.error && <div className="error" role="alert">{sp.error}</div>}

      {!live && (
        <div className="card">
          <div className="row"><div className="stack" style={{ gap: 2 }}><h3>Onboarding</h3><span className="muted small">{list.done} of {list.total} done. Finish these before the property goes live.</span></div>
            <span className={'pill ' + (list.complete ? 'ok' : 'due')}>{Math.round(100 * list.done / list.total)}%</span></div>
          {['Property', 'Landlord', 'Safety', 'Tenancy'].map((g) => {
            const rows = list.items.filter((i) => i.group === g); if (!rows.length) return null;
            return (<div key={g} className="stack" style={{ gap: 4 }}><b className="small">{g}</b>
              {rows.map((i) => <span key={i.label} className="small" style={{ color: i.done ? 'var(--muted)' : 'var(--ink)' }}><span aria-hidden="true" style={{ display: 'inline-block', width: 20, fontWeight: 700, color: i.done ? 'var(--accent)' : 'var(--bad-ink)' }}>{i.done ? '✓' : '○'}</span>{i.label}</span>)}</div>);
          })}
          {staff && (list.complete
            ? <form action={markLive.bind(null, id)}><button className="btn">Finish onboarding · mark live</button></form>
            : <span className="muted small">Tap Edit on each section below to fill in what's missing.</span>)}
        </div>
      )}

      <div className="card">
        <div className="row"><h3>Property and landlord</h3>{staff && <Link className="btn ghost small" href={`/properties/${id}/details`}>Edit</Link>}</div>
        <span className="small">Keys: {p.keys_location || <span className="muted">not recorded</span>}</span>
        {p.property_type === 'HMO' && <span className="small">HMO licence: {p.hmo_licence_number || 'not recorded'}{p.hmo_licence_expires ? ' · expires ' + fmt(p.hmo_licence_expires) : ''}</span>}
        {L ? (<div className="stack" style={{ gap: 2 }}><b>{lc.full_name}</b>
          <span className="muted small">{[lc.email, lc.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
          <span className="muted small">Registration {L.registration_number || 'not recorded'}{L.registration_expires ? ' · expires ' + fmt(L.registration_expires) : ''} · {L.package} package · spend limit {money(L.approval_limit_pence)}</span></div>)
          : <span className="muted">No landlord recorded yet.</span>}
      </div>

      <div className="card">
        <div className="row"><h3>Tenancy</h3>{staff && <Link className="btn ghost small" href={`/properties/${id}/tenancy`}>{tenancy ? 'Edit' : 'Add tenancy'}</Link>}</div>
        {tenancy ? (<>
          <span>{tenants.map((t) => t.contacts && t.contacts.full_name).filter(Boolean).join(' & ') || 'Tenant not recorded'}</span>
          <span className="muted small">{tenancy.status === 'pending' ? 'Starts' : 'Started'} {fmt(tenancy.start_date)} · {money(tenancy.rent_pence)} a month, due on day {tenancy.rent_due_day}{tenancy.taken_over ? ' · taken over from a previous agent' : ''}</span>
        </>) : <span className="muted">Vacant. Add a tenancy when a tenant moves in.</span>}
      </div>

      {tenancy && Number(tenancy.deposit_pence) > 0 && (
        <div className="card">
          <div className="row"><h3>Deposit {money(tenancy.deposit_pence)}</h3>{staff && <Link className="btn ghost small" href={`/properties/${id}/deposit`}>Edit</Link>}</div>
          <div className="row"><span className="small">Protection</span><span className={'pill ' + ds.cls}>{ds.text}</span></div>
          {tenancy.deposit_lodged_on && <span className="muted small">{tenancy.deposit_scheme}{tenancy.deposit_reference ? ' · ref ' + tenancy.deposit_reference : ' · reference not recorded'}</span>}
          {pi && <div className="row"><span className="small">Prescribed information</span><span className={'pill ' + pi.cls}>{pi.text}</span></div>}
          {piDoc && <a className="small" href={piDoc.url} target="_blank" rel="noopener">View copy: {piDoc.name}</a>}
        </div>
      )}

      <div className="card"><h3>Certificates</h3>
        {CERTS.map((c) => { const cert = certs.find((x) => x.kind === c.key), st = certStatus(c, cert), doc = certDocs[c.key];
          return (<div key={c.key} className="stack" style={{ gap: 4 }}>
            <div className="row"><span>{c.label}</span><span className={'pill ' + st.cls}>{st.text}</span></div>
            <span className="muted small">{cert ? `Checked ${fmt(cert.checked_on)} · ${cert.result}${cert.carried_out_by ? ' · ' + cert.carried_out_by : ''}` : c.rule}
              {doc ? <> · <a href={doc.url} target="_blank" rel="noopener">View certificate</a></> : cert ? ' · no copy uploaded' : ''}
              {staff && <> · <Link href={`/properties/${id}/certificate/${c.key}`}>{cert ? 'Record new' : 'Record'}</Link></>}</span>
          </div>); })}
      </div>

      <div className="card"><div className="row"><h3>Repairs</h3><span className={'pill ' + (openRepairs ? 'due' : 'ok')}>{openRepairs || 0} open</span></div>
        <div className="row">{openRepairs ? <Link className="small" href="/repairs">See repairs</Link> : <span className="muted small">Nothing open.</span>}
          {staff && <Link className="btn ghost small" href={`/repairs/new?p=${id}`}>Log a repair</Link>}</div></div>
    </>
  );
}
