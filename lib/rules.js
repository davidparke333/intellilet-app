// IntelliLet compliance rules, ported from the tested prototype.
// Dates are plain calendar days handled in UTC so UK summer time never shifts a deadline.

export const CERTS = [
  { key: 'gas', label: 'Gas safety (CP12)', years: 1, basis: 'law', results: ['Pass', 'Fail — at risk / immediately dangerous'], rule: 'Legal deadline: a gas safety check every 12 months.' },
  { key: 'eicr', label: 'EICR', years: 5, basis: 'law', results: ['Satisfactory', 'Unsatisfactory — C1/C2/FI found'], rule: 'Legal deadline: an electrical inspection at least every 5 years.' },
  { key: 'epc', label: 'EPC', years: 10, basis: 'law', results: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], rule: 'Legal requirement: a valid EPC to let or advertise. Each one lasts 10 years.' },
  { key: 'alarms', label: 'Smoke, heat & CO alarms', years: 1, basis: 'policy', results: ['Pass', 'Fail — alarm missing or faulty'], rule: 'The law requires working, interlinked alarms. Testing them every year is our own schedule.' },
  { key: 'legionella', label: 'Legionella risk assessment', years: 2, basis: 'policy', results: ['Low risk', 'Action needed'], rule: 'The law requires a risk assessment. Reviewing it every 2 years is our own schedule.' }
];
export const certByKey = (k) => CERTS.find((c) => c.key === k);
export const resultPassed = (result) => !/^Fail|^Unsatisfactory|^Action/.test(result || '');

export const DEPOSIT_SCHEMES = ['SafeDeposits Scotland', 'Letting Protection Service Scotland', 'mydeposits Scotland'];
export const PI_ITEMS = [
  ['amount', 'Amount of the deposit and the date it was received'],
  ['lodged', 'Date the deposit was paid to the scheme'],
  ['address', 'Address of the property'],
  ['register', 'Statement that the landlord is registered, or has applied, with the council'],
  ['scheme', 'Name and contact details of the scheme'],
  ['retain', 'When the deposit can be kept back, with reference to the tenancy agreement']
];
export const PI_METHODS = ['Email', 'In the IntelliLet app', 'By hand', 'Recorded post', 'First class post'];

