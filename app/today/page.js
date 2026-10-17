import Link from 'next/link';
import TopBar from '../topbar';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { quoteState, CERTS, certStatus, depositStatus, prescribedInfo, inspectionDue, dampStages, pastTarget, statusLabel, daysUntil, money, fmt, todayISO, INSPECT_MONTHS, PRIORITY, daysOpen } from '@/lib/rules';
import { ensureCharges, rentAccount } from '@/lib/money';
import { redirect } from 'next/navigation';

// Today: everything that needs a person, most urgent first. Each item links to where it gets done.
export default async function Today() {
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/portal');
  const [{ data: props }, { data: reps }, { data: tens }, { data: certs }, { data: insps }, { data: cons }, { data: bals }, { data: setting }] = await Promise.all([
    sb.from('properties').select('id, address_line1, onboarding_status').is('archived_at', null),
    sb.from('repairs').select('*, properties(address_line1, property_owners(landlords(approval_limit_pence)))').not('status', 'in', '(cancelled)').order('reported_at'),
    sb.from('tenancies').select('*, properties(address_line1)').in('status', ['active', 'pending']),
    sb.from('current_certificates').select('*'),
    sb.from('inspections').select('property_id, inspected_on').order('inspected_on', { ascending: false }),
    sb.from('contractors').select('id, insurance_expires, status, contacts(full_name)').eq('status', 'approved'),
    sb.from('landlord_balances').select('landlord_id, balance_pence'),
    sb.from('agency_settings').select('inspection_months').maybeSingle()
  ]);
  const T = tens || [];
  await ensureCharges(sb, member.agency_id, T.filter((t) => t.start_date <= todayISO()));
  const [{ data: charges }, { data: led }] = await Promise.all([sb.from('rent_charges').select('*'), sb.from('ledger_entries').select('tenancy_id, rent_charge_id, category, memo, amount_pence, account')]);

  const { data: qev } = await sb.from('repair_events').select('repair_id, kind, detail, at').in('repair_id', (reps || []).filter((r) => r.status === 'assigned').map((r) => r.id).concat('00000000-0000-0000-0000-000000000000')).in('kind', ['quote', 'quote_decision']).order('at');
  const items = []; // level: 0 = now (legal or overdue), 1 = this week, 2 = coming up
  const add = (level, area, text, sub, href) => items.push({ level, area, text, sub, href });

  for (const r of reps || []) {
    const a = r.properties ? r.properties.address_line1 : '', href = '/repairs/' + r.id;
    if (r.is_damp) { const D = dampStages(r); if (D && D.next && r.status !== 'paid') { add(D.overdue ? 0 : D.next.st.cls === 'due' ? 0 : 1, 'Damp and mould', (D.overdue ? 'OVERDUE: ' : '') + D.next.label + ', ' + a, D.next.st.text + ' · legal deadline', href); continue; } }
    if (r.status === 'reported') add(r.priority === 'emergency' || pastTarget(r) ? 0 : 1, 'Repairs', 'Book a contractor: ' + r.category + ', ' + a, PRIORITY[r.priority].label + (pastTarget(r) ? ' · past target' : ''), href);
    else if (r.status === 'assigned' && (() => { const own = r.properties && r.properties.property_owners && r.properties.property_owners[0];
      const Q = quoteState((qev || []).filter((e) => e.repair_id === r.id), (own && own.landlords && own.landlords.approval_limit_pence) || 25000);
      if (Q.stage === 'staff') { add(1, 'Repairs', 'Approve the quote: ' + money(Q.amount) + ', ' + a, Q.quote.detail.work || r.category, href); return true; }
      if (Q.stage === 'landlord') { add(daysOpen(Q.quote.at) >= 2 ? 1 : 2, 'Repairs', 'Waiting for the landlord: ' + money(Q.amount) + ' quote, ' + a, 'Above their limit. Chase them if no answer', href); return true; }
      if (Q.stage === 'declined') { add(1, 'Repairs', 'Quote declined: ' + r.category + ', ' + a, 'Get another price or release the contractor', href); return true; }
      return false; })()) {}
    else if (r.status === 'assigned' && pastTarget(r)) add(1, 'Repairs', 'Chase the contractor: ' + r.category + ', ' + a, 'Past the ' + PRIORITY[r.priority].days + '-day target', href);
    else if (r.status === 'invoiced') add(1, 'Repairs', (r.verified_at ? 'Approve the invoice: ' : 'Check it\'s fixed: ') + r.category + ', ' + a, statusLabel(r)[1], href);
    else if (r.status === 'approved') add(1, 'Repairs', 'Pay the contractor: ' + r.category + ', ' + a, 'Invoice approved', href);
  }
  for (const t of T) {
    const A = rentAccount((charges || []).filter((c) => c.tenancy_id === t.id), (led || []).filter((e) => e.tenancy_id === t.id));
    if (A.arrears > 0) add(A.daysLate >= 7 ? 0 : 1, 'Rent', 'Chase ' + money(A.arrears) + ' rent: ' + t.properties.address_line1, A.daysLate + ' days late', '/money/rent/' + t.id);
    const ds = depositStatus(t); if (ds && !ds.lodged) add(ds.cls === 'bad' ? 0 : 1, 'Deposits', 'Lodge the deposit: ' + t.properties.address_line1, ds.text, '/properties/' + t.property_id + '/deposit');
    const pi = prescribedInfo(t); if (pi && !pi.given) add(pi.cls === 'bad' ? 0 : 1, 'Deposits', 'Give the prescribed information: ' + t.properties.address_line1, pi.text, '/properties/' + t.property_id + '/deposit');
  }
  const months = (setting && setting.inspection_months) || INSPECT_MONTHS;
  for (const p of (props || []).filter((x) => x.onboarding_status === 'live')) {
    for (const c of CERTS) { const st = certStatus(c, (certs || []).find((x) => x.property_id === p.id && x.kind === c.key));
      if (st.cls === 'bad') add(c.basis === 'law' ? 0 : 1, 'Certificates', c.label + ': ' + p.address_line1, st.text, `/properties/${p.id}/certificate/${c.key}`);
      else if (st.cls === 'due') add(2, 'Certificates', c.label + ': ' + p.address_line1, st.text, `/properties/${p.id}/certificate/${c.key}`); }
    const last = (insps || []).find((i) => i.property_id === p.id), iv = inspectionDue(last && last.inspected_on, months);
    if (iv.cls !== 'ok') add(iv.cls === 'bad' ? 1 : 2, 'Inspections', 'Inspect ' + p.address_line1, iv.text, '/checks/inspect/' + p.id);
  }
  for (const c of cons || []) { const d = daysUntil(c.insurance_expires); if (c.insurance_expires && d <= 30) add(d < 0 ? 1 : 2, 'Trades', 'Insurance ' + (d < 0 ? 'expired' : 'ends soon') + ': ' + c.contacts.full_name, (d < 0 ? 'Expired ' : 'Ends ') + fmt(c.insurance_expires) + '. Not offered on repairs once expired', '/contractors'); }
  for (const b of bals || []) if (Number(b.balance_pence) < 0) add(0, 'Money', 'Landlord balance below zero', money(b.balance_pence) + '. Client money must never go negative', '/money?t=landlords');

  const groups = [[0, 'Do now', 'Legal deadlines and overdue'], [1, 'This week', 'Keep things moving'], [2, 'Coming up', 'Plan ahead']];
  const now = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
  return (
    <>
      <TopBar here="/today" />
      <div className="pagehead"><h1>Today</h1><span className="sub">{now} · {items.filter((i) => i.level === 0).length} to do now, {items.filter((i) => i.level === 1).length} this week</span></div>
      {!items.length && <div className="card"><b>Nothing needs doing.</b><span className="muted">Everything is up to date.</span></div>}
      {groups.map(([lv, title, sub]) => { const list = items.filter((i) => i.level === lv); if (!list.length) return null;
        return (<div key={lv} className="stack" style={{ gap: 8 }}>
          <div className="row"><h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2><span className="muted small">{sub}</span></div>
          {list.map((i, n) => (
            <Link key={n} href={i.href} className="card" style={{ textDecoration: 'none', color: 'inherit', gap: 2, borderLeft: '4px solid ' + (lv === 0 ? 'var(--bad-ink)' : lv === 1 ? 'var(--accent)' : 'var(--line)') }}>
              <span className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{i.area}</span>
              <b>{i.text}</b><span className="small">{i.sub}</span>
            </Link>))}
        </div>); })}
    </>
  );
}
