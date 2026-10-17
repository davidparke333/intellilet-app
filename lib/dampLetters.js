import { fmt } from './rules.js';

// The words of the damp and mould letters, used for both the printed letter and the email,
// so what is emailed is exactly what is on file.
const stageName = { investigate: 'investigation of the damp and mould', summary: 'written summary of our investigation', start: 'start of the repair work' };

export function dampSummaryText({ r, D, agency, contact, tenants, address }) {
  const start = D.stages.find((s) => s.key === 'start');
  const L = [
    'Dear ' + (tenants.length ? tenants.join(' and ') : 'tenant') + ',', '',
    'Damp and mould at ' + address.join(', ') + ': results of our investigation', '',
    'Thank you for letting us know about damp and mould at your home. We became aware of it on ' + fmt(D.aware) + ', and it was investigated on ' + fmt(r.dm_investigated_on) + ' by ' + r.dm_investigator + '.', '',
    'WHAT WE FOUND', r.dm_findings + (r.dm_rooms ? '\nWhere: ' + r.dm_rooms : '') + '\nLikely cause: ' + r.dm_cause, ''
  ];
  if (r.dm_work_needed) L.push('WHAT WE WILL DO', r.dm_work_planned, start && start.doneOn ? 'This work started on ' + fmt(start.doneOn) + '.' : 'This work will start by ' + fmt(start.due) + '. We will contact you to arrange access.', '');
  else L.push('WHAT HAPPENS NEXT', 'The investigation found that no repair work to the property is needed at this time.', '');
  if (r.dm_tenant_advice) L.push('THINGS THAT WILL HELP', r.dm_tenant_advice, '');
  L.push('If the damp or mould comes back, gets worse, or you think it is affecting anyone\'s health, please contact us straight away and we will look at it again.', '',
    'If you have any questions, reply to this email or contact us at ' + contact + '.', '', 'Yours sincerely,', agency + ' (on behalf of your landlord)');
  return { subject: 'Damp and mould at ' + address[0] + ': results of our investigation', body: L.join('\n') };
}

export function dampDelayText({ delay, D, agency, contact, tenants, address }) {
  const L = [
    'Dear ' + (tenants.length ? tenants.join(' and ') : 'tenant') + ',', '',
    'Damp and mould at ' + address.join(', ') + ': update on timescales', '',
    'We are writing about the damp and mould at your home, which we became aware of on ' + fmt(D.aware) + '.', '',
    'We are sorry, but due to circumstances beyond our control we are unable to complete the ' + stageName[delay.stage] + ' within the time the law requires.', '',
    'REASON', delay.reason, '',
    'WHEN WE NOW EXPECT TO DO IT', 'By ' + fmt(delay.expected_by) + '.', '',
    'WHAT WE ARE DOING IN THE MEANTIME', delay.mitigation, '',
    'If the damp or mould gets worse, or you think it is affecting anyone\'s health, please contact us straight away.', '',
    'If you have any questions, reply to this email or contact us at ' + contact + '.', '', 'Yours sincerely,', agency + ' (on behalf of your landlord)'
  ];
  return { subject: 'Damp and mould at ' + address[0] + ': update on timescales', body: L.join('\n') };
}

// who the letter goes to, from a repair loaded with tenancies(tenancy_people(contacts)) and properties(property_owners(landlords(contacts)))
export function dampPeople(r) {
  const tp = (r.tenancies && r.tenancies.tenancy_people) || [];
  const tenants = tp.map((x) => x.contacts && x.contacts.full_name).filter(Boolean);
  const tenantEmails = tp.map((x) => x.contacts && x.contacts.email).filter(Boolean);
  const own = (r.properties && r.properties.property_owners) || [];
  const landlordEmails = own.map((o) => o.landlords && o.landlords.contacts && o.landlords.contacts.email).filter(Boolean);
  const p = r.properties || {};
  return { tenants, tenantEmails, landlordEmails, address: [p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean) };
}
