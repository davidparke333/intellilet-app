import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { loadArrears } from '@/lib/arrearsData';
import { monthName } from '@/lib/money';
import { fmt, money, todayISO } from '@/lib/rules';

// Everything a Tribunal may ask for on a rent arrears case, in one printable pack
const H = ({ children }) => <h2 style={{ fontSize: 16, margin: '8px 0 0', borderBottom: '2px solid #333', paddingBottom: 4 }}>{children}</h2>;
export default async function Evidence({ params }) {
  const { id } = await params;
  const { sb, member } = await currentMember();
  const X = await loadArrears(sb, id);
  if (!X) notFound();
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'The agency';
  // full rent statement: charges and payments in date order with a running balance
  let bal = 0;
  const lines = [...X.charges.filter((c) => c.due_on <= todayISO()).map((c) => ({ d: c.due_on, what: 'Rent due for ' + monthName(c.period_month), v: Number(c.amount_pence), k: 0 })),
    ...X.entries.filter((e) => e.category === 'rent received' || /^Reversal of rent/.test(e.memo || '')).map((e) => ({ d: e.entry_date, what: (e.category === 'reversal' ? 'Correction: ' : 'Payment received: ') + (e.memo || '') + ' (ref ' + e.reference + ')', v: -Number(e.amount_pence), k: 1 }))]
    .sort((a, b) => a.d.localeCompare(b.d) || a.k - b.k).map((l) => ({ ...l, bal: (bal += l.v) }));
  return (<>
    <div className="row noprint"><Link href={'/money/rent/' + id} className="btn ghost small">‹ Back</Link><PrintButton label="Print evidence pack" /></div>
    <div className="sheet">
      <div className="row" style={{ alignItems: 'flex-start' }}><div className="stack" style={{ gap: 2 }}><h1>Rent arrears record</h1><span>{agency}</span></div><dl><dt>Produced</dt><dd><b>{fmt(todayISO())}</b></dd></dl></div>
      <div className="grid2">
        <div className="box small"><b>Tenancy</b><br />{X.address.join(', ')}<br />Tenant{X.tenants.length > 1 ? 's' : ''}: {X.tenants.map((x) => x.full_name).join(', ')}<br />Start: {fmt(X.t.start_date)} · Rent {money(X.t.rent_pence)} a month, due day {X.t.rent_due_day}</div>
        <div className="box small"><b>Landlord</b><br />{X.L ? X.L.contacts.full_name : ''}{X.L && X.L.registration_number ? ' · registration ' + X.L.registration_number : ''}<br /><b>Arrears today: {money(X.A.arrears)}</b><br />{X.since ? 'In arrears continuously since ' + fmt(X.since.since) + ' (' + X.since.months + ' month' + (X.since.months === 1 ? '' : 's') + ')' : 'Not currently in arrears'}</div>
      </div>

      <H>1. Pre-action requirements</H>
      {X.checklist.map((c) => <div key={c.label} className="row small"><span>{c.label}</span><b style={{ color: c.done ? '#1a5f45' : '#a12' }}>{c.done ? 'Done' : 'Not recorded'}</b></div>)}

      <H>2. Arrears breakdown</H>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ textAlign: 'left' }}><th>Rent due</th><th style={{ textAlign: 'right' }}>Due</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Unpaid</th><th style={{ textAlign: 'right' }}>Running</th></tr></thead>
        <tbody>{X.breakdown.map((b) => <tr key={b.id} style={{ borderTop: '1px solid #eee' }}><td>{fmt(b.due_on)}</td><td style={{ textAlign: 'right' }}>{money(b.amount_pence)}</td><td style={{ textAlign: 'right' }}>{money(b.paid)}</td><td style={{ textAlign: 'right' }}>{money(b.owed)}</td><td style={{ textAlign: 'right' }}>{money(b.running)}</td></tr>)}
          {!X.breakdown.length && <tr><td colSpan={5}>Nothing unpaid.</td></tr>}</tbody></table>

      <H>3. Full rent statement</H>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ textAlign: 'left' }}><th>Date</th><th>Details</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance owed</th></tr></thead>
        <tbody>{lines.map((l, n) => <tr key={n} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}><td style={{ whiteSpace: 'nowrap' }}>{fmt(l.d)}</td><td>{l.what}</td><td style={{ textAlign: 'right' }}>{l.v > 0 ? money(l.v) : '−' + money(-l.v)}</td><td style={{ textAlign: 'right' }}>{money(l.bal)}</td></tr>)}</tbody></table>

      <H>4. Payment plans</H>
      {!X.plans.length && <span className="small">No payment plan recorded.</span>}
      {X.plans.map((p) => <div key={p.id} className="small" style={{ borderTop: '1px solid #eee', paddingTop: 4 }}><b>{fmt(String(p.created_at).slice(0, 10))}: {p.status}</b> ({p.proposed_by === 'tenant' ? 'proposed by the tenant' : 'proposed by us'}) · {money(p.instalment_pence)} {p.frequency} from {fmt(p.first_due)} towards {money(p.arrears_pence)}{p.with_rent ? ', on top of rent' : ''}
        {p.rejection_reason && <><br />Reason not accepted: {p.rejection_reason}</>}<br />Copy sent: {p.sent_on ? fmt(p.sent_on) : 'no'} · Tenant confirmed: {p.tenant_confirmed_on ? fmt(p.tenant_confirmed_on) + ' (' + p.confirmed_how + ')' : 'no'}{p.notes ? ' · ' + p.notes : ''}
        {X.active && X.active.id === p.id && X.progress && <><br />Progress: {X.progress.onTrack ? 'on track' : 'behind by ' + money(X.progress.behind)} ({money(X.progress.paid)} paid of {money(X.progress.expected)} expected so far)</>}</div>)}

      <H>5. Reminders and letters sent (exact wording)</H>
      {!X.sent.length && <span className="small">None recorded.</span>}
      {X.sent.map((s, n) => <div key={n} className="small" style={{ borderTop: '1px solid #eee', paddingTop: 4 }}><b>{fmt(s.sent_at.slice(0, 10))} · {s.stage} · by {s.channel === 'sms' ? 'text message' : 'email'}</b><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0' }}>{s.body}</pre></div>)}

      <H>6. Record of contact</H>
      {!X.log.length && <span className="small">None recorded.</span>}
      {X.log.map((l) => <div key={l.id} className="small" style={{ borderTop: '1px solid #eee', paddingTop: 4 }}><b>{fmt(l.happened_on)} · {l.kind}</b>{l.document_id ? ' · attachment on file' : ''}<br />{l.summary}<span style={{ color: '#666' }}> (recorded {new Date(l.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })})</span></div>)}

      <span className="small" style={{ color: '#555', marginTop: 8 }}>Produced from {agency}'s records on {fmt(todayISO())}. Rent and payment records cannot be edited (corrections are added as separate entries), and the record of contact cannot be changed after it is saved.</span>
    </div></>);
}
