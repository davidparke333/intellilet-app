'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { todayISO, fmt, money } from '@/lib/rules';
import { rentAccount, allocate, monthName, REMINDER_STAGES, PAY_METHODS } from '@/lib/money';

const txt = (fd, k) => String(fd.get(k) || '').trim();
const pence = (fd, k) => { const v = txt(fd, k).replace(/[£,\s]/g, ''); if (v === '') return null; const n = Math.round(parseFloat(v) * 100); return Number.isFinite(n) && n > 0 ? n : null; };
const fail = (fd, msg) => ({ error: String(msg).replace(/\.$/, ''), values: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) });
const isoOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
async function staffOnly() { const ctx = await currentMember(); if (!isStaff(ctx.member)) redirect('/'); return ctx; }
const back = (tid, msg) => { revalidatePath('/money'); revalidatePath(`/money/rent/${tid}`); redirect(`/money/rent/${tid}?saved=${encodeURIComponent(msg)}`); };

async function loadTenancy(sb, id) {
  const { data: t } = await sb.from('tenancies').select('*, properties(id, address_line1, property_owners(landlord_id, landlords(monthly_fee_pence)))').eq('id', id).single();
  const [{ data: charges }, { data: entries }] = await Promise.all([
    sb.from('rent_charges').select('*').eq('tenancy_id', id),
    sb.from('ledger_entries').select('*').eq('tenancy_id', id)
  ]);
  const owner = t.properties.property_owners && t.properties.property_owners[0];
  return { t, charges: charges || [], entries: entries || [], landlord_id: owner ? owner.landlord_id : null, fee: (owner && owner.landlords && owner.landlords.monthly_fee_pence) || 0 };
}
// The flat management fee moves from client money to office money once a month's rent is paid in full.
async function takeFees(sb, agency_id, ctx) {
  const { t, landlord_id, fee } = ctx;
  if (!fee || !landlord_id) return;
  const { data: entries } = await sb.from('ledger_entries').select('*').eq('tenancy_id', t.id);
  const A = rentAccount(ctx.charges, entries || []);
  for (const r of A.rows.filter((x) => x.owed <= 0 && !x.feeTaken)) {
    const ref = 'FEE-' + r.period_month.slice(0, 7) + '-' + t.id.slice(0, 6).toUpperCase(), memo = 'Management fee ' + monthName(r.period_month);
    const base = { agency_id, entry_date: todayISO(), category: 'management fee', reference: ref, property_id: t.property_id, tenancy_id: t.id, landlord_id, rent_charge_id: r.id, memo };
    const { error } = await sb.from('ledger_entries').insert([{ ...base, account: 'client', amount_pence: -fee }, { ...base, account: 'office', amount_pence: fee }]);
    if (error) throw new Error(error.message);
  }
}

export async function recordPayment(tid, _prev, fd) {
  const { sb, member } = await staffOnly();
  const amount = pence(fd, 'amount'), on = txt(fd, 'received_on'), method = txt(fd, 'method'), ref = txt(fd, 'reference');
  if (!amount) return fail(fd, 'Enter the amount received, like 750.00');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date it reached the bank (not in the future)');
  if (!PAY_METHODS.includes(method)) return fail(fd, 'Choose how it was paid');
  if (!ref) return fail(fd, 'Enter the reference shown on the bank statement (it is how payments are matched)');
  try {
    const ctx = await loadTenancy(sb, tid);
    const A = rentAccount(ctx.charges, ctx.entries);
    if (!A.rows.length) throw new Error('This tenancy has no rent due yet');
    const parts = allocate(amount, A.rows);
    const rows = parts.map((p) => ({ agency_id: member.agency_id, entry_date: on, account: 'client', amount_pence: p.amount, category: 'rent received', reference: ref,
      property_id: ctx.t.property_id, tenancy_id: tid, landlord_id: ctx.landlord_id, rent_charge_id: p.charge.id, memo: method + ' · rent for ' + monthName(p.charge.period_month) }));
    const { error } = await sb.from('ledger_entries').insert(rows);
    if (error) throw new Error(error.message);
    await takeFees(sb, member.agency_id, ctx);
    var msg = money(amount) + ' recorded' + (parts.length > 1 ? ', spread over ' + parts.map((p) => monthName(p.charge.period_month)).join(' and ') : ' for ' + monthName(parts[0].charge.period_month));
  } catch (e) { return fail(fd, e.message); }
  back(tid, msg);
}

