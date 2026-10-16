'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property';
import { CERTS, PI_ITEMS, DEPOSIT_SCHEMES, addYears, resultPassed, todayISO, onboardingChecklist } from '@/lib/rules';

const txt = (fd, k) => String(fd.get(k) || '').trim();
const dateOrNull = (fd, k) => { const v = txt(fd, k); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
const pence = (fd, k) => { const v = txt(fd, k).replace(/[£,\s]/g, ''); if (v === '') return null; const n = Math.round(parseFloat(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
const back = (id, page, msg) => redirect(`/properties/${id}${page ? '/' + page : ''}?error=${encodeURIComponent(msg)}`);

async function staffOnly() {
  const ctx = await currentMember();
  if (!isStaff(ctx.member)) redirect('/');
  return ctx;
}
// Record an uploaded file (already in private storage) and return its document id
async function addDocument(sb, agency_id, fd, prefix, about_table, about_id, label) {
  const path = txt(fd, prefix + '_path');
  if (!path) return null;
  if (!path.startsWith(agency_id + '/')) throw new Error('File is not in this agency\'s folder');
  const { data, error } = await sb.from('documents').insert({
    agency_id, storage_path: path, file_name: txt(fd, prefix + '_name') || null, mime_type: txt(fd, prefix + '_mime') || null,
    size_bytes: Number(txt(fd, prefix + '_size')) || null, about_table, about_id, label
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---- property details + landlord ----
export async function saveDetails(id, fd) {
  const { sb, member } = await staffOnly();
  const agency_id = member.agency_id;
  const beds = txt(fd, 'bedrooms') === '' ? null : Math.max(0, Math.min(30, parseInt(txt(fd, 'bedrooms'), 10) || 0));
  const { error } = await sb.from('properties').update({
    address_line1: txt(fd, 'address_line1'), address_line2: txt(fd, 'address_line2') || null, town: txt(fd, 'town') || null,
    postcode: txt(fd, 'postcode').toUpperCase(), property_type: txt(fd, 'property_type') || 'Flat', bedrooms: beds,
    keys_location: txt(fd, 'keys_location') || null, hmo_licence_number: txt(fd, 'hmo_licence_number') || null,
    hmo_licence_expires: dateOrNull(fd, 'hmo_licence_expires'), insurer: txt(fd, 'insurer') || null, insurance_expires: dateOrNull(fd, 'insurance_expires')
  }).eq('id', id);
  if (error) back(id, 'details', error.message);

  const name = txt(fd, 'landlord_name');
  if (name) {
    const contact = { full_name: name, email: txt(fd, 'landlord_email') || null, phone: txt(fd, 'landlord_phone') || null, postal_address: txt(fd, 'landlord_address') || null };
    const landlord = {
      registration_number: txt(fd, 'registration_number') || null, registration_expires: dateOrNull(fd, 'registration_expires'),
      package: txt(fd, 'package') === 'compact' ? 'compact' : 'standard', monthly_fee_pence: txt(fd, 'package') === 'compact' ? 5000 : 6500,
      approval_limit_pence: pence(fd, 'approval_limit') ?? 25000, agreement_signed_on: dateOrNull(fd, 'agreement_signed_on'),
      bank_details_received: fd.get('bank_details_received') === 'on', identity_checked: fd.get('identity_checked') === 'on'
    };
    const landlordId = txt(fd, 'landlord_id');
    try {
      if (landlordId) {
        const { data: l } = await sb.from('landlords').select('id, contact_id').eq('id', landlordId).single();
        await sb.from('contacts').update(contact).eq('id', l.contact_id);
        const agr = await addDocument(sb, agency_id, fd, 'agreement', 'landlords', l.id, 'management agreement');
        const { error: e2 } = await sb.from('landlords').update({ ...landlord, ...(agr ? { agreement_document_id: agr } : {}) }).eq('id', l.id);
        if (e2) throw new Error(e2.message);
      } else {
        const { data: c, error: e1 } = await sb.from('contacts').insert({ agency_id, ...contact }).select('id').single();
        if (e1) throw new Error(e1.message);
        const { data: l, error: e2 } = await sb.from('landlords').insert({ agency_id, contact_id: c.id, ...landlord }).select('id').single();
        if (e2) throw new Error(e2.message);
        const agr = await addDocument(sb, agency_id, fd, 'agreement', 'landlords', l.id, 'management agreement');
        if (agr) await sb.from('landlords').update({ agreement_document_id: agr }).eq('id', l.id);
        await sb.from('property_owners').insert({ agency_id, property_id: id, landlord_id: l.id });
      }
    } catch (e) { back(id, 'details', e.message); }
  }
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}?saved=details`);
}

// ---- tenancy + tenants ----
export async function saveTenancy(id, fd) {
  const { sb, member } = await staffOnly();
  const agency_id = member.agency_id;
  const start = dateOrNull(fd, 'start_date'), rent = pence(fd, 'rent');
  if (!start || rent === null) back(id, 'tenancy', 'Enter the tenancy start date and the monthly rent');
  const due = Math.max(1, Math.min(28, parseInt(txt(fd, 'rent_due_day'), 10) || 1));
  const rec = { start_date: start, rent_pence: rent, rent_due_day: due, taken_over: fd.get('taken_over') === 'on',
    arrears_at_handover_pence: pence(fd, 'arrears_at_handover') ?? 0, deposit_pence: pence(fd, 'deposit') ?? 0, status: start > todayISO() ? 'pending' : 'active' };
  let tenancyId = txt(fd, 'tenancy_id');
  try {
    if (tenancyId) {
      const { error } = await sb.from('tenancies').update(rec).eq('id', tenancyId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await sb.from('tenancies').insert({ agency_id, property_id: id, ...rec }).select('id').single();
      if (error) throw new Error(error.message.includes('one_active_tenancy') ? 'This property already has an active tenancy' : error.message);
      tenancyId = data.id;
    }
    const doc = await addDocument(sb, agency_id, fd, 'agreement', 'tenancies', tenancyId, 'tenancy agreement');
    if (doc) await sb.from('tenancies').update({ tenancy_document_id: doc }).eq('id', tenancyId);
    // up to two tenants on this form; the first is the lead tenant
    for (const n of [1, 2]) {
      const name = txt(fd, `t${n}_name`); if (!name) continue;
      const contact = { full_name: name, email: txt(fd, `t${n}_email`) || null, phone: txt(fd, `t${n}_phone`) || null };
      const cid = txt(fd, `t${n}_contact`);
      if (cid) await sb.from('contacts').update(contact).eq('id', cid);
      else {
        const { data: c, error } = await sb.from('contacts').insert({ agency_id, ...contact }).select('id').single();
        if (error) throw new Error(error.message);
        await sb.from('tenancy_people').insert({ agency_id, tenancy_id: tenancyId, contact_id: c.id, is_lead: n === 1 });
      }
    }
  } catch (e) { back(id, 'tenancy', e.message); }
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}?saved=tenancy`);
}

// ---- deposit + prescribed information ----
export async function saveDeposit(id, fd) {
  const { sb, member } = await staffOnly();
  const tenancyId = txt(fd, 'tenancy_id'); if (!tenancyId) back(id, '', 'Add the tenancy first');
  const T = todayISO();
  const rec = { deposit_received_on: dateOrNull(fd, 'deposit_received_on'), deposit_scheme: DEPOSIT_SCHEMES.includes(txt(fd, 'deposit_scheme')) ? txt(fd, 'deposit_scheme') : null,
    deposit_lodged_on: dateOrNull(fd, 'deposit_lodged_on'), deposit_reference: txt(fd, 'deposit_reference') || null,
    pi_given_on: dateOrNull(fd, 'pi_given_on'), pi_method: txt(fd, 'pi_method') || null,
    pi_items: Object.fromEntries(PI_ITEMS.map(([k]) => [k, fd.get('pi_' + k) === 'on'])) };
  if (rec.deposit_lodged_on && !rec.deposit_scheme) back(id, 'deposit', 'Choose which scheme the deposit was lodged with');
  if ((rec.deposit_lodged_on && rec.deposit_lodged_on > T) || (rec.pi_given_on && rec.pi_given_on > T)) back(id, 'deposit', 'Dates cannot be in the future');
  if (rec.pi_given_on && !rec.deposit_lodged_on) back(id, 'deposit', 'Record when the deposit was lodged first');
  if (rec.pi_given_on && rec.pi_given_on < rec.deposit_lodged_on) back(id, 'deposit', 'The information date is before the deposit was lodged. Check the dates');
  try {
    const doc = await addDocument(sb, member.agency_id, fd, 'pi', 'tenancies', tenancyId, 'prescribed information');
    const { error } = await sb.from('tenancies').update({ ...rec, ...(doc ? { pi_document_id: doc } : {}) }).eq('id', tenancyId);
    if (error) throw new Error(error.message);
  } catch (e) { back(id, 'deposit', e.message); }
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}?saved=deposit`);
}

// ---- record a certificate (the previous one of that kind is kept as history) ----
export async function recordCertificate(id, kind, fd) {
  const { sb, member } = await staffOnly();
  const c = CERTS.find((x) => x.key === kind); if (!c) redirect(`/properties/${id}`);
  const checked = dateOrNull(fd, 'checked_on');
  if (!checked) back(id, 'certificate/' + kind, 'Enter the date of the check');
  if (checked > todayISO()) back(id, 'certificate/' + kind, 'The date of the check cannot be in the future');
  const expires = dateOrNull(fd, 'expires_on') || addYears(checked, c.years);
  if (expires < checked) back(id, 'certificate/' + kind, 'The expiry date is before the date of the check');
  const result = txt(fd, 'result') || c.results[0];
  try {
    const { data: prev } = await sb.from('current_certificates').select('id').eq('property_id', id).eq('kind', kind);
    const { data: cert, error } = await sb.from('certificates').insert({
      agency_id: member.agency_id, property_id: id, kind, basis: c.basis, checked_on: checked, expires_on: expires, result,
      passed: resultPassed(result), carried_out_by: txt(fd, 'carried_out_by') || null, certificate_no: txt(fd, 'certificate_no') || null
    }).select('id').single();
    if (error) throw new Error(error.message);
    const doc = await addDocument(sb, member.agency_id, fd, 'cert', 'certificates', cert.id, c.label);
    if (doc) await sb.from('certificates').update({ document_id: doc }).eq('id', cert.id);
    for (const old of prev || []) await sb.from('certificates').update({ superseded_by: cert.id }).eq('id', old.id);
    // a failed check raises an urgent repair straight away
    if (!resultPassed(result) && fd.get('raise_repair') === 'on') {
      await sb.from('repairs').insert({ agency_id: member.agency_id, property_id: id, category: kind === 'gas' ? 'Heating' : kind === 'legionella' ? 'Plumbing' : 'Electrics',
        description: c.label + ' result: ' + result + (txt(fd, 'certificate_no') ? ' (certificate ' + txt(fd, 'certificate_no') + ')' : ''), priority: 'urgent', source: 'Staff' });
    }
  } catch (e) { back(id, 'certificate/' + kind, e.message); }
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}?saved=certificate`);
}

// ---- finish onboarding ----
export async function markLive(id) {
  const { sb } = await staffOnly();
  const data = await loadProperty(sb, id);
  if (!data) redirect('/');
  const list = onboardingChecklist(data);
  if (!list.complete) back(id, '', (list.total - list.done) + ' items still to do before this property can go live');
  await sb.from('properties').update({ onboarding_status: 'live' }).eq('id', id);
  revalidatePath(`/properties/${id}`); revalidatePath('/');
  redirect(`/properties/${id}?saved=live`);
}
