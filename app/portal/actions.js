'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember } from '@/lib/supabase/server';
import { CATS, URGENCY, todayISO } from '@/lib/rules';

const txt = (fd, k) => String(fd.get(k) || '').trim();
const fail = (fd, msg) => ({ error: String(msg).replace(/\.$/, ''), values: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) });
const pence = (fd, k) => { const v = txt(fd, k).replace(/[£,\s]/g, ''); if (v === '') return 0; const n = Math.round(parseFloat(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };

// A tenant reports a repair from their portal
export async function tenantReport(_prev, fd) {
  const { sb, member } = await currentMember();
  if (!member || member.role !== 'tenant') redirect('/portal');
  const { data: t } = await sb.from('tenancies').select('id, property_id, agency_id').in('id', ((await sb.from('tenancy_people').select('tenancy_id').eq('contact_id', member.contact_id)).data || []).map((x) => x.tenancy_id).concat('00000000-0000-0000-0000-000000000000')).in('status', ['active', 'pending']).limit(1).maybeSingle();
  if (!t) return fail(fd, 'We could not find your tenancy. Please contact us');
  const category = CATS.includes(txt(fd, 'category')) ? txt(fd, 'category') : 'Something else';
  const description = txt(fd, 'description');
  if (description.length < 5) return fail(fd, 'Tell us what the problem is');
  let priority = URGENCY.some(([k]) => k === txt(fd, 'priority')) ? txt(fd, 'priority') : 'routine';
  const is_damp = category === 'Damp & mould' || fd.get('is_damp') === 'on';
  if (is_damp && priority === 'routine') priority = 'urgent';
  let id;
  try {
    const { data, error } = await sb.from('repairs').insert({ agency_id: t.agency_id, property_id: t.property_id, tenancy_id: t.id, category, description, priority, is_damp, source: 'Tenant app',
      access_with_key: fd.get('access_with_key') === 'on', best_times: txt(fd, 'best_times') || null, ...(is_damp ? { dm_aware_on: todayISO() } : {}) }).select('id').single();
    if (error) throw new Error(error.message);
    id = data.id;
    await sb.from('repair_events').insert({ agency_id: t.agency_id, repair_id: id, kind: 'status', detail: { text: 'Reported by the tenant in the app: ' + description } });
    for (const n of [1, 2, 3]) {
      const path = txt(fd, 'photo' + n + '_path'); if (!path) continue;
      if (!path.startsWith(t.agency_id + '/' + t.property_id + '/')) throw new Error('Photo upload problem, please try again');
      const { error: de } = await sb.from('documents').insert({ agency_id: t.agency_id, storage_path: path, file_name: txt(fd, 'photo' + n + '_name') || null, mime_type: txt(fd, 'photo' + n + '_mime') || null, size_bytes: Number(txt(fd, 'photo' + n + '_size')) || null, about_table: 'repairs', about_id: id, label: 'photo from tenant' });
      if (de) throw new Error(de.message);
    }
  } catch (e) { return fail(fd, e.message); }
  revalidatePath('/portal'); redirect('/portal?saved=' + encodeURIComponent('Thank you. Your repair has been reported and we will be in touch.' + (priority === 'emergency' ? ' For an emergency, please also phone us now.' : '')));
}

// A contractor marks their job done and sends the invoice
export async function contractorDone(repairId, _prev, fd) {
  const { sb, member } = await currentMember();
  if (!member || member.role !== 'contractor') redirect('/portal');
  const labour = pence(fd, 'labour'), parts = pence(fd, 'parts'), vat = pence(fd, 'vat');
  if ([labour, parts, vat].some((x) => x === null)) return fail(fd, 'Amounts must be numbers, like 120.50');
  const { error } = await sb.rpc('contractor_complete', { p_repair: repairId, p_work: txt(fd, 'work_done'), p_labour: labour, p_parts: parts, p_vat: vat, p_ref: txt(fd, 'reference') });
  if (error) return fail(fd, error.message);
  revalidatePath('/portal'); redirect('/portal?saved=' + encodeURIComponent('Thank you. The job is marked done and your invoice has been sent for approval.'));
}

// A contractor sends their quote after visiting
export async function contractorQuote(repairId, _prev, fd) {
  const { sb, member } = await currentMember();
  if (!member || member.role !== 'contractor') redirect('/portal');
  const amount = pence(fd, 'amount');
  if (!amount) return fail(fd, 'Enter the total price, like 480.00');
  const { error } = await sb.rpc('contractor_quote', { p_repair: repairId, p_amount: amount, p_text: txt(fd, 'work') });
  if (error) return fail(fd, /contractor_quote/.test(error.message) ? 'The agency needs to finish a system update first' : error.message);
  revalidatePath('/portal'); redirect('/portal?saved=' + encodeURIComponent('Thank you. Your quote has been sent. Please wait for approval before starting the work.'));
}
// A landlord approves or declines a quote
export async function landlordDecision(repairId, approve, _prev, fd) {
  const { sb, member } = await currentMember();
  if (!member || member.role !== 'landlord') redirect('/portal');
  if (!approve && txt(fd, 'note').length < 3) return fail(fd, 'Please say why, so we can get a better price or another option');
  const { error } = await sb.rpc('landlord_quote_decision', { p_repair: repairId, p_approve: approve, p_note: txt(fd, 'note') });
  if (error) return fail(fd, error.message);
  revalidatePath('/portal'); redirect('/portal?saved=' + encodeURIComponent(approve ? 'Thank you. The contractor will be told to go ahead.' : 'Thank you. We will look at other options and be in touch.'));
}
