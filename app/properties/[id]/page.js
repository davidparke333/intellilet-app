import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty, docLink } from '@/lib/property';
import { CERTS, certStatus, depositStatus, prescribedInfo, onboardingChecklist, fmt, money, inspectionDue, findingState, checkLabel, INSPECT_MONTHS } from '@/lib/rules';
import ActionForm from '@/components/ActionForm';
import { raiseFromFinding, linkFinding, closeFinding } from '@/app/checks/actions';
import { markLive } from './actions';

const SAVED = { details: 'Property and landlord saved', tenancy: 'Tenancy saved', deposit: 'Deposit saved', certificate: 'Certificate recorded', live: 'Onboarding finished. This property is now live', inspection_pass: 'Inspection saved: everything passed', inspection_repairs: 'Inspection saved. A repair was raised (or linked) for each action', inspection_actions: 'Inspection saved. The actions are listed below, still open', inspection_damp: 'Inspection saved. Damp and mould always gets a repair (the legal deadlines have started). Other actions are listed below', finding_linked: 'Finding linked to the repair', finding_closed: 'Finding closed, the reason is on record' };

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
  const [{ data: insps }, { data: finds }, { data: openR }, { data: setting }] = await Promise.all([
    sb.from('inspections').select('id, inspected_on').eq('property_id', id).order('inspected_on', { ascending: false }).limit(5),
    sb.from('inspection_findings').select('*, inspections(inspected_on), repairs(id, status, verified_at, tenant_confirmed, category)').eq('property_id', id),
    sb.from('repairs').select('id, category, description, reported_at').eq('property_id', id).in('status', ['reported', 'assigned', 'invoiced']).order('reported_at', { ascending: false }),
    sb.from('agency_settings').select('inspection_months').maybeSingle()
  ]);
  const lastI = (insps || [])[0], iDue = inspectionDue(lastI && lastI.inspected_on, (setting && setting.inspection_months) || INSPECT_MONTHS);
  const findings = (finds || []).map((f) => ({ ...f, st: findingState(f) })).sort((a, b) => (b.st.open - a.st.open) || String(b.inspections.inspected_on).localeCompare(a.inspections.inspected_on));
  const openFindings = findings.filter((f) => f.st.open);

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
          <Link className="small" href={'/money/rent/' + tenancy.id}>Rent account and payments</Link>
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

      <div className="card"><div className="row"><h3>Certificates</h3><Link className="btn ghost small" href={'/portal/compliance/' + id}>Compliance record</Link></div>
        {CERTS.map((c) => { const cert = certs.find((x) => x.kind === c.key), st = certStatus(c, cert), doc = certDocs[c.key];
          return (<div key={c.key} className="stack" style={{ gap: 4 }}>
            <div className="row"><span>{c.label}</span><span className={'pill ' + st.cls}>{st.text}</span></div>
            <span className="muted small">{cert ? `Checked ${fmt(cert.checked_on)} · ${cert.result}${cert.carried_out_by ? ' · ' + cert.carried_out_by : ''}` : c.rule}
              {doc ? <> · <a href={doc.url} target="_blank" rel="noopener">View certificate</a></> : cert ? ' · no copy uploaded' : ''}
              {staff && <> · <Link href={`/properties/${id}/certificate/${c.key}`}>{cert ? 'Record new' : 'Record'}</Link></>}</span>
          </div>); })}
      </div>

      <div className="card">
        <div className="row"><h3>Inspections</h3><span className={'pill ' + iDue.cls}>{iDue.text}</span></div>
        <span className="muted small">{lastI ? <>Last inspected {fmt(lastI.inspected_on)} · <Link href={'/checks/report/' + lastI.id}>Report for the landlord</Link></> : 'No inspection on record yet.'}
          {(insps || []).length > 1 && <> · earlier: {insps.slice(1).map((x, n) => <span key={x.id}>{n ? ', ' : ''}<Link href={'/checks/report/' + x.id}>{fmt(x.inspected_on)}</Link></span>)}</>}</span>
        {staff && <Link className={'btn small ' + (iDue.cls === 'ok' ? 'ghost' : '')} href={'/checks/inspect/' + id}>Start inspection</Link>}
        {findings.length > 0 && <div className="row"><b className="small">Findings</b><span className={'pill ' + (openFindings.length ? 'bad' : 'ok')}>{openFindings.length ? openFindings.length + ' open' : 'All resolved'}</span></div>}
        {findings.length > 0 && <span className="muted small">Each problem found stays open until its repair is done and checked, or it is closed with a reason.</span>}
        {findings.filter((f) => f.st.open || sp.allf).map((f) => (
          <div key={f.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div className="row"><span><b>{f.check_code} · {checkLabel(f.check_code)}</b><br /><span className="muted small">Found {fmt(f.inspections.inspected_on)}{f.note ? ' · ' + f.note : ''}</span></span><span className={'pill ' + f.st.cls}>{f.st.open ? 'Open' : 'Done'}</span></div>
            <span className="small">{f.st.text}{f.repairs && f.repairs.status !== 'cancelled' ? <> · <Link href={'/repairs/' + f.repairs.id}>Open the repair</Link></> : ''}</span>
            {staff && f.st.open && f.st.noRepair && (<>
              <form action={raiseFromFinding.bind(null, f.id)}><button className="btn small" style={{ width: '100%' }}>Raise a repair</button></form>
              {(openR || []).length > 0 && <ActionForm className="row" action={linkFinding.bind(null, f.id)}>
                <select name="repair_id" aria-label="Link to an open repair" defaultValue=""><option value="">Or link to an open repair…</option>{openR.map((r) => <option key={r.id} value={r.id}>{r.category} · {fmt(r.reported_at.slice(0, 10))} · {r.description.slice(0, 40)}</option>)}</select>
                <button className="btn ghost small">Link</button></ActionForm>}
            </>)}
            {staff && f.st.open && <details className="more"><summary>Close without a repair</summary>
              <ActionForm className="stack" action={closeFinding.bind(null, f.id)}>
                <div className="field"><label htmlFor={'cr' + f.id}>Reason (kept on record)</label><input id={'cr' + f.id} name="reason" placeholder="e.g. Landlord fixed it himself, photos on file" /></div>
                <button className="btn ghost small">Close this finding</button></ActionForm></details>}
          </div>))}
        {findings.length > openFindings.length && <Link className="small" href={sp.allf ? `/properties/${id}` : `/properties/${id}?allf=1`}>{sp.allf ? 'Hide resolved findings' : 'Show resolved findings (' + (findings.length - openFindings.length) + ')'}</Link>}
      </div>

      <div className="card"><div className="row"><h3>Repairs</h3><span className={'pill ' + (openRepairs ? 'due' : 'ok')}>{openRepairs || 0} open</span></div>
        <div className="row">{openRepairs ? <Link className="small" href="/repairs">See repairs</Link> : <span className="muted small">Nothing open.</span>}
          {staff && <Link className="btn ghost small" href={`/repairs/new?p=${id}`}>Log a repair</Link>}</div></div>
    </>
  );
}