// A mistake is never deleted: a reversal entry cancels it, and any fee that no longer applies is reversed too.
export async function reversePayment(tid, entryId, _prev, fd) {
  const { sb, member, user } = await staffOnly();
  const reason = txt(fd, 'reason');
  if (reason.length < 5) return fail(fd, 'Say why this is being reversed (kept on record)');
  try {
    const ctx = await loadTenancy(sb, tid);
    const e = ctx.entries.find((x) => String(x.id) === String(entryId) && x.category === 'rent received');
    if (!e) throw new Error('Payment not found');
    if (ctx.entries.some((x) => String(x.reverses_entry_id) === String(e.id))) throw new Error('This payment has already been reversed');
    const rev = (x, memo) => ({ agency_id: member.agency_id, entry_date: todayISO(), account: x.account, amount_pence: -x.amount_pence, category: 'reversal', reference: x.reference,
      property_id: x.property_id, tenancy_id: x.tenancy_id, landlord_id: x.landlord_id, rent_charge_id: x.rent_charge_id, reverses_entry_id: x.id, memo: memo + ': ' + reason + ' (' + user.email + ')' });
    const { error } = await sb.from('ledger_entries').insert(rev(e, 'Reversal of rent payment'));
    if (error) throw new Error(error.message);
    // if that month is no longer paid in full, give back its fee
    const charge = ctx.charges.find((c) => c.id === e.rent_charge_id);
    const paidAfter = ctx.entries.filter((x) => x.rent_charge_id === e.rent_charge_id && (x.category === 'rent received' || /^Reversal of rent/.test(x.memo || ''))).reduce((s, x) => s + Number(x.amount_pence), 0) - Number(e.amount_pence);
    if (charge && paidAfter < charge.amount_pence) {
      const fees = ctx.entries.filter((x) => x.rent_charge_id === e.rent_charge_id && x.category === 'management fee' && !ctx.entries.some((y) => String(y.reverses_entry_id) === String(x.id)));
      if (fees.length) { const { error: fe } = await sb.from('ledger_entries').insert(fees.map((f) => rev(f, 'Reversal of management fee'))); if (fe) throw new Error(fe.message); }
    }
  } catch (e) { return fail(fd, e.message); }
  back(tid, 'Payment reversed. The original stays on record');
}

// Record that a reminder was sent (the message itself is sent from the user's own email or phone)
export async function logReminder(tid, _prev, fd) {
  const { sb, member } = await staffOnly();
  const stage = Number(txt(fd, 'stage')), channel = txt(fd, 'channel') === 'sms' ? 'sms' : 'email';
  if (!REMINDER_STAGES[stage]) return fail(fd, 'Choose the reminder');
  const { data: lead } = await sb.from('tenancy_people').select('contact_id').eq('tenancy_id', tid).eq('is_lead', true).maybeSingle();
  const { error } = await sb.from('outbox').insert({ agency_id: member.agency_id, rule: 'rent_arrears_' + stage, dedupe_key: 'arrears:' + tid + ':' + Date.now(), to_contact_id: lead ? lead.contact_id : null,
    channel, body: txt(fd, 'body') || REMINDER_STAGES[stage], status: 'sent', sent_at: new Date().toISOString() });
  if (error) return fail(fd, error.message);
  back(tid, REMINDER_STAGES[stage] + ' recorded as sent');
}

// Paying a landlord their money: client money out, never more than is held for them.
export async function payLandlord(landlordId, _prev, fd) {
  const { sb, member } = await staffOnly();
  const amount = pence(fd, 'amount'), on = txt(fd, 'paid_on'), ref = txt(fd, 'reference');
  if (!amount) return fail(fd, 'Enter the amount paid');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date paid (not in the future)');
  if (!ref) return fail(fd, 'Enter the payment reference');
  const { data: bal } = await sb.from('landlord_balances').select('balance_pence').eq('landlord_id', landlordId).maybeSingle();
  const held = bal ? Number(bal.balance_pence) : 0;
  if (amount > held) return fail(fd, 'Only ' + money(held) + ' is held for this landlord. You can\'t pay out more than that');
  const { error } = await sb.from('ledger_entries').insert({ agency_id: member.agency_id, entry_date: on, account: 'client', amount_pence: -amount, category: 'landlord payout', reference: ref, landlord_id: landlordId, memo: 'Paid to landlord' + (txt(fd, 'note') ? ': ' + txt(fd, 'note') : '') });
  if (error) return fail(fd, error.message);
  revalidatePath('/money'); redirect('/money?t=landlords&saved=' + encodeURIComponent(money(amount) + ' payout recorded'));
}
