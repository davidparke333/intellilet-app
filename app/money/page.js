import Link from 'next/link';
import TopBar from '../topbar';
import ActionForm from '@/components/ActionForm';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { money, fmt, todayISO } from '@/lib/rules';
import { ensureCharges, rentAccount, monthOf, monthName } from '@/lib/money';
import { payLandlord, landlordFundsIn } from './actions';

export default async function Money({ searchParams }) {
  const sp = await searchParams;
  const tab = ['landlords', 'client', 'office'].includes(sp.t) ? sp.t : 'rent';
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const { data: tens } = await sb.from('tenancies').select('*, properties(id, address_line1, postcode), tenancy_people(is_lead, contacts(full_name))').in('status', ['active', 'pending', 'ended']);
  const T = tens || [];
  if (staff) await ensureCharges(sb, member.agency_id, T.filter((t) => t.status !== 'pending' || t.start_date <= todayISO()));
  const [{ data: charges }, { data: led }, { data: bals }, { data: lls }] = await Promise.all([
    sb.from('rent_charges').select('*'),
    sb.from('ledger_entries').select('id, entry_date, account, amount_pence, category, memo, tenancy_id, landlord_id, rent_charge_id'),
    sb.from('landlord_balances').select('*'),
    sb.from('landlords').select('id, monthly_fee_pence, contacts(full_name, email), property_owners(properties(address_line1))').is('archived_at', null)
  ]);
  const E = led || [], C = charges || [];
  const thisMonth = monthOf(todayISO());
  const rows = T.map((t) => ({ t, A: rentAccount(C.filter((c) => c.tenancy_id === t.id), E.filter((e) => e.tenancy_id === t.id)) }))
    .filter((x) => x.A.rows.length || x.t.status !== 'ended')
    .sort((a, b) => b.A.daysLate - a.A.daysLate || b.A.arrears - a.A.arrears);
  const dueThis = C.filter((c) => c.period_month === thisMonth).reduce((s, c) => s + c.amount_pence, 0);
  const inThis = E.filter((e) => e.account === 'client' && (e.category === 'rent received' || /^Reversal of rent/.test(e.memo || '')) && e.entry_date >= thisMonth).reduce((s, e) => s + Number(e.amount_pence), 0);
  const arrears = rows.reduce((s, x) => s + x.A.arrears, 0);
  const client = E.filter((e) => e.account === 'client').reduce((s, e) => s + Number(e.amount_pence), 0);
  const unassigned = E.filter((e) => e.account === 'client' && !e.landlord_id).reduce((s, e) => s + Number(e.amount_pence), 0);
  const office = E.filter((e) => e.account === 'office').reduce((s, e) => s + Number(e.amount_pence), 0);
  const officeLines = E.filter((e) => e.account === 'office').sort((a, b) => String(b.entry_date).localeCompare(a.entry_date) || b.id - a.id).slice(0, 50)
    .map((e) => ({ ...e, properties: (T.find((t) => t.id === e.tenancy_id) || {}).properties }));
  const feesThis = E.filter((e) => e.account === 'office' && e.entry_date >= thisMonth).reduce((s, e) => s + Number(e.amount_pence), 0);
  const bank = sp.bank ? Math.round(parseFloat(String(sp.bank).replace(/[£,\s]/g, '')) * 100) : null;
  const balOf = (id) => Number(((bals || []).find((b) => b.landlord_id === id) || {}).balance_pence || 0);
  const tenantOf = (t) => (t.tenancy_people || []).map((p) => p.contacts && p.contacts.full_name).filter(Boolean).join(' & ') || 'Tenant';

  return (
    <>
      <TopBar here="/money" />
      <div className="pagehead"><h1>Money</h1><span className="sub">{monthName(thisMonth)}: {money(inThis)} of {money(dueThis)} rent received{arrears ? ' · ' + money(arrears) + ' in arrears' : ''}</span></div>
      {sp.saved && <div className="note" role="status">{sp.saved}</div>}
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['rent', 'Rent'], ['landlords', 'Landlords'], ['client', 'Client account'], ['office', 'Office account']].map(([k, l]) => <Link key={k} href={k === 'rent' ? '/money' : '/money?t=' + k} className={'btn small ' + (tab === k ? '' : 'ghost')}>{l}</Link>)}
      </nav>

      {tab === 'rent' && (<>
        {!rows.length && <div className="card"><span className="muted">No tenancies yet. Add one on a property.</span></div>}
        {rows.map(({ t, A }) => { const cur = A.current; return (
          <Link key={t.id} href={'/money/rent/' + t.id} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row"><b>{t.properties.address_line1}</b><span className={'pill ' + (A.arrears ? (A.daysLate >= 7 ? 'bad' : 'due') : cur ? cur.st.cls : 'info')}>{A.arrears ? money(A.arrears) + ' owed · ' + A.daysLate + ' days' : cur ? cur.st.text : 'Starts ' + fmt(t.start_date)}</span></div>
            <span className="muted small">{tenantOf(t)} · {money(t.rent_pence)} a month, due day {t.rent_due_day}{A.credit ? ' · ' + money(A.credit) + ' in credit' : ''}{t.status === 'ended' ? ' · tenancy ended' : ''}</span>
          </Link>); })}
      </>)}

      {tab === 'landlords' && (<>
        <span className="muted small">Money held in the client account for each landlord: rent in, less fees and repairs paid. Pay it out to the bank details you hold outside this app, then record it here.</span>
        {(lls || []).map((l) => { const b = balOf(l.id); return (
          <div key={l.id} className="card">
            <div className="row"><b>{l.contacts ? l.contacts.full_name : 'Landlord'}</b><span className={'pill ' + (b > 0 ? 'due' : b < 0 ? 'bad' : 'ok')}>{b < 0 ? 'Overdrawn ' + money(-b) : money(b) + ' held'}</span></div>
            <span className="muted small">{(l.property_owners || []).map((o) => o.properties && o.properties.address_line1).filter(Boolean).join(', ') || 'No properties'} · fee {money(l.monthly_fee_pence)} a month</span>
            {b < 0 && <div className="error">This landlord's money is below zero: more has been paid out for them than was held. Client money must never go negative. Ask the landlord for funds, or check for a mistake.</div>}
            <Link href={'/money/statement/' + l.id} className="btn ghost small">Statement</Link>
            {staff && <details className="more" open={b < 0}><summary>Record money received from the landlord</summary>
              <ActionForm className="stack" action={landlordFundsIn.bind(null, l.id)}>
                <span className="muted small">For example when they send money to cover a repair. It's held for them in the client account.</span>
                <div className="grid2"><div className="field"><label htmlFor={'fa' + l.id}>Amount (£)</label><input id={'fa' + l.id} name="amount" inputMode="decimal" defaultValue={b < 0 ? (-b / 100).toFixed(2) : ''} /></div>
                  <div className="field"><label htmlFor={'fd' + l.id}>Date received</label><input id={'fd' + l.id} name="received_on" type="date" defaultValue={todayISO()} max={todayISO()} /></div></div>
                <div className="field"><label htmlFor={'fr' + l.id}>Bank reference</label><input id={'fr' + l.id} name="reference" /></div>
                <button className="btn ghost">Record money received</button></ActionForm></details>}
            {staff && b > 0 && <details className="more"><summary>Record a payout</summary>
              <ActionForm className="stack" action={payLandlord.bind(null, l.id)}>
                <div className="grid2"><div className="field"><label htmlFor={'pa' + l.id}>Amount (£)</label><input id={'pa' + l.id} name="amount" inputMode="decimal" defaultValue={(b / 100).toFixed(2)} /></div>
                  <div className="field"><label htmlFor={'pd' + l.id}>Date paid</label><input id={'pd' + l.id} name="paid_on" type="date" defaultValue={todayISO()} max={todayISO()} /></div></div>
                <div className="field"><label htmlFor={'pr' + l.id}>Payment reference</label><input id={'pr' + l.id} name="reference" placeholder="As shown on the bank payment" /></div>
                <button className="btn">Record payout</button></ActionForm></details>}
          </div>); })}
      </>)}

      {tab === 'client' && (<>
        <div className="card">
          <h3>Client account</h3>
          <div className="row"><span>Held for landlords</span><b>{money(client - unassigned)}</b></div>
          {unassigned !== 0 && <div className="row"><span>Not linked to a landlord</span><b>{money(unassigned)}</b></div>}
          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><b>Should be in the client bank account</b><b>{money(client)}</b></div>
          {client < 0 && <div className="error">The client account total is below zero. That would mean money has been paid out that no client had sent in. Check each landlord under Landlords, and record any money a landlord has sent.</div>}
          {unassigned !== 0 && <span className="error small">Some client money isn't linked to a landlord. Every penny in the client account must belong to someone: check those entries.</span>}
        </div>
        <form className="card" method="get">
          <input type="hidden" name="t" value="client" />
          <h3>Check against the bank</h3>
          <span className="muted small">Type the client account balance from your bank today. They should match exactly. Do this at least every month: it's what Client Money Protection schemes expect.</span>
          <div className="field"><label htmlFor="bk">Bank balance today (£)</label><input id="bk" name="bank" inputMode="decimal" defaultValue={sp.bank || ''} /></div>
          <button className="btn ghost">Check</button>
          {bank !== null && Number.isFinite(bank) && (bank === client
            ? <div className="note">Matches: {money(bank)}. The client account is reconciled for {fmt(todayISO())}.</div>
            : <div className="error">Difference of {money(Math.abs(bank - client))}: the bank has {bank > client ? 'more' : 'less'} than the records. Look for a payment not yet recorded{bank < client ? ', or one recorded that hasn\'t arrived' : ''}.</div>)}
        </form>
        <form className="card" method="get" action="/money/export">
          <h3>Download for your accounts</h3>
          <span className="muted small">A spreadsheet (CSV) of every money movement in a month. Opens in Excel or Numbers, and imports into Xero, QuickBooks, FreeAgent or Tide. Your income is the Office lines (fees). Client lines are landlords' money, not your income.</span>
          <div className="grid2">
            <div className="field"><label htmlFor="em">Month</label><input id="em" name="m" type="month" defaultValue={todayISO().slice(0, 7)} max={todayISO().slice(0, 7)} /></div>
            <div className="field"><label htmlFor="ea">Which</label><select id="ea" name="account"><option value="">Everything</option><option value="office">Office only (your fee income)</option><option value="client">Client account only</option></select></div>
          </div>
          <button className="btn ghost">Download</button>
        </form>

      </>)}
      {tab === 'office' && (<>
        <div className="card">
          <h3>Office account</h3>
          <span className="muted small">Your own money: management fees, which move here from client money once each month's rent is paid in full. Transfer them to your office bank account.</span>
          <div className="row"><span>Fees earned in {monthName(thisMonth)}</span><b>{money(feesThis)}</b></div>
          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><b>Total fees earned</b><b>{money(office)}</b></div>
          {officeLines.length > 0 && <><b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>Fee lines</b>
            {officeLines.map((e) => <div key={e.id} className="row small"><span>{fmt(e.entry_date)} · {e.memo}{e.properties ? ' · ' + e.properties.address_line1 : ''}</span><span>{money(e.amount_pence)}</span></div>)}
          </>}
        </div>
        <form className="card" method="get" action="/money/export">
          <input type="hidden" name="account" value="office" />
          <h3>Download fee income</h3>
          <span className="muted small">A spreadsheet of your fees for a month, ready for your accounts.</span>
          <div className="field"><label htmlFor="om">Month</label><input id="om" name="m" type="month" defaultValue={todayISO().slice(0, 7)} max={todayISO().slice(0, 7)} /></div>
          <button className="btn ghost">Download</button>
        </form>
      </>)}
    </>
  );
}
