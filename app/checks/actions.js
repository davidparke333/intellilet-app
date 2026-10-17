'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { CHECKS, CHECK_REPAIR, checkLabel, todayISO, fmt } from '@/lib/rules';

const txt = (fd, k) => String(fd.get(k) || '').trim();
const fail = (fd, msg) => ({ error: String(msg).replace(/\.$/, ''), values: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) });
const now = () => new Date().toISOString();
async function staffOnly() { const ctx = await currentMember(); if (!isStaff(ctx.member)) redirect('/'); return ctx; }
const back = (pid, key) => { revalidatePath(`/properties/${pid}`); revalidatePath('/checks'); revalidatePath('/repairs'); redirect(`/properties/${pid}?saved=${key}`); };

async function addDoc(sb, agency_id, fd, prefix, about_table, about_id, label) {
  const path = txt(fd, prefix + '_path'); if (!path) return;
  if (!path.startsWith(agency_id + '/')) throw new Error('File is not in this agency\'s folder');
  const { error } = await sb.from('documents').insert({ agency_id, storage_path: path, file_name: txt(fd, prefix + '_name') || null, mime_type: txt(fd, prefix + '_mime') || null,
    size_bytes: Number(txt(fd, prefix + '_size')) || null, about_table, about_id, label });
  if (error) throw new Error(error.message);
}
async function newRepair(sb, agency_id, property_id, code, note, inspected_on) {
  const [category, priority] = CHECK_REPAIR[code];
  const { data: t } = await sb.from('tenancies').select('id').eq('property_id', property_id).in('status', ['active', 'pending']).maybeSingle();
  const description = 'Inspection ' + code + ' (' + checkLabel(code) + '): ' + note;
  const { data: r, error } = await sb.from('repairs').insert({ agency_id, property_id, tenancy_id: t ? t.id : null, category, priority, is_damp: code === 'J', source: 'Inspection', description, ...(code === 'J' ? { dm_aware_on: inspected_on } : {}) }).select('id').single();
  if (error && /dm_/.test(error.message)) throw new Error('The database needs update 008 first (see the instructions from Claude)');
  if (error) throw new Error(error.message);
  await sb.from('repair_events').insert({ agency_id, repair_id: r.id, kind: 'status', detail: { text: 'Raised from the inspection on ' + fmt(inspected_on) + ': ' + note } });
  return r.id;
}

// ---- save a full A–J inspection ----
export async function saveInspection(property_id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const agency_id = member.agency_id;
  const inspected_on = txt(fd, 'inspected_on');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inspected_on)) return fail(fd, 'Enter the date of the inspection');
  if (inspected_on > todayISO()) return fail(fd, 'The inspection date can\'t be in the future');
  const results = {};
  for (const [code, label] of CHECKS) {
    const v = txt(fd, 'r_' + code);
    if (!['pass', 'action', 'na'].includes(v)) return fail(fd, 'Answer every check. ' + code + ' (' + label + ') has no answer');
    if (v === 'action' && !txt(fd, 'n_' + code)) return fail(fd, 'Say what needs doing for ' + code + ' (' + label + ')');
    results[code] = v;
  }
  const actions = CHECKS.map(([c]) => c).filter((c) => results[c] === 'action');
  const raise = fd.get('raise') === 'on';
  try {
    const { data: insp, error } = await sb.from('inspections').insert({ agency_id, property_id, inspected_on, notes: txt(fd, 'notes') || null, results }).select('id').single();
    if (error) throw new Error(/results/.test(error.message) ? 'The database needs update 006 first (see the instructions from Claude)' : error.message);
    // repairs already open here before this inspection, so the same problem isn't raised twice
    const { data: open } = await sb.from('repairs').select('id, category').eq('property_id', property_id).in('status', ['reported', 'assigned', 'invoiced']);
    for (const code of actions) {
      const note = txt(fd, 'n_' + code);
      let repair_id = null;
      if (raise || code === 'J') { // damp and mould: we are now aware, so the legal clock has started
        const dup = (open || []).find((r) => r.category === CHECK_REPAIR[code][0]);
        if (dup && fd.get('link_' + code) !== 'new') {
          repair_id = dup.id;
          await sb.from('repair_events').insert({ agency_id, repair_id, kind: 'note', detail: { text: 'Also found at the inspection on ' + fmt(inspected_on) + ' (' + code + ' ' + checkLabel(code) + '): ' + note } });
        } else repair_id = await newRepair(sb, agency_id, property_id, code, note, inspected_on);
      }
      const { data: f, error: fe } = await sb.from('inspection_findings').insert({ agency_id, inspection_id: insp.id, property_id, check_code: code, note, repair_id }).select('id').single();
      if (fe) throw new Error(fe.message);
      if (repair_id) await addDoc(sb, agency_id, fd, 'p_' + code, 'repairs', repair_id, 'inspection photo ' + code);
      else await addDoc(sb, agency_id, fd, 'p_' + code, 'inspection_findings', f.id, 'inspection photo ' + code);
    }
  } catch (e) { return fail(fd, e.message); }
  back(property_id, actions.length ? (raise ? 'inspection_repairs' : actions.includes('J') ? 'inspection_damp' : 'inspection_actions') : 'inspection_pass');
}

// ---- deal with a finding later, from the property page ----
async function loadFinding(sb, id) {
  const { data: f } = await sb.from('inspection_findings').select('*, inspections(inspected_on)').eq('id', id).single();
  return f;
}
export async function raiseFromFinding(id) {
  const { sb, member } = await staffOnly();
  const f = await loadFinding(sb, id);
  const rid = await newRepair(sb, member.agency_id, f.property_id, f.check_code, f.note || checkLabel(f.check_code), f.inspections.inspected_on);
  await sb.from('inspection_findings').update({ repair_id: rid }).eq('id', id);
  revalidatePath('/repairs'); redirect(`/repairs/${rid}?saved=${encodeURIComponent('Repair raised from the inspection')}`);
}
export async function linkFinding(id, _prev, fd) {
  const { sb, member } = await staffOnly();
  const f = await loadFinding(sb, id), rid = txt(fd, 'repair_id');
  if (!rid) return fail(fd, 'Choose the repair to link to');
  try {
    const { error } = await sb.from('inspection_findings').update({ repair_id: rid }).eq('id', id);
    if (error) throw new Error(error.message);
    await sb.from('repair_events').insert({ agency_id: member.agency_id, repair_id: rid, kind: 'note', detail: { text: 'Linked to inspection finding ' + f.check_code + ' (' + checkLabel(f.check_code) + ') from ' + fmt(f.inspections.inspected_on) } });
  } catch (e) { return fail(fd, e.message); }
  back(f.property_id, 'finding_linked');
}
export async function closeFinding(id, _prev, fd) {
  const { sb, user } = await staffOnly();
  const reason = txt(fd, 'reason');
  if (reason.length < 5) return fail(fd, 'Give a reason, it is kept on record');
  const f = await loadFinding(sb, id);
  const { error } = await sb.from('inspection_findings').update({ closed_reason: reason + ' (' + user.email + ')', closed_by: user.id, closed_at: now() }).eq('id', id);
  if (error) return fail(fd, error.message);
  back(f.property_id, 'finding_closed');
}
