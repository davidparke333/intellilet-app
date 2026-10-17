import { rentAccount, arrearsBreakdown, arrearsSince, planProgress, preActionChecklist, REMINDER_STAGES } from './money.js';

// Everything about one tenancy's rent and arrears, for the printed letter, plan and evidence pack
export async function loadArrears(sb, id) {
  const { data: t } = await sb.from('tenancies').select('*, properties(id, address_line1, address_line2, town, postcode, property_owners(landlords(registration_number, contacts(full_name)))), tenancy_people(is_lead, contacts(full_name, email, phone))').eq('id', id).maybeSingle();
  if (!t) return null;
  const [{ data: charges }, { data: entries }, { data: sent }, { data: log }, { data: plans }] = await Promise.all([
    sb.from('rent_charges').select('*').eq('tenancy_id', id),
    sb.from('ledger_entries').select('*').eq('tenancy_id', id).order('entry_date').order('id'),
    sb.from('outbox').select('rule, channel, sent_at, body').like('dedupe_key', 'arrears:' + id + ':%').order('sent_at'),
    sb.from('arrears_log').select('*').eq('tenancy_id', id).order('happened_on').order('id'),
    sb.from('arrears_plans').select('*').eq('tenancy_id', id).order('created_at')
  ]);
  const C = charges || [], E = entries || [];
  const A = rentAccount(C, E);
  const tenants = (t.tenancy_people || []).map((x) => x.contacts).filter(Boolean);
  const p = t.properties, L = p.property_owners && p.property_owners[0] && p.property_owners[0].landlords;
  const formalSent = (sent || []).some((x) => x.rule === 'rent_arrears_2');
  const active = (plans || []).filter((x) => x.status === 'agreed').pop();
  return { t, p, L, tenants, charges: C, entries: E, A, breakdown: arrearsBreakdown(A), since: arrearsSince(C, E), sent: (sent || []).map((x) => ({ ...x, stage: REMINDER_STAGES[Number(x.rule.split('_').pop())] })),
    log: log || [], plans: plans || [], active, progress: planProgress(active, C, E), checklist: preActionChecklist({ formalSent, plans: plans || [], log: log || [] }),
    address: [p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean) };
}
