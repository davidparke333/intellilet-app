import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import FileField from '@/components/FileField';
import { PRIORITY, STATUS_LABEL, TRADE_FOR, GO_AHEAD_REASONS, daysOpen, pastTarget, repairNext, money, fmt, daysUntil } from '@/lib/rules';
import { callContractor, quoteDecision, workDone, approveInvoice, queryInvoice, markPaid, verifyFixed, addNote } from '../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const three = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const when = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const Next = ({ text, sub }) => <div className="nextbox"><span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)' }}>Next step</span><b>{text}</b>{sub && <span className="muted small">{sub}</span>}</div>;

export default async function Repair({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const { data: r } = await sb.from('repairs').select('*, properties(id, address_line1, postcode, keys_location, property_owners(landlords(approval_limit_pence, contacts(full_name, phone, email)))), tenancies(tenancy_people(is_lead, contacts(full_name, phone))), contractors(id, contacts(full_name, phone, email))').eq('id', id).maybeSingle();
  if (!r) notFound();
  const [{ data: events }, { data: docs }, { data: invoices }] = await Promise.all([
    sb.from('repair_events').select('*').eq('repair_id', id).order('at'),
    sb.from('documents').select('id, storage_path, file_name, label').eq('about_table', 'repairs').eq('about_id', id),
    sb.from('invoices').select('*').eq('repair_id', id).order('created_at', { ascending: false })
  ]);
  const photos = await Promise.all((docs || []).map(async (d) => ({ ...d, url: (await sb.storage.from('documents').createSignedUrl(d.storage_path, 3600)).data?.signedUrl })));
  const owner = r.properties.property_owners && r.properties.property_owners[0], landlord = owner && owner.landlords;
  const lc = (landlord && landlord.contacts) || {};
  const limit = (landlord && landlord.approval_limit_pence) || 25000;
  const ev = events || [];
  const quotes = ev.filter((e) => e.kind === 'quote_sent'), decisions = ev.filter((e) => e.kind === 'quote_decision');
  const cleared = Math.max(0, ...decisions.filter((e) => ['approved', 'proceeded'].includes(e.detail.status)).map((e) => Number(e.detail.amount) || 0));
  const waitingQuote = quotes.length > decisions.length ? quotes[quotes.length - 1] : null;
  const st = STATUS_LABEL[r.status] || STATUS_LABEL.reported, pr = PRIORITY[r.priority];
  const lead = r.tenancies && (r.tenancies.tenancy_people || []).find((x) => x.is_lead);
  const inv = (invoices || [])[0];
  const next = repairNext(r);
  // contractors who do this kind of work and have in-date insurance
  let contractors = [];
  if (staff && r.status === 'reported' && !waitingQuote) {
    const { data: cs } = await sb.from('contractors').select('id, trades, availability, insurance_expires, hourly_rate_pence, contacts(full_name, phone)').eq('status', 'approved');
    const want = TRADE_FOR[r.category] || [];
    contractors = (cs || []).filter((c) => !c.insurance_expires || daysUntil(c.insurance_expires) >= 0)
      .sort((a, b) => (want.some((t) => b.trades.includes(t)) - want.some((t) => a.trades.includes(t))) || (r.priority === 'emergency' ? (b.availability === '24h') - (a.availability === '24h') : 0));
  }
  const calls = (cid) => ev.filter((e) => e.kind === 'call' && e.detail.contractor_id === cid).map((e) => e.detail.text.split(': ').pop()).join(', ');

  return (
    <>
      <Link href="/repairs" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Repairs</Link>
      <div className="row"><div className="pagehead"><h1>{r.category}</h1><span className="sub"><Link href={'/properties/' + r.properties.id}>{r.properties.address_line1}, {r.properties.postcode}</Link></span></div><span className={'pill ' + st[0]}>{st[1]}</span></div>
      {sp.saved && <div className="note" role="status">{sp.saved}</div>}
      {sp.error && <div className="error" role="alert">{sp.error}</div>}

      <div className="card">
        <div className="problem"><span className="muted small">Problem reported{r.source ? ' · ' + r.source.toLowerCase() : ''} · {when(r.reported_at)}</span><span>{r.description}</span></div>
        <span className="small"><span className={'pill ' + (pastTarget(r) ? 'bad' : r.priority === 'routine' ? 'info' : 'due')}>{pr.label} · {pr.days}-day target{pastTarget(r) ? ' · past target' : ''}</span>{r.is_damp ? ' · Damp & mould log' : ''} · {daysOpen(r.reported_at)} days open</span>
        <span className="small">{r.access_with_key ? 'OK to use our key if the tenant is out' : 'Tenant must be in'}{r.best_times ? ' · best times: ' + r.best_times : ''}{r.properties.keys_location ? ' · keys: ' + r.properties.keys_location : ''}</span>
        {lead && <span className="small">Tenant: {lead.contacts.full_name}{lead.contacts.phone ? ' · ' + lead.contacts.phone : ''}</span>}
        {r.contractors && <span className="small">Contractor: {r.contractors.contacts.full_name}{r.contractors.contacts.phone ? ' · ' + r.contractors.contacts.phone : ''}{r.spend_limit_pence ? ' · spend limit ' + money(r.spend_limit_pence) : ''}</span>}
        {photos.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{photos.map((ph) => ph.url && <a key={ph.id} href={ph.url} target="_blank" rel="noopener" title={ph.label}>{/\.(pdf)$/i.test(ph.storage_path) ? ph.file_name : <img src={ph.url} alt={ph.label} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8 }} />}</a>)}</div>}
      </div>

      {staff && r.status === 'reported' && (
        <div className="card">
          {waitingQuote ? (<>
            <Next text="Waiting for the landlord to approve the quote" sub={`${money(waitingQuote.detail.amount)} · landlord ${lc.full_name || ''} ${lc.phone || ''}`} />
            <ActionForm className="stack" action={quoteDecision.bind(null, id)}>
              <input type="hidden" name="amount" value={(waitingQuote.detail.amount / 100).toFixed(2)} />
              <div className="field"><label htmlFor="qn">Landlord's answer or note</label><input id="qn" name="note" placeholder="e.g. approved by phone" /></div>
              <div style={two}><button className="btn" name="status" value="approved">Landlord approved</button><button className="btn ghost" name="status" value="declined">Landlord declined</button></div>
            </ActionForm>
            {(r.priority !== 'routine' || daysOpen(quotes[quotes.length - 1].at) >= 3) && (
              <ActionForm className="stack" action={quoteDecision.bind(null, id)}>
                <input type="hidden" name="amount" value={(waitingQuote.detail.amount / 100).toFixed(2)} /><input type="hidden" name="status" value="proceeded" />
                <div className="field"><label htmlFor="ga">Go ahead without a reply because</label><select id="ga" name="note">{GO_AHEAD_REASONS.map((x) => <option key={x}>{x}</option>)}</select></div>
                <button className="btn ghost">Go ahead and tell the landlord</button>
              </ActionForm>)}
          </>) : (<>
            <Next text={next} sub={`Landlord limit ${money(Math.max(limit, cleared))}${cleared > limit ? ' (quote approved)' : ''}. Book only after the contractor agrees.`} />
            {!contractors.length && <span className="muted">No approved contractors with in-date insurance yet. <Link href="/contractors">Add one in Trades</Link>.</span>}
            {contractors.map((c) => (
              <ActionForm key={c.id} className="stack" action={callContractor.bind(null, id)}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <div className="row"><span><b>{c.contacts.full_name}</b><br /><span className="muted small">{c.trades.join(', ')} · {c.availability === '24h' ? '24 hours' : 'office hours'}{c.contacts.phone ? ' · ' : ''}{c.contacts.phone && <a href={'tel:' + c.contacts.phone}>{c.contacts.phone}</a>}{calls(c.id) ? ' · ' + calls(c.id) : ''}</span></span></div>
                <div className="field"><label htmlFor={'sl' + c.id}>Spend limit for this job (£)</label><input id={'sl' + c.id} name="spend_limit" inputMode="decimal" defaultValue={(Math.max(limit, cleared) / 100).toFixed(0)} /></div>
                <div style={three}>
                  <button className="btn" name="outcome" value="agreed">They agreed: book</button>
                  <button className="btn ghost small" name="outcome" value="noanswer">No answer</button>
                  <button className="btn ghost small" name="outcome" value="declined">Can't do it</button>
                </div>
              </ActionForm>))}
          </>)}
        </div>
      )}

      {staff && r.status === 'assigned' && (
        <ActionForm className="card" action={workDone.bind(null, id)}>
          <Next text={next} sub="Use this when the contractor tells you it's finished, or you did it yourself." />
          <div className="field"><label htmlFor="wd">What was done</label><input id="wd" name="work_done" placeholder="e.g. Replaced diverter valve, hot water working" /></div>
          <div style={three}><div className="field"><label htmlFor="lb">Labour (£)</label><input id="lb" name="labour" inputMode="decimal" placeholder="0.00" /></div>
            <div className="field"><label htmlFor="pt">Parts (£)</label><input id="pt" name="parts" inputMode="decimal" placeholder="0.00" /></div>
            <div className="field"><label htmlFor="vt">VAT (£)</label><input id="vt" name="vat" inputMode="decimal" placeholder="0.00" /></div></div>
          <div className="field"><label htmlFor="rf">Their invoice number</label><input id="rf" name="reference" /></div>
          {[1, 2].map((n) => <FileField key={n} label={'Photo after the work ' + n + ' (optional)'} agencyId={member.agency_id} propertyId={r.properties.id} prefix={'after' + n} />)}
          <button className="btn">Confirm work done</button>
          <span className="muted small">All amounts 0 means no charge, and the repair closes straight away.</span>
        </ActionForm>
      )}

      {staff && r.status === 'invoiced' && inv && (
        <div className="card">
          <Next text={next} />
          <span className="small"><b>Work done:</b> {inv.work_done}</span>
          <div className="row small"><span>Labour</span><span>{money(inv.labour_pence)}</span></div>
          <div className="row small"><span>Parts</span><span>{money(inv.parts_pence)}</span></div>
          {inv.vat_pence > 0 && <div className="row small"><span>VAT</span><span>{money(inv.vat_pence)}</span></div>}
          <div className="row"><b>Total</b><b>{money(inv.total_pence)}</b></div>
          {r.spend_limit_pence && inv.total_pence > r.spend_limit_pence && <div className="error">{money(inv.total_pence - r.spend_limit_pence)} over the {money(r.spend_limit_pence)} spend limit for this job</div>}
          {inv.total_pence > Math.max(limit, cleared) && r.priority !== 'emergency' && <div className="note">Above the landlord's {money(Math.max(limit, cleared))} limit. Tell them before you approve.</div>}
          <form action={approveInvoice.bind(null, id)}><button className="btn" style={{ width: '100%' }}>Approve {money(inv.total_pence)}</button></form>
          <details className="more"><summary>Something wrong with the invoice?</summary>
            <ActionForm className="stack" action={queryInvoice.bind(null, id)}>
              <div className="field"><label htmlFor="qr">What needs checking</label><input id="qr" name="reason" /></div>
              <button className="btn ghost small">Send back to contractor</button>
            </ActionForm></details>
        </div>
      )}

      {staff && r.status === 'approved' && inv && (
        <div className="card"><Next text={`Pay ${r.contractors ? r.contractors.contacts.full_name : 'the contractor'} ${money(inv.total_pence)}`} sub={'Approved ' + when(inv.approved_at) + '. Paying records it in the client account ledger against the landlord.'} />
          <form action={markPaid.bind(null, id)}><button className="btn" style={{ width: '100%' }}>Mark contractor paid</button></form></div>
      )}

      {staff && r.status === 'paid' && !r.verified_at && r.tenant_confirmed !== 'fixed' && (
        <div className="card"><Next text={next} sub="Check with the tenant, or check it yourself, so the record shows the problem was really fixed." />
          <form action={verifyFixed.bind(null, id)}><button className="btn ghost" style={{ width: '100%' }}>Confirm it is fixed (checked)</button></form></div>
      )}
      {r.verified_at && <div className="note">Fix confirmed {when(r.verified_at)}</div>}

      <div className="card"><h3>History</h3>
        {ev.map((e) => <div key={e.id} className="stack" style={{ gap: 0 }}><span className="muted small">{when(e.at)}</span><span className="small">{e.detail.text || e.kind}</span></div>)}
        {staff && <ActionForm className="row" action={addNote.bind(null, id)}><input name="note" aria-label="Add a note" placeholder="Add a note, e.g. called tenant" /><button className="btn ghost small">Add</button></ActionForm>}
      </div>
    </>
  );
}
