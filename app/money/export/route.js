import { currentMember, isStaff } from '@/lib/supabase/server';
import { monthOf, addMonth } from '@/lib/money';
import { todayISO } from '@/lib/rules';

// Monthly download of every money movement (office and client) as a CSV spreadsheet.
// Columns follow the simple "Date, Amount, Payee, Description, Reference" layout accounting packages import.
const TYPE = { 'rent received': 'Rent received', 'management fee': 'Management fee', 'contractor payment': 'Contractor payment', 'landlord payout': 'Paid to landlord', reversal: 'Correction', adjustment: 'Money from landlord' };
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const uk = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

export async function GET(req) {
  const { sb, member } = await currentMember();
  if (!isStaff(member)) return new Response('Not allowed', { status: 403 });
  const q = new URL(req.url).searchParams.get('m') || '';
  const m = /^\d{4}-\d{2}$/.test(q) ? q + '-01' : monthOf(todayISO()), next = addMonth(m, 1);
  const only = new URL(req.url).searchParams.get('account'); // office | client | (both)
  let query = sb.from('ledger_entries').select('entry_date, account, amount_pence, category, reference, memo, landlords(contacts(full_name)), properties(address_line1), contractors(contacts(full_name))')
    .gte('entry_date', m).lt('entry_date', next).order('entry_date').order('id');
  if (only === 'office' || only === 'client') query = query.eq('account', only);
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });
  const head = ['Date', 'Amount', 'Payee', 'Description', 'Reference', 'Account', 'Type', 'Landlord', 'Property'];
  const rows = (data || []).map((e) => {
    const landlord = e.landlords && e.landlords.contacts ? e.landlords.contacts.full_name : '';
    const payee = e.category === 'contractor payment' && e.contractors && e.contractors.contacts ? e.contractors.contacts.full_name : e.account === 'office' ? 'Management fees' : landlord;
    return [uk(e.entry_date), (Number(e.amount_pence) / 100).toFixed(2), payee, e.memo || TYPE[e.category] || e.category, e.reference, e.account === 'office' ? 'Office' : 'Client', TYPE[e.category] || e.category, landlord, e.properties ? e.properties.address_line1 : ''];
  });
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  const name = 'IntelliLet-' + (only || 'all') + '-' + m.slice(0, 7) + '.csv';
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"' } });
}