// ---- dates ----
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const isoToUTC = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const utcToISO = (d) => d.toISOString().slice(0, 10);
export const addYears = (iso, n) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return utcToISO(new Date(Date.UTC(y + n, m - 1, d))); };
export const daysUntil = (iso) => iso ? Math.round((isoToUTC(iso) - isoToUTC(todayISO())) / 86400000) : null;
export const fmt = (iso) => iso ? isoToUTC(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const money = (pence) => '£' + ((Number(pence) || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- UK bank holidays (all parts of the UK, as the 2011 Regulations require) ----
const easterSunday = (y) => {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
};
const nthMonday = (y, month, n) => { const d = new Date(Date.UTC(y, month - 1, 1)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 7 * (n - 1)); return d; };
const lastMonday = (y, month) => { const d = new Date(Date.UTC(y, month, 0)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d; };
const cache = {};
export function ukBankHolidays(y, extra = []) {
  const key = y + '|' + extra.join(',');
  if (cache[key]) return cache[key];
  const fixedOn = (m, d, name) => ({ date: new Date(Date.UTC(y, m - 1, d)), name, moves: true });
  const fixedDay = (date, name) => ({ date, name, moves: false });
  const easter = easterSunday(y), gf = new Date(easter), em = new Date(easter);
  gf.setUTCDate(gf.getUTCDate() - 2); em.setUTCDate(em.getUTCDate() + 1);
  const list = [
    fixedOn(1, 1, "New Year's Day"), fixedOn(1, 2, '2 January (Scotland)'), fixedOn(3, 17, "St Patrick's Day (N. Ireland)"),
    fixedDay(gf, 'Good Friday'), fixedDay(em, 'Easter Monday (England, Wales, N. Ireland)'),
    fixedDay(nthMonday(y, 5, 1), 'Early May bank holiday'), fixedDay(lastMonday(y, 5), 'Spring bank holiday'),
    fixedOn(7, 12, 'Battle of the Boyne (N. Ireland)'), fixedDay(nthMonday(y, 8, 1), 'Summer bank holiday (Scotland)'),
    fixedDay(lastMonday(y, 8), 'Summer bank holiday (England, Wales, N. Ireland)'), fixedOn(11, 30, "St Andrew's Day (Scotland)"),
    fixedOn(12, 25, 'Christmas Day'), fixedOn(12, 26, 'Boxing Day')
  ];
  const taken = new Map(); const wk = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  list.filter((h) => !h.moves || !wk(h.date)).forEach((h) => taken.set(utcToISO(h.date), h.name));
  list.filter((h) => h.moves && wk(h.date)).sort((a, b) => a.date - b.date).forEach((h) => {
    const d = new Date(h.date); while (wk(d) || taken.has(utcToISO(d))) d.setUTCDate(d.getUTCDate() + 1);
    taken.set(utcToISO(d), h.name + ' (substitute day)');
  });
  extra.filter((d) => String(d).slice(0, 4) === String(y)).forEach((d) => taken.set(d, 'Extra bank holiday'));
  return (cache[key] = taken);
}
const isWorkingDay = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !ukBankHolidays(d.getUTCFullYear()).has(utcToISO(d));
// n working days after the start date (the start date itself is not counted)
export function addWorkingDays(iso, n) { const d = isoToUTC(iso); let left = n; while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (isWorkingDay(d)) left--; } return utcToISO(d); }
export function workingDaysBetween(fromIso, toIso) {
  const t = isoToUTC(fromIso), e = isoToUTC(toIso), sign = e >= t ? 1 : -1; let n = 0; const d = new Date(t);
  while ((sign > 0 && d < e) || (sign < 0 && d > e)) { d.setUTCDate(d.getUTCDate() + sign); if (isWorkingDay(d)) n += sign; }
  return n;
}

// ---- certificate status: legal expiry vs our own review date; a failed result overrides the date ----
export function certStatus(c, cert) {
  if (!cert) return { cls: 'bad', text: 'Missing', ok: false };
  const d = daysUntil(cert.expires_on);
  if (!cert.passed) return { cls: 'bad', text: 'Failed · remedial work needed', ok: false, failed: true };
  if (c.basis === 'policy') {
    if (d < 0) return { cls: 'due', text: 'Review overdue', ok: false };
    if (d <= 60) return { cls: 'due', text: 'Review due in ' + d + ' days', ok: true };
    return { cls: 'ok', text: 'Next review ' + fmt(cert.expires_on), ok: true };
  }
  if (d < 0) return { cls: 'bad', text: 'Expired ' + fmt(cert.expires_on), ok: false };
  if (d <= 60) return { cls: 'due', text: 'Due in ' + d + ' days', ok: true };
  return { cls: 'ok', text: 'Valid to ' + fmt(cert.expires_on), ok: true };
}

// ---- deposit (Tenancy Deposit Schemes (Scotland) Regulations 2011, regs 3 and 42) ----
export function depositStatus(t) {
  if (!t || !Number(t.deposit_pence)) return null;
  const deadline = t.start_date ? addWorkingDays(t.start_date, 30) : null;
  if (t.deposit_lodged_on) {
    if (!deadline) return { cls: 'due', text: 'Protected · add tenancy start date to check timing', lodged: true };
    const late = t.deposit_lodged_on > deadline;
    return late ? { cls: 'bad', text: 'Protected late · ' + workingDaysBetween(deadline, t.deposit_lodged_on) + ' working day' + (workingDaysBetween(deadline, t.deposit_lodged_on) === 1 ? '' : 's') + ' after the ' + fmt(deadline) + ' deadline', lodged: true, late: true, deadline }
      : { cls: 'ok', text: 'Protected on time · ' + fmt(t.deposit_lodged_on) + ' (deadline ' + fmt(deadline) + ')', lodged: true, deadline };
  }
  const left = workingDaysBetween(todayISO(), deadline);
  if (left < 0) return { cls: 'bad', text: 'Not protected · deadline passed ' + fmt(deadline), late: true, deadline };
  return { cls: left <= 5 ? 'bad' : 'due', text: 'Lodge by ' + fmt(deadline) + ' · ' + left + ' working day' + (left === 1 ? '' : 's') + ' left', deadline };
}
export function prescribedInfo(t) {
  if (!t || !t.deposit_lodged_on) return null;
  const deadline = addWorkingDays(t.deposit_lodged_on, 30);
  const items = t.pi_items || {}, missing = PI_ITEMS.filter(([k]) => !items[k]).map(([, l]) => l);
  if (!t.pi_given_on) {
    const left = workingDaysBetween(todayISO(), deadline);
    return { deadline, given: false, late: left < 0, missing, cls: left <= 5 ? 'bad' : 'due', text: left < 0 ? 'Overdue · was due ' + fmt(deadline) : 'Give by ' + fmt(deadline) + ' · ' + left + ' working day' + (left === 1 ? '' : 's') + ' left' };
  }
  const late = t.pi_given_on > deadline;
  return { deadline, given: true, late, missing, cls: late || missing.length ? 'bad' : t.pi_document_id ? 'ok' : 'due',
    text: (late ? 'Given late ' : 'Given on time ') + fmt(t.pi_given_on) + (missing.length ? ' · ' + missing.length + ' of 6 items not confirmed' : !t.pi_document_id ? ' · no copy attached' : '') };
}

// ---- onboarding checklist: what must be in place before a property goes live ----
export function onboardingChecklist({ p, owners, tenancy, tenants, certs }) {
  const L = (owners[0] && owners[0].landlords) || null, c = (L && L.contacts) || {};
  const items = [];
  const add = (group, label, done) => items.push({ group, label, done: !!done });
  add('Property', 'Address and postcode', p.address_line1 && p.postcode);
  add('Property', 'Type and bedrooms', p.property_type && p.bedrooms != null);
  add('Property', 'Where the keys are kept', p.keys_location);
  if (p.property_type === 'HMO') add('Property', 'HMO licence number and expiry', p.hmo_licence_number && p.hmo_licence_expires);
  add('Landlord', 'Landlord name, email and phone', c.full_name && c.email && c.phone);
  add('Landlord', 'Landlord registration number and expiry', L && L.registration_number && L.registration_expires);
  add('Landlord', 'Management agreement signed', L && L.agreement_signed_on);
  add('Landlord', 'Bank details received (kept outside the app)', L && L.bank_details_received);
  add('Landlord', 'Identity and ownership checked', L && L.identity_checked);
  CERTS.forEach((k) => add('Safety', k.label + ' recorded', certs.find((x) => x.kind === k.key)));
  if (tenancy) {
    add('Tenancy', 'Lead tenant name, email and phone', tenants.some((x) => x.contacts && x.contacts.full_name && x.contacts.email && x.contacts.phone));
    add('Tenancy', 'Start date, rent and due day', tenancy.start_date && tenancy.rent_pence && tenancy.rent_due_day);
    if (Number(tenancy.deposit_pence)) {
      add('Tenancy', 'Deposit lodged with a scheme, with reference', tenancy.deposit_lodged_on && tenancy.deposit_scheme && tenancy.deposit_reference);
      add('Tenancy', 'Prescribed information given (all 6 items)', tenancy.pi_given_on && PI_ITEMS.every(([k]) => (tenancy.pi_items || {})[k]));
    }
  }
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}

// ---- repairs ----
export const CATS = ['Heating', 'Plumbing', 'Electrics', 'Damp & mould', 'Doors & windows', 'Something else'];
export const TRADES = ['Plumbing', 'Heating & gas', 'Electrics', 'Damp & mould', 'Joinery', 'Locksmith', 'Roofing', 'General'];
export const TRADE_FOR = { 'Heating': ['Heating & gas', 'Plumbing'], 'Plumbing': ['Plumbing', 'Heating & gas'], 'Electrics': ['Electrics'], 'Damp & mould': ['Damp & mould'], 'Doors & windows': ['Joinery', 'Locksmith'], 'Something else': ['General'] };
export const PRIORITY = { emergency: { label: 'Emergency', days: 1 }, urgent: { label: 'Urgent', days: 3 }, routine: { label: 'Routine', days: 14 } };
export const SOURCES = ['Tenant phone call', 'Tenant email', 'Tenant app', 'Inspection', 'Landlord', 'Staff'];
export const GO_AHEAD_REASONS = ['Landlord not answering', 'Out of hours', 'Tenant safety or no access', 'Legal duty (Repairing Standard)', 'Risk of further damage'];
export const daysOpen = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
export const pastTarget = (r) => ['reported', 'assigned'].includes(r.status) && daysOpen(r.reported_at) > PRIORITY[r.priority].days;
export const REPAIR_FILTERS = [
  ['mine', 'Your turn', ['reported', 'invoiced', 'approved']],
  ['out', 'With contractor', ['assigned']],
  ['done', 'Done', ['paid']]
];
// What staff should do next with a repair, in one line
export function repairNext(r) {
  if (r.status === 'reported') return r.priority === 'emergency' ? 'Phone a contractor now' : 'Book a contractor';
  if (r.status === 'assigned') return 'Wait for the contractor to finish, then mark work done';
  if (r.status === 'invoiced') return r.verified_at ? 'Check the invoice and approve it' : 'Check it is really fixed before you approve the invoice';
  if (r.status === 'approved') return 'Pay the contractor';
  if (r.status === 'paid' && !r.verified_at && r.tenant_confirmed !== 'fixed') return 'Check it is really fixed';
  return '';
}
export const FIX_CHECKS = ['Tenant confirmed it is fixed', 'I checked it myself', 'Contractor\'s after photos show it fixed'];
// the status pill, allowing for "work done but not yet checked"
export const statusLabel = (r) => r.status === 'invoiced' && !r.verified_at ? ['due', 'Check it\'s fixed'] : (STATUS_LABEL[r.status] || STATUS_LABEL.reported);
export const STATUS_LABEL = { reported: ['due', 'Reported'], assigned: ['info', 'Contractor booked'], invoiced: ['due', 'Invoice to approve'], approved: ['due', 'To pay'], paid: ['ok', 'Paid'], cancelled: ['info', 'Cancelled'] };
