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
  await sb.from('arrears_log').insert({ agency_id: member.agency_id, tenancy_id: tid, happened_on: todayISO(), kind: channel === 'sms' ? 'text message' : 'email', summary: REMINDER_STAGES[stage] + ' sent. Wording kept in the evidence pack' });
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

// Money sent in by a landlord (for example to cover a repair): client money in, held for them.
export async function landlordFundsIn(landlordId, _prev, fd) {
  const { sb, member } = await staffOnly();
  const amount = pence(fd, 'amount'), on = txt(fd, 'received_on'), ref = txt(fd, 'reference');
  if (!amount) return fail(fd, 'Enter the amount received');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date it reached the bank (not in the future)');
  if (!ref) return fail(fd, 'Enter the bank reference');
  const { error } = await sb.from('ledger_entries').insert({ agency_id: member.agency_id, entry_date: on, account: 'client', amount_pence: amount, category: 'adjustment', reference: ref, landlord_id: landlordId, memo: 'Funds received from landlord' + (txt(fd, 'note') ? ': ' + txt(fd, 'note') : '') });
  if (error) return fail(fd, error.message);
  revalidatePath('/money'); redirect('/money?t=landlords&saved=' + encodeURIComponent(money(amount) + ' received from the landlord recorded'));
}

// ---------- Rent arrears records (pre-action requirements) ----------
const KINDS = ['phone call', 'letter', 'email', 'text message', 'meeting', 'visit', 'tenant contacted us', 'advice referral', 'benefit or UC application', 'note'];
const need008 = (m) => /arrears_(log|plans)/.test(m) ? 'The database needs update 015 first (see the instructions from Claude)' : m;
async function addDocFor(sb, agency_id, fd, prefix, about_table, about_id, label) {
  const path = txt(fd, prefix + '_path'); if (!path) return null;
  if (!path.startsWith(agency_id + '/')) throw new Error('File is not in this agency\'s folder');
  const { data, error } = await sb.from('documents').insert({ agency_id, storage_path: path, file_name: txt(fd, prefix + '_name') || null, mime_type: txt(fd, prefix + '_mime') || null,
    size_bytes: Number(txt(fd, prefix + '_size')) || null, about_table, about_id, label }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}
export async function addArrearsLog(tid, _prev, fd) {
  const { sb, member } = await staffOnly();
  const on = txt(fd, 'happened_on'), kind = txt(fd, 'kind');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date (not in the future)');
  if (!KINDS.includes(kind)) return fail(fd, 'Choose what kind of contact it was');
  if (txt(fd, 'summary').length < 5) return fail(fd, 'Write what was said or done');
  try {
    const doc = await addDocFor(sb, member.agency_id, fd, 'logfile', 'tenancies', tid, 'arrears record');
    const { error } = await sb.from('arrears_log').insert({ agency_id: member.agency_id, tenancy_id: tid, happened_on: on, kind, summary: txt(fd, 'summary'), document_id: doc });
    if (error) throw new Error(need008(error.message));
  } catch (e) { return fail(fd, e.message); }
  back(tid, 'Added to the arrears record');
}
export async function savePlan(tid, _prev, fd) {
  const { sb, member } = await staffOnly();
  const status = txt(fd, 'status'), arrears = pence(fd, 'arrears'), inst = pence(fd, 'instalment'), first = txt(fd, 'first_due'), freq = txt(fd, 'frequency');
  if (!['offered', 'agreed', 'tenant proposal rejected'].includes(status)) return fail(fd, 'Choose where the plan stands');
  if (!arrears) return fail(fd, 'Enter the arrears the plan covers');
  if (!inst) return fail(fd, 'Enter the instalment amount');
  if (!['weekly', 'fortnightly', 'monthly'].includes(freq)) return fail(fd, 'Choose how often');
  if (!isoOk(first)) return fail(fd, 'Enter when the first instalment is due');
  if (status === 'tenant proposal rejected' && txt(fd, 'rejection_reason').length < 10) return fail(fd, 'Explain why the tenant\'s proposal isn\'t reasonable. You must tell them this in writing');
  try {
    if (status === 'agreed') await sb.from('arrears_plans').update({ status: 'replaced' }).eq('tenancy_id', tid).eq('status', 'agreed');
    const { error } = await sb.from('arrears_plans').insert({ agency_id: member.agency_id, tenancy_id: tid, status, arrears_pence: arrears, instalment_pence: inst, frequency: freq, first_due: first,
      with_rent: fd.get('with_rent') === 'on', proposed_by: status === 'tenant proposal rejected' || fd.get('tenant_proposed') === 'on' ? 'tenant' : 'us', rejection_reason: txt(fd, 'rejection_reason') || null, notes: txt(fd, 'notes') || null });
    if (error) throw new Error(need008(error.message));
    await sb.from('arrears_log').insert({ agency_id: member.agency_id, tenancy_id: tid, happened_on: todayISO(), kind: 'note',
      summary: 'Payment plan ' + status + ': ' + money(inst) + ' ' + freq + ' from ' + fmt(first) + ' towards ' + money(arrears) + (fd.get('with_rent') === 'on' ? ', on top of the rent' : '') + (txt(fd, 'rejection_reason') ? '. Reason: ' + txt(fd, 'rejection_reason') : '') });
  } catch (e) { return fail(fd, e.message); }
  back(tid, status === 'tenant proposal rejected' ? 'Recorded. Send the tenant your written reasons (print the letter)' : 'Payment plan recorded. Send the tenant a copy and get their confirmation');
}
export async function planUpdate(tid, planId, _prev, fd) {
  const { sb, member } = await staffOnly();
  const what = txt(fd, 'what');
  const fields = {};
  if (what === 'sent') { if (!isoOk(txt(fd, 'on'))) return fail(fd, 'Enter the date it was sent'); fields.sent_on = txt(fd, 'on'); }
  else if (what === 'confirmed') { if (!isoOk(txt(fd, 'on'))) return fail(fd, 'Enter the date the tenant confirmed'); if (!txt(fd, 'how')) return fail(fd, 'Say how they confirmed (signed copy, email, text)'); fields.tenant_confirmed_on = txt(fd, 'on'); fields.confirmed_how = txt(fd, 'how'); }
  else if (['broken', 'completed'].includes(what)) fields.status = what;
  else return fail(fd, 'Nothing to update');
  try {
    const { error } = await sb.from('arrears_plans').update(fields).eq('id', planId);
    if (error) throw new Error(need008(error.message));
    await sb.from('arrears_log').insert({ agency_id: member.agency_id, tenancy_id: tid, happened_on: fields.sent_on || fields.tenant_confirmed_on || todayISO(), kind: what === 'sent' ? 'letter' : 'note',
      summary: what === 'sent' ? 'Copy of the payment plan sent to the tenant' : what === 'confirmed' ? 'Tenant confirmed they understand and agree the payment plan (' + fields.confirmed_how + ')' : 'Payment plan marked ' + what + (txt(fd, 'note') ? ': ' + txt(fd, 'note') : '') });
    if (what === 'confirmed') await addDocFor(sb, member.agency_id, fd, 'conffile', 'tenancies', tid, 'payment plan confirmation');
  } catch (e) { return fail(fd, e.message); }
  back(tid, 'Payment plan updated');
}
