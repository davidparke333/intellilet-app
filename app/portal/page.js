import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import CostFields from '@/components/CostFields';
import { CERTS, certStatus, dampStages, inspectionDue, quoteState, fmt, money, PRIORITY } from '@/lib/rules';
import { contractorDone, contractorQuote } from './actions';
import { exitPreview } from '../access/actions';
const NONE = ['00000000-0000-0000-0000-000000000000'];
const ids = (a) => (a && a.length ? a : NONE);

// What a landlord or tenant is told about a repair, in plain words
const plain = (r) => r.status === 'reported' ? ['due', 'Reported · arranging a contractor'] : r.status === 'assigned' ? ['info', 'Contractor booked'] : r.status === 'invoiced' && !r.verified_at ? ['info', 'Work done · being checked'] : r.status === 'cancelled' ? ['info', 'Closed'] : ['ok', 'Fixed'];
const Head = ({ name, agency, role, preview }) => (<>
  {preview && <form action={exitPreview} className="note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span className="small"><b>Preview:</b> this is exactly what {name || 'they'} will see.</span><button className="btn small">Back to staff view</button></form>}
  <div className="topbar"><div className="brand"><div className="logo" aria-hidden="true">iL</div>
    <div><b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>{agency}</b><div className="muted small">{name ? name + ' · ' : ''}{role} portal</div></div></div>
    {!preview && <form action="/auth/signout" method="post"><button className="btn ghost small">Sign out</button></form>}</div></>);

export default async function Portal({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!member) return <div className="card" style={{ marginTop: 24 }}><h1 style={{ fontSize: 22 }}>No access yet</h1><span className="muted">Your login works, but it hasn't been linked to your account with us yet. Please contact the agency.</span><form action="/auth/signout" method="post"><button className="btn ghost">Sign out</button></form></div>;
  if (isStaff(member) || member.role === 'readonly') redirect('/today');
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'Your letting agent';
  const { data: me } = await sb.from('contacts').select('full_name').eq('id', member.contact_id).maybeSingle();
  const name = me && me.full_name;
  const role = member.role;
  const saved = sp.saved && <div className="note" role="status">{sp.saved}</div>;

  // ---------------- landlord ----------------
  if (role === 'landlord') {
    const { data: ll } = await sb.from('landlords').select('id, approval_limit_pence').eq('contact_id', member.contact_id).limit(1).maybeSingle();
    const { data: own } = await sb.from('property_owners').select('property_id').eq('landlord_id', ll ? ll.id : NONE[0]);
    const pids = ids((own || []).map((o) => o.property_id));
    const [{ data: props }, { data: certs }, { data: reps }, { data: insps }, { data: bal }, { data: tens }] = await Promise.all([
      sb.from('properties').select('id, address_line1, postcode, onboarding_status').in('id', pids).order('address_line1'),
      sb.from('current_certificates').select('*').in('property_id', pids),
      sb.from('repairs').select('*').in('property_id', pids).order('reported_at', { ascending: false }),
      sb.from('inspections').select('id, property_id, inspected_on').in('property_id', pids).order('inspected_on', { ascending: false }),
      sb.from('landlord_balances').select('balance_pence').eq('landlord_id', ll ? ll.id : NONE[0]).maybeSingle(),
      sb.from('tenancies').select('property_id, status, rent_pence, start_date').in('property_id', pids)
    ]);
    const { data: lev } = await sb.from('repair_events').select('repair_id, kind, detail, at').in('repair_id', ids((reps || []).map((r) => r.id))).in('kind', ['quote', 'quote_decision']).order('at');
    const cap = (ll && ll.approval_limit_pence) || 25000;
    const waiting = (reps || []).filter((r) => r.status === 'assigned').map((r) => ({ r, Q: quoteState((lev || []).filter((e) => e.repair_id === r.id), cap) })).filter((x) => x.Q.stage === 'landlord');
    const addr = Object.fromEntries((props || []).map((p) => [p.id, p.address_line1]));
    return (<>
      <Head name={name} agency={agency} role="Landlord" preview={member.preview} />
      <div className="pagehead"><h1>Your properties</h1><span className="sub">Safety checks, repairs, inspections and money, kept up to date by {agency}.</span></div>
      {saved}
      {(props || []).map((p) => {
        const st = CERTS.map((c) => ({ c, s: certStatus(c, (certs || []).find((x) => x.property_id === p.id && x.kind === c.key)) }));
        const legalOk = st.filter((x) => x.c.basis === 'law').every((x) => x.s.ok);
        const open = (reps || []).filter((r) => r.property_id === p.id && !['paid', 'cancelled'].includes(r.status) && !(r.status === 'invoiced' && r.verified_at) && r.status !== 'approved');
        const last = (insps || []).find((i) => i.property_id === p.id), t = (tens || []).find((x) => x.property_id === p.id && x.status !== 'ended');
        return (<div key={p.id} className="card">
          <div className="row"><b>{p.address_line1}, {p.postcode}</b><span className={'pill ' + (legalOk ? 'ok' : 'bad')}>{legalOk ? 'All legal checks in date' : 'Legal check needs attention'}</span></div>
          <span className="muted small">{t ? (t.status === 'pending' ? 'Tenant moving in ' + fmt(t.start_date) : 'Let') + ' · ' + money(t.rent_pence) + ' a month' : 'Vacant'}</span>
          <details className="more"><summary>Safety certificates</summary>
            {st.map(({ c, s }) => <div key={c.key} className="row small"><span>{c.label}{c.basis === 'policy' ? ' (our schedule)' : ''}</span><span className={'pill ' + s.cls}>{s.text}</span></div>)}</details>
          <div className="row small"><span>Repairs in progress</span><b>{open.length}</b></div>
          {open.map((r) => { const pl = plain(r), D = r.is_damp ? dampStages(r) : null; return (
            <div key={r.id} className="stack small" style={{ gap: 2, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <div className="row"><span>{r.category}: {r.description.slice(0, 70)}</span><span className={'pill ' + pl[0]}>{pl[1]}</span></div>
              <span className="muted">Reported {fmt(String(r.reported_at).slice(0, 10))}{D && D.next ? ' · damp and mould legal step: ' + D.next.label.toLowerCase() + ', ' + D.next.st.text.toLowerCase() : ''}</span></div>); })}
          <span className="small">{last ? <>Last inspected {fmt(last.inspected_on)} · <Link href={'/portal/report/' + last.id}>Inspection report</Link></> : 'Not inspected yet'}</span>
        </div>); })}
      {!(props || []).length && <div className="card"><span className="muted">No properties are linked to your account yet.</span></div>}
      {ll && <div className="card">
        <div className="row"><h3>Money</h3><b>{money(bal ? bal.balance_pence : 0)} held for you</b></div>
        <span className="muted small">Held in our client account: rent received, less our fee and any repairs.</span>
        <Link href={'/portal/statement/' + ll.id} className="btn ghost small">Monthly statements</Link></div>}
    </>);
  }

  // ---------------- tenant ----------------
  if (role === 'tenant') {
    const { data: tp } = await sb.from('tenancy_people').select('tenancy_id').eq('contact_id', member.contact_id);
    const { data: t } = await sb.from('tenancies').select('id, property_id, start_date, rent_pence, rent_due_day, properties(address_line1, address_line2, town, postcode)').in('id', ids((tp || []).map((x) => x.tenancy_id))).in('status', ['active', 'pending']).limit(1).maybeSingle();
    const [{ data: certs }, { data: reps }] = await Promise.all([
      sb.from('current_certificates').select('*').eq('property_id', t ? t.property_id : NONE[0]),
      sb.from('repairs').select('*').eq('tenancy_id', t ? t.id : NONE[0]).order('reported_at', { ascending: false })
    ]);
    const { data: docs } = await sb.from('documents').select('id, storage_path, about_id').eq('about_table', 'certificates').in('about_id', ids((certs || []).map((c) => c.id)));
    const links = Object.fromEntries(await Promise.all((docs || []).map(async (d) => [d.about_id, (await sb.storage.from('documents').createSignedUrl(d.storage_path, 3600)).data?.signedUrl])));
    const tab = ['past', 'certs'].includes(sp.t) ? sp.t : 'home';
    const done = (r) => ['ok'].includes(plain(r)[0]) || r.status === 'cancelled';
    const current = (reps || []).filter((r) => !done(r)), past = (reps || []).filter(done);
    const repairRow = (r) => { const pl = plain(r), D = r.is_damp && r.status !== 'cancelled' ? dampStages(r) : null; return (
      <div key={r.id} className="stack small" style={{ gap: 2, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <div className="row"><span><b>{r.category}</b> · reported {fmt(String(r.reported_at).slice(0, 10))}</span><span className={'pill ' + pl[0]}>{pl[1]}</span></div>
        <span className="muted">{r.description}</span>
        {D && !done(r) && <span className="muted">Damp and mould: {D.stages.map((s) => s.label.split(' (')[0] + ' ' + (s.doneOn ? 'done ' + fmt(s.doneOn) : s.applies ? (s.due ? 'by ' + fmt(s.due) : 'next') : 'not needed')).join(' · ')}</span>}
      </div>); };
    return (<>
      <Head name={name} agency={agency} role="Tenant" preview={member.preview} />
      <div className="pagehead"><h1>Your home</h1><span className="sub">{t ? [t.properties.address_line1, t.properties.town, t.properties.postcode].filter(Boolean).join(', ') : ''}</span></div>
      {saved}
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['home', 'Home'], ['past', 'Past repairs' + (past.length ? ' (' + past.length + ')' : '')], ['certs', 'Certificates']].map(([k, l]) => <Link key={k} href={k === 'home' ? '/portal' : '/portal?t=' + k} className={'btn small ' + (tab === k ? '' : 'ghost')}>{l}</Link>)}
      </nav>
      {tab === 'home' && (<>
        <Link href="/portal/new-repair" className="btn">Report a repair</Link>
        <div className="card"><h3>Repairs in progress</h3>
          {!current.length && <span className="muted">Nothing in progress. If something needs fixing, press Report a repair.</span>}
          {current.map(repairRow)}
        </div>
        {t && <div className="card"><span className="small">Rent {money(t.rent_pence)} a month, due on day {t.rent_due_day}.</span></div>}
      </>)}
      {tab === 'past' && <div className="card"><h3>Past repairs</h3>
        {!past.length && <span className="muted">No finished repairs yet.</span>}
        {past.map(repairRow)}
      </div>}
      {tab === 'certs' && <div className="card"><h3>Safety certificates</h3>
        {!(certs || []).length && <span className="muted">No certificates recorded yet.</span>}
        {CERTS.map((c) => { const cert = (certs || []).find((x) => x.kind === c.key); if (!cert) return null; return (
          <div key={c.key} className="row small"><span>{c.label}<br /><span className="muted">Checked {fmt(cert.checked_on)}{cert.expires_on ? ' · next due ' + fmt(cert.expires_on) : ''}</span></span>
            {links[cert.id] ? <a href={links[cert.id]} target="_blank" rel="noopener">View</a> : <span className="muted">Copy with the agency</span>}</div>); })}
      </div>}
    </>);
  }

  // ---------------- contractor ----------------
  const { data: me2 } = await sb.from('contractors').select('id, vat_registered').eq('contact_id', member.contact_id).limit(1).maybeSingle();
  const cid = me2 ? me2.id : NONE[0];
  const [{ data: jobs }, { data: invs }] = await Promise.all([
    sb.from('repairs').select('*, properties(address_line1, address_line2, town, postcode, keys_location)').eq('contractor_id', cid).order('reported_at', { ascending: false }),
    sb.from('invoices').select('repair_id, status, total_pence, created_at').eq('contractor_id', cid)
  ]);
  const live = (jobs || []).filter((j) => j.status === 'assigned'), past = (jobs || []).filter((j) => j.status !== 'assigned');
  const { data: cev } = await sb.from('repair_events').select('repair_id, kind, detail, at').in('repair_id', ids(live.map((j) => j.id))).in('kind', ['quote', 'quote_decision']).order('at');
  const qOf = (j) => quoteState((cev || []).filter((e) => e.repair_id === j.id), Infinity);
  const contacts = Object.fromEntries(await Promise.all(live.map(async (j) => [j.id, ((await sb.rpc('contractor_job_contact', { p_repair: j.id })).data || [])])));
  const invLabel = { submitted: 'Invoice sent, waiting for approval', queried: 'Invoice queried, we will contact you', approved: 'Approved, payment on its way', paid: 'Paid' };
  return (<>
    <Head name={name} agency={agency} role="Contractor" preview={member.preview} />
    <div className="pagehead"><h1>Your jobs</h1><span className="sub">{live.length} booked with you</span></div>
    {saved}
    {!live.length && <div className="card"><span className="muted">No jobs booked with you right now.</span></div>}
    {live.map((j) => { const p = j.properties || {}, who = contacts[j.id] || []; return (
      <div key={j.id} className="card">
        <div className="row"><b>{j.category}</b><span className={'pill ' + (j.priority === 'emergency' ? 'bad' : j.priority === 'urgent' ? 'due' : 'info')}>{PRIORITY[j.priority].label}</span></div>
        <span>{[p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean).join(', ')}</span>
        <div className="problem"><span className="muted small">The problem</span><span>{j.description}</span></div>
        <span className="small">{who.length ? 'Tenant: ' + who.map((w) => w.tenant_name + (w.tenant_phone ? ' ' + w.tenant_phone : '')).join(', ') : 'No tenant: contact the agency for access'}</span>
        <span className="small">{j.access_with_key ? 'Tenant is happy for the agency key to be used if they are out' : 'Tenant must be in'}{j.best_times ? ' · best times: ' + j.best_times : ''}</span>
        {j.spend_limit_pence && <span className="small"><b>Don't go over {money(j.spend_limit_pence)}{me2 && me2.vat_registered ? ' plus VAT' : ''} without calling us first.</b></span>}
        {j.is_damp && <span className="small">Damp and mould job: please note the cause on your invoice and fix the cause, not just the mould.</span>}
        {(() => { const Q = qOf(j); return (<>
        {Q.stage === 'staff' && <div className="note small">Quote of {money(Q.amount)} sent. Please wait for approval before starting.</div>}
        {Q.stage === 'approved' && <div className="note small"><b>Approved: go ahead</b>, up to {money(Q.amount)} for {Q.quote.detail.work}.</div>}
        {Q.stage === 'declined' && <div className="error small">Your quote of {money(Q.amount)} wasn't approved. The agency will be in touch.</div>}
        {(Q.stage === 'none' || Q.stage === 'declined') && <details className="more" open={Q.stage === 'none'}><summary>Send your quote</summary>
          <ActionForm className="stack" action={contractorQuote.bind(null, j.id)}>
            <span className="muted small">After your visit: what's needed and the total price. Don't start until it's approved, unless it's a small job you've already fixed (then send the invoice below).</span>
            <div className="field"><label htmlFor={'qw' + j.id}>Work needed</label><input id={'qw' + j.id} name="work" placeholder="e.g. Replace consumer unit" /></div>
            <div className="field"><label htmlFor={'qa' + j.id}>Total price (£, including any VAT)</label><input id={'qa' + j.id} name="amount" inputMode="decimal" placeholder="0.00" /></div>
            <button className="btn">Send quote</button></ActionForm></details>}
        </>); })()}
        <details className="more"><summary>Job finished? Send your invoice</summary>
          <ActionForm className="stack" action={contractorDone.bind(null, j.id)}>
            <div className="field"><label htmlFor={'wd' + j.id}>What you did</label><input id={'wd' + j.id} name="work_done" placeholder="e.g. Replaced socket, tested circuit" /></div>
            <CostFields vatRegistered={!!(me2 && me2.vat_registered)} />
            <div className="field"><label htmlFor={'rf' + j.id}>Your invoice number</label><input id={'rf' + j.id} name="reference" /></div>
            <button className="btn">Mark done and send invoice</button>
          </ActionForm></details>
      </div>); })}
    {past.length > 0 && <div className="card"><h3>Finished jobs</h3>
      {past.map((j) => { const inv = (invs || []).filter((i) => i.repair_id === j.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; return (
        <div key={j.id} className="row small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}><span>{j.category}: {j.description.slice(0, 50)}</span><span>{inv ? money(inv.total_pence) + ' · ' + (invLabel[inv.status] || inv.status) : ''}</span></div>); })}
    </div>}
  </>);
}
