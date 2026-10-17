import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { money, fmt, todayISO } from '@/lib/rules';
import { monthOf, addMonth, monthName } from '@/lib/money';

const LABEL = { 'rent received': 'Rent received', 'management fee': 'Management fee', 'contractor payment': 'Repair paid', 'landlord payout': 'Paid to you', reversal: 'Correction', adjustment: 'Money from you' };

// A landlord's monthly statement from the client account ledger: opening balance, every movement, closing balance.
export default async function Statement({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  const { data: l } = await sb.from('landlords').select('id, contacts(full_name, postal_address), property_owners(properties(address_line1))').eq('id', id).maybeSingle();
  if (!l) notFound();
  const m = /^\d{4}-\d{2}$/.test(sp.m || '') ? sp.m + '-01' : monthOf(todayISO()), next = addMonth(m, 1);
  const { data: E } = await sb.from('ledger_entries').select('id, entry_date, amount_pence, category, memo, reference, properties(address_line1)').eq('landlord_id', id).eq('account', 'client').lt('entry_date', next).order('entry_date').order('id');
  const before = (E || []).filter((e) => e.entry_date < m), during = (E || []).filter((e) => e.entry_date >= m);
  const opening = before.reduce((s, e) => s + Number(e.amount_pence), 0);
  let run = opening;
  const lines = during.map((e) => ({ ...e, bal: (run += Number(e.amount_pence)) }));
  const sum = (f) => during.filter(f).reduce((s, e) => s + Number(e.amount_pence), 0);
  const ag = member.agencies || {};
  return (
    <>
      <div className="row noprint"><Link href="/money?t=landlords" className="btn ghost small">‹ Landlords</Link><PrintButton label="Print statement" /></div>
      <div className="row noprint" style={{ justifyContent: 'center' }}>
        <Link className="btn ghost small" href={`/money/statement/${id}?m=${addMonth(m, -1).slice(0, 7)}`}>‹ {monthName(addMonth(m, -1))}</Link>
        {next <= monthOf(todayISO()) && <Link className="btn ghost small" href={`/money/statement/${id}?m=${next.slice(0, 7)}`}>{monthName(next)} ›</Link>}
      </div>
      <div className="sheet">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 2 }}><h1>Landlord statement</h1><span>{ag.trading_name || ag.name}</span></div>
          <dl><dt>Period</dt><dd><b>{monthName(m)}</b></dd><dt>Prepared</dt><dd>{fmt(todayISO())}</dd></dl>
        </div>
        <div className="box"><b>{l.contacts ? l.contacts.full_name : 'Landlord'}</b><br /><span className="small">{(l.property_owners || []).map((o) => o.properties && o.properties.address_line1).filter(Boolean).join(', ')}</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}><th style={{ padding: '6px 4px' }}>Date</th><th>Details</th><th style={{ textAlign: 'right' }}>In</th><th style={{ textAlign: 'right' }}>Out</th><th style={{ textAlign: 'right', paddingRight: 4 }}>Balance</th></tr></thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #ddd' }}><td style={{ padding: '6px 4px' }}>{fmt(m)}</td><td><i>Brought forward</i></td><td></td><td></td><td style={{ textAlign: 'right', paddingRight: 4 }}>{money(opening)}</td></tr>
            {lines.map((e) => (<tr key={e.id} style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
              <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{fmt(e.entry_date)}</td>
              <td>{LABEL[e.category] || e.category}{e.properties ? ' · ' + e.properties.address_line1 : ''}<br /><span style={{ color: '#666', fontSize: 12 }}>{e.memo}</span></td>
              <td style={{ textAlign: 'right' }}>{e.amount_pence > 0 ? money(e.amount_pence) : ''}</td>
              <td style={{ textAlign: 'right' }}>{e.amount_pence < 0 ? money(-e.amount_pence) : ''}</td>
              <td style={{ textAlign: 'right', paddingRight: 4 }}>{money(e.bal)}</td></tr>))}
            {!lines.length && <tr><td colSpan={5} style={{ padding: 8, color: '#666' }}>No money in or out this month.</td></tr>}
          </tbody>
        </table>
        <div className="grid2">
          <div className="box small">
            <div className="row"><span>Rent received</span><span>{money(sum((e) => e.category === 'rent received' || /^Reversal of rent/.test(e.memo || '')))}</span></div>
            <div className="row"><span>Management fees</span><span>{money(sum((e) => e.category === 'management fee' || /^Reversal of management fee/.test(e.memo || '')))}</span></div>
            <div className="row"><span>Repairs</span><span>{money(sum((e) => e.category === 'contractor payment'))}</span></div>
            <div className="row"><span>Paid to you</span><span>{money(sum((e) => e.category === 'landlord payout'))}</span></div>
          </div>
          <div className="box"><b>Balance held for you</b><br /><span style={{ fontSize: 22, fontWeight: 700 }}>{money(run)}</span><br /><span className="small">at the end of {monthName(m)}, in our client account.</span></div>
        </div>
      </div>
    </>
  );
}
