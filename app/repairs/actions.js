'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { CATS, PRIORITY, SOURCES, TRADES, GO_AHEAD_REASONS, FIX_CHECKS, DAMP_CAUSES, DAMP_SEVERITY, DAMP_SUMMARY_METHODS, todayISO, fmt, money } from '@/lib/rules';

const txt = (fd, k) => String(fd.get(k) || '').trim();
const pence = (fd, k) => { const v = txt(fd, k).replace(/[£,\s]/g, ''); if (v === '') return null; const n = Math.round(parseFloat(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
const fail = (fd, msg) => ({ error: String(msg).replace(/\.$/, ''), values: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) });
const now = () => new Date().toISOString();

async function staffOnly() { const ctx = await currentMember(); if (!isStaff(ctx.member)) redirect('/'); return ctx; }
async function logEvent(sb, agency_id, repair_id, kind, detail) {
  const { error } = await sb.from('repair_events').insert({ agency_id, repair_id, kind, detail });
  if (error) throw new Error(error.message);
}
async function addPhoto(sb, agency_id, fd, prefix, repair_id, label) {
  const path = txt(fd, prefix + '_path'); if (!path) return;
  if (!path.startsWith(agency_id + '/')) throw new Error('File is not in this agency\'s folder');
  const { error } = await sb.from('documents').insert({ agency_id, storage_path: path, file_name: txt(fd, prefix + '_name') || null, mime_type: txt(fd, prefix + '_mime') || null,
    size_bytes: Number(txt(fd, prefix + '_size')) || null, about_table: 'repairs', about_id: repair_id, label });
  if (error) throw new Error(error.message);
}
const done = (id, msg) => { revalidatePath('/repairs'); revalidatePath(`/repairs/${id}`); redirect(`/repairs/${id}?saved=${encodeURIComponent(msg)}`); };

// ---- log a new repair ----
export async function logRepair(_prev, fd) {
  const { sb, member } = await staffOnly();
  const agency_id = member.agency_id, property_id = txt(fd, 'property_id');
  const category = CATS.includes(txt(fd, 'category')) ? txt(fd, 'category') : 'Something else';
  let priority = PRIORITY[txt(fd, 'priority')] ? txt(fd, 'priority') : 'routine';
  const is_damp = category === 'Damp & mould' || fd.get('is_damp') === 'on';
  if (is_damp && priority === 'routine') priority = 'urgent';
  if (!property_id) return fail(fd, 'Choose the property');
  if (!txt(fd, 'description')) return fail(fd, 'Describe the problem');
  const aware = txt(fd, 'aware_on') || todayISO();
  if (aware > todayISO()) return fail(fd, 'The date it was reported can\'t be in the future');
  const { data: t } = await sb.from('tenancies').select('id').eq('property_id', property_id).in('status', ['active', 'pending']).maybeSingle();
  let id;
  try {
    const { data, error } = await sb.from('repairs').insert({ agency_id, property_id, tenancy_id: t ? t.id : null, category, description: txt(fd, 'description'), priority, is_damp,
      source: SOURCES.includes(txt(fd, 'source')) ? txt(fd, 'source') : 'Staff', access_with_key: fd.get('access_with_key') === 'on', best_times: txt(fd, 'best_times') || null, ...(is_damp ? { dm_aware_on: aware } : {}) }).select('id').single();
    if (error) throw new Error(error.message);
    id = data.id;
    for (const n of [1, 2, 3]) await addPhoto(sb, agency_id, fd, 'photo' + n, id, 'photo of fault');
    await logEvent(sb, agency_id, id, 'status', { text: 'Reported: ' + txt(fd, 'description') + (is_damp ? ' · Damp and mould: legal deadlines run from ' + fmt(aware) : '') });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Repair logged');
}

// ---- phone a contractor: record the call, and book only once they agree ----
export async function callContractor(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const { data: r } = await sb.from('repairs').select('*, properties(id, property_owners(landlords(approval_limit_pence)))').eq('id', id).single();
  const cid = txt(fd, 'contractor_id'), outcome = txt(fd, 'outcome');
  const { data: c } = await sb.from('contractors').select('id, contacts(full_name)').eq('id', cid).single();
  const name = (c && c.contacts && c.contacts.full_name) || 'Contractor';
  try {
    if (outcome !== 'agreed') {
      await logEvent(sb, member.agency_id, id, 'call', { contractor_id: cid, outcome, text: 'Phoned ' + name + ': ' + (outcome === 'noanswer' ? 'no answer' : outcome === 'voicemail' ? 'left voicemail' : 'can\'t do it') });
      done(id, 'Call logged');
    }
    const limit = pence(fd, 'spend_limit');
    const owner = r.properties && r.properties.property_owners && r.properties.property_owners[0];
    const cap = Math.max((owner && owner.landlords && owner.landlords.approval_limit_pence) || 25000, await quoteCleared(sb, id));
    if (limit && limit > cap && r.priority !== 'emergency') {
      await logEvent(sb, member.agency_id, id, 'quote_sent', { amount: limit, text: 'Spend of ' + money(limit) + ' is above the landlord limit of ' + money(cap) + '. Quote sent to the landlord for approval' });
      done(id, 'Above the landlord limit: record the landlord\'s answer before booking');
    }
    const { error } = await sb.from('repairs').update({ status: 'assigned', contractor_id: cid, assigned_at: now(), spend_limit_pence: limit }).eq('id', id);
    if (error) throw new Error(error.message);
    await logEvent(sb, member.agency_id, id, 'booked', { contractor_id: cid, text: 'Phoned ' + name + ', they agreed. Booked' + (limit ? ', spend limit ' + money(limit) : '') + (limit && limit > cap ? '. Emergency above the landlord limit of ' + money(cap) + ': tell the landlord' : '') });
  } catch (e) { if (e && e.digest && String(e.digest).startsWith('NEXT_REDIRECT')) throw e; return fail(fd, e.message); }
  done(id, 'Booked ' + name);
}
// the largest amount the landlord has approved (or we went ahead with) for this repair
async function quoteCleared(sb, id) {
  const { data: ev } = await sb.from('repair_events').select('kind, detail').eq('repair_id', id).in('kind', ['quote_decision']);
  return Math.max(0, ...(ev || []).filter((e) => ['approved', 'proceeded'].includes(e.detail.status)).map((e) => Number(e.detail.amount) || 0));
}
export async function quoteDecision(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const status = txt(fd, 'status'), amount = pence(fd, 'amount') || 0, note = txt(fd, 'note');
  if (status === 'proceeded' && !GO_AHEAD_REASONS.includes(note)) return fail(fd, 'Choose why you are going ahead without the landlord');
  try {
    await logEvent(sb, member.agency_id, id, 'quote_decision', { status, amount, note,
      text: status === 'approved' ? 'Landlord approved ' + money(amount) + (note ? ': ' + note : '') : status === 'declined' ? 'Landlord declined the quote' + (note ? ': ' + note : '') : 'Went ahead up to ' + money(amount) + ' without a reply: ' + note });
  } catch (e) { return fail(fd, e.message); }
  done(id, status === 'declined' ? 'Landlord declined' : 'Cleared up to ' + money(amount) + '. You can book now');
}

// ---- work done, invoice, approve, pay ----
export async function workDone(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const { data: r } = await sb.from('repairs').select('*, contractors(*)').eq('id', id).single();
  const vatReg = !!(r && r.contractors && r.contractors.vat_registered);
  for (const k of ['labour', 'parts', 'vat']) if (txt(fd, k) && pence(fd, k) === null) return fail(fd, 'The ' + k + ' amount must be a number, like 120.50');
  const labour = pence(fd, 'labour') ?? 0, parts = pence(fd, 'parts') ?? 0;
  // VAT-registered: blank VAT box means 20% of labour + parts. Not registered: no VAT allowed.
  const vat = vatReg ? (pence(fd, 'vat') ?? Math.round((labour + parts) * 0.2)) : 0;
  if (!vatReg && pence(fd, 'vat')) return fail(fd, 'This contractor is not VAT registered, so VAT can\'t be added. If they are, tick VAT registered in Trades');
  if (!txt(fd, 'work_done')) return fail(fd, 'Say what was done');
  try {
    const { error } = await sb.from('invoices').insert({ agency_id: member.agency_id, repair_id: id, contractor_id: r.contractor_id, reference: txt(fd, 'reference') || null,
      work_done: txt(fd, 'work_done'), labour_pence: labour, parts_pence: parts, vat_pence: vat, submitted_via: 'staff' });
    if (error) throw new Error(error.message);
    const free = labour + parts + vat === 0;
    await sb.from('repairs').update({ status: free ? 'paid' : 'invoiced', completed_at: now() }).eq('id', id);
    if (r.is_damp && !r.dm_work_started_on) { await sb.from('repairs').update({ dm_work_started_on: todayISO() }).eq('id', id); }
    for (const n of [1, 2]) await addPhoto(sb, member.agency_id, fd, 'after' + n, id, 'after the work');
    await logEvent(sb, member.agency_id, id, 'status', { text: 'Work done: ' + txt(fd, 'work_done') + (free ? ' · no charge' : ' · invoice ' + money(labour + parts + vat) + (txt(fd, 'reference') ? ' (' + txt(fd, 'reference') + ')' : '') + ' to approve') });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Work recorded as done');
}
export async function approveInvoice(id) {
  const { sb, member, user } = await staffOnly();
  const { data: inv } = await sb.from('invoices').select('id, total_pence').eq('repair_id', id).eq('status', 'submitted').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!inv) redirect(`/repairs/${id}?error=${encodeURIComponent('No invoice waiting for approval')}`);
  const { data: chk } = await sb.from('repairs').select('verified_at').eq('id', id).single();
  if (!chk || !chk.verified_at) redirect(`/repairs/${id}?error=${encodeURIComponent('Confirm the repair is fixed before approving the invoice')}`);
  await sb.from('invoices').update({ status: 'approved', approved_by: user.id, approved_at: now() }).eq('id', inv.id);
  await sb.from('repairs').update({ status: 'approved' }).eq('id', id);
  await logEvent(sb, member.agency_id, id, 'status', { text: 'Invoice of ' + money(inv.total_pence) + ' approved by ' + user.email });
  done(id, 'Invoice approved');
}
export async function queryInvoice(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  if (!txt(fd, 'reason')) return fail(fd, 'Write what is wrong');
  const { data: inv } = await sb.from('invoices').select('id, total_pence').eq('repair_id', id).eq('status', 'submitted').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!inv) return fail(fd, 'No invoice waiting for approval');
  await sb.from('invoices').update({ status: 'queried' }).eq('id', inv.id);
  await sb.from('repairs').update({ status: 'assigned', completed_at: null, verified_at: null, verified_by: null }).eq('id', id);
  await logEvent(sb, member.agency_id, id, 'status', { text: (fd.get('notfixed') ? 'Not fixed, sent back to the contractor (invoice of ' + money(inv.total_pence) + ' on hold): ' : 'Invoice of ' + money(inv.total_pence) + ' sent back: ') + txt(fd, 'reason') });
  done(id, fd.get('notfixed') ? 'Sent back to the contractor to finish' : 'Invoice sent back to the contractor');
}
// Paying the contractor is client money: it goes in the ledger against the landlord
export async function markPaid(id) {
  const { sb, member, user } = await staffOnly();
  const { data: r } = await sb.from('repairs').select('id, property_id, contractor_id, properties(property_owners(landlord_id))').eq('id', id).single();
  const { data: inv } = await sb.from('invoices').select('id, total_pence, reference').eq('repair_id', id).eq('status', 'approved').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!inv) redirect(`/repairs/${id}?error=${encodeURIComponent('No approved invoice to pay')}`);
  const landlord_id = r.properties && r.properties.property_owners && r.properties.property_owners[0] ? r.properties.property_owners[0].landlord_id : null;
  // Client money rule: a landlord's bills are paid only from money held for that landlord
  const { data: bal } = landlord_id ? await sb.from('landlord_balances').select('balance_pence').eq('landlord_id', landlord_id).maybeSingle() : { data: null };
  const held = bal ? Number(bal.balance_pence) : 0;
  if (!landlord_id) redirect(`/repairs/${id}?error=${encodeURIComponent('This property has no landlord recorded, so there is no client money to pay from')}`);
  if (inv.total_pence > held) redirect(`/repairs/${id}?error=${encodeURIComponent('Not paid: only ' + money(held) + ' is held for this landlord, and the invoice is ' + money(inv.total_pence) + '. Ask the landlord to send ' + money(inv.total_pence - held) + ' first, record it under Money, Landlords, then pay. Paying now would use other clients\' money')}`);
  const { error } = await sb.from('ledger_entries').insert({ agency_id: member.agency_id, entry_date: new Date().toISOString().slice(0, 10), account: 'client', amount_pence: -inv.total_pence,
    category: 'contractor payment', reference: inv.reference || 'REPAIR-' + id.slice(0, 8).toUpperCase(), property_id: r.property_id, landlord_id, contractor_id: r.contractor_id, invoice_id: inv.id, memo: 'Repair invoice paid' });
  if (error) redirect(`/repairs/${id}?error=${encodeURIComponent(error.message)}`);
  await sb.from('invoices').update({ status: 'paid', paid_at: now() }).eq('id', inv.id);
  await sb.from('repairs').update({ status: 'paid' }).eq('id', id);
  await logEvent(sb, member.agency_id, id, 'status', { text: 'Contractor paid ' + money(inv.total_pence) + ' from the client account, recorded by ' + user.email });
  done(id, 'Contractor paid and recorded in the ledger');
}
// Confirm the problem is really fixed. This comes BEFORE the invoice can be approved and paid.
export async function verifyFixed(id, _prev, fd) {
  const { sb, member, user } = await staffOnly();
  const how = txt(fd, 'how');
  if (!FIX_CHECKS.includes(how)) return fail(fd, 'Choose how you know it is fixed');
  try {
    const { error } = await sb.from('repairs').update({ verified_at: now(), verified_by: user.id }).eq('id', id);
    if (error) throw new Error(error.message);
    await logEvent(sb, member.agency_id, id, 'status', { text: 'Confirmed fixed: ' + how.toLowerCase() + (txt(fd, 'note') ? ' (' + txt(fd, 'note') + ')' : '') + ', by ' + user.email });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Confirmed fixed');
}
export async function addNote(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  if (!txt(fd, 'note')) return fail(fd, 'Write the note first');
  try { await logEvent(sb, member.agency_id, id, 'note', { text: txt(fd, 'note') }); } catch (e) { return fail(fd, e.message); }
  done(id, 'Note added');
}

// ---- contractors ----
export async function addContractor(_prev, fd) {
  const { sb, member } = await staffOnly();
  if (!txt(fd, 'name')) return fail(fd, 'Enter the contractor\'s name');
  const trades = TRADES.filter((t) => fd.get('trade_' + t) === 'on');
  if (!trades.length) return fail(fd, 'Tick at least one trade');
  if (txt(fd, 'rate') && pence(fd, 'rate') === null) return fail(fd, 'The hourly rate must be a number, like 45');
  try {
    const { data: c, error } = await sb.from('contacts').insert({ agency_id: member.agency_id, kind: 'company', full_name: txt(fd, 'name'), email: txt(fd, 'email') || null, phone: txt(fd, 'phone') || null }).select('id').single();
    if (error) throw new Error(error.message);
    const { error: e2 } = await sb.from('contractors').insert({ agency_id: member.agency_id, contact_id: c.id, trades, hourly_rate_pence: pence(fd, 'rate'),
      availability: txt(fd, 'availability') === '24h' ? '24h' : 'office', areas: txt(fd, 'areas') || null, insurance_expires: txt(fd, 'insurance_expires') || null,
      gas_safe_number: txt(fd, 'gas_safe_number') || null, niceic_number: txt(fd, 'niceic_number') || null, status: 'approved',
      ...(fd.get('vat_registered') === 'on' ? { vat_registered: true, vat_number: txt(fd, 'vat_number') || null } : {}) });
    if (e2) throw new Error(e2.message);
  } catch (e) { return fail(fd, e.message); }
  revalidatePath('/contractors');
  const back = txt(fd, 'back');
  if (/^\/repairs\/[0-9a-f-]{36}$/.test(back)) { revalidatePath(back); redirect(back + '?saved=' + encodeURIComponent('Contractor added. You can phone them now')); }
  redirect('/contractors?saved=1');
}

// ---------- Damp and mould: each legal step (Housing (Scotland) Act 2006 s.14(5)-(9)) ----------
const isoOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const dampSave = async (sb, id, fields) => { const { error } = await sb.from('repairs').update(fields).eq('id', id); if (error) throw new Error(/dm_/.test(error.message) ? 'The database needs update 008 first (see the instructions from Claude)' : error.message); };
export async function recordInvestigation(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const on = txt(fd, 'investigated_on'), need = txt(fd, 'work_needed');
  if (!isoOk(on)) return fail(fd, 'Enter the date the investigation was completed');
  if (on > todayISO()) return fail(fd, 'The investigation date can\'t be in the future');
  if (!txt(fd, 'investigator')) return fail(fd, 'Say who carried out the investigation');
  if (!txt(fd, 'competence')) return fail(fd, 'Say why they are competent (their skills and experience)');
  if (!DAMP_CAUSES.includes(txt(fd, 'cause'))) return fail(fd, 'Choose the likely cause');
  if (!DAMP_SEVERITY.includes(txt(fd, 'severity'))) return fail(fd, 'Choose how bad it is');
  if (!txt(fd, 'findings')) return fail(fd, 'Write what the investigation found');
  if (!['yes', 'no'].includes(need)) return fail(fd, 'Say whether repair work is needed');
  if (need === 'yes' && !txt(fd, 'work_planned')) return fail(fd, 'Say what work will be done');
  try {
    await dampSave(sb, id, { dm_investigated_on: on, dm_investigator: txt(fd, 'investigator'), dm_competence: txt(fd, 'competence'), dm_cause: txt(fd, 'cause'), dm_severity: txt(fd, 'severity'),
      dm_rooms: txt(fd, 'rooms') || null, dm_findings: txt(fd, 'findings'), dm_work_needed: need === 'yes', dm_work_planned: txt(fd, 'work_planned') || null, dm_tenant_advice: txt(fd, 'advice') || null });
    for (const n of [1, 2, 3]) await addPhoto(sb, member.agency_id, fd, 'inv' + n, id, 'damp investigation photo');
    await logEvent(sb, member.agency_id, id, 'status', { text: 'Damp and mould investigated ' + fmt(on) + ' by ' + txt(fd, 'investigator') + ': ' + txt(fd, 'cause').toLowerCase() + '. ' + (need === 'yes' ? 'Work needed: ' + txt(fd, 'work_planned') : 'No repair work needed') });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Investigation recorded. Next: send the tenant the written summary');
}
export async function dampSummarySent(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const on = txt(fd, 'sent_on'), how = txt(fd, 'method');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date it was sent (not in the future)');
  if (!DAMP_SUMMARY_METHODS.includes(how)) return fail(fd, 'Choose how it was sent');
  try {
    await dampSave(sb, id, { dm_summary_sent_on: on, dm_summary_method: how });
    await addPhoto(sb, member.agency_id, fd, 'sumcopy', id, 'copy of damp and mould summary sent to tenant');
    await logEvent(sb, member.agency_id, id, 'status', { text: 'Written summary of the investigation sent to the tenant ' + fmt(on) + ' (' + how.toLowerCase() + ')' });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Summary recorded as sent');
}
export async function dampWorkStarted(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const on = txt(fd, 'started_on');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date work started (not in the future)');
  try {
    await dampSave(sb, id, { dm_work_started_on: on });
    await logEvent(sb, member.agency_id, id, 'status', { text: 'Repair work started ' + fmt(on) + (txt(fd, 'note') ? ': ' + txt(fd, 'note') : '') });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Start of work recorded');
}
// Can't meet a deadline: the tenant must be told why and when, and the effect of the damp kept down meanwhile (s.14(9))
export async function dampDelay(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const stage = txt(fd, 'stage'), by = txt(fd, 'expected_by'), on = txt(fd, 'sent_on');
  if (!['investigate', 'summary', 'start'].includes(stage)) return fail(fd, 'Choose which step is delayed');
  if (txt(fd, 'reason').length < 10) return fail(fd, 'Explain the reason (it must be beyond your control)');
  if (!isoOk(by)) return fail(fd, 'Enter the date you now expect to do it by');
  if (!txt(fd, 'mitigation')) return fail(fd, 'Say what is being done meanwhile to reduce the damp or mould');
  if (!isoOk(on) || on > todayISO()) return fail(fd, 'Enter the date the tenant was told');
  if (!DAMP_SUMMARY_METHODS.includes(txt(fd, 'method'))) return fail(fd, 'Choose how the tenant was told');
  const label = { investigate: 'investigation', summary: 'written summary', start: 'start of the repair' }[stage];
  try {
    await dampSave(sb, id, { dm_delay_stage: stage, dm_delay_until: by });
    await logEvent(sb, member.agency_id, id, 'dm_delay', { stage, reason: txt(fd, 'reason'), expected_by: by, mitigation: txt(fd, 'mitigation'), sent_on: on, method: txt(fd, 'method'),
      text: 'Delay notice sent to the tenant ' + fmt(on) + ' (' + txt(fd, 'method').toLowerCase() + '): the ' + label + ' can\'t be done in time because ' + txt(fd, 'reason') + '. Now expected by ' + fmt(by) + '. Meanwhile: ' + txt(fd, 'mitigation') });
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Delay notice recorded');
}
// Investigation found no repair work is needed (for example condensation, advice given) and the summary has gone
export async function dampCloseNoWork(id) {
  const { sb, member, user } = await staffOnly();
  const { data: r } = await sb.from('repairs').select('dm_investigated_on, dm_summary_sent_on, dm_work_needed').eq('id', id).single();
  if (!r || !r.dm_investigated_on || !r.dm_summary_sent_on || r.dm_work_needed !== false) redirect(`/repairs/${id}?error=${encodeURIComponent('Record the investigation (no work needed) and send the summary first')}`);
  await sb.from('repairs').update({ status: 'cancelled', verified_at: now(), verified_by: user.id }).eq('id', id);
  await logEvent(sb, member.agency_id, id, 'status', { text: 'Closed: investigation found no repair work needed, summary and advice given to the tenant. Closed by ' + user.email });
  done(id, 'Closed with no repair work needed');
}

// ---------- Quotes once a contractor is booked ----------
export async function recordQuote(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const amount = pence(fd, 'amount'), work = txt(fd, 'work');
  if (!amount) return fail(fd, 'Enter the quote total, like 480.00');
  if (!work) return fail(fd, 'Say what work the quote is for');
  try {
    await logEvent(sb, member.agency_id, id, 'quote', { amount, work, by: 'staff', text: 'Quote received from the contractor: ' + money(amount) + ' for ' + work });
    await addPhoto(sb, member.agency_id, fd, 'quotefile', id, 'contractor quote');
  } catch (e) { return fail(fd, e.message); }
  done(id, 'Quote recorded');
}
// Within the landlord's limit: staff approve and tell the contractor to go ahead
export async function approveQuote(id, amount) {
  const { sb, member, user } = await staffOnly();
  const { data: r } = await sb.from('repairs').select('properties(property_owners(landlords(approval_limit_pence)))').eq('id', id).single();
  const own = r && r.properties && r.properties.property_owners && r.properties.property_owners[0];
  const cap = (own && own.landlords && own.landlords.approval_limit_pence) || 25000;
  if (amount > cap) redirect(`/repairs/${id}?error=${encodeURIComponent('This quote is above the landlord\'s ' + money(cap) + ' limit, so the landlord must approve it')}`);
  await logEvent(sb, member.agency_id, id, 'quote_decision', { status: 'approved', amount, by: 'staff', note: 'within landlord limit', text: 'Quote of ' + money(amount) + ' approved by ' + user.email + ' (within the landlord\'s limit). Contractor told to go ahead' });
  done(id, 'Quote approved. Tell the contractor to go ahead');
}
// Landlord said no, or the contractor can't do it: free the job up for another contractor
export async function releaseContractor(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  if (!txt(fd, 'reason')) return fail(fd, 'Say why');
  const { data: r } = await sb.from('repairs').select('contractors(contacts(full_name))').eq('id', id).single();
  const { error } = await sb.from('repairs').update({ status: 'reported', contractor_id: null, assigned_at: null }).eq('id', id);
  if (error) return fail(fd, error.message);
  await logEvent(sb, member.agency_id, id, 'status', { text: 'Released ' + ((r && r.contractors && r.contractors.contacts.full_name) || 'the contractor') + ': ' + txt(fd, 'reason') + '. Looking for another contractor' });
  done(id, 'Contractor released. Book another one');
}
