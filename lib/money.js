import { todayISO, fmt, money, daysUntil } from './rules.js';

// ---------- months and due dates (all in plain dates, no time zones) ----------
export const monthOf = (iso) => String(iso).slice(0, 7) + '-01';
export const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 10); };
export const monthName = (m) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
export const dueOn = (m, day) => m.slice(0, 8) + String(Math.min(day, lastDay(m))).padStart(2, '0');

// The monthly rent charges a tenancy should have up to this month.
// New tenancies: from the start month. Taken over from another agent: from the month we took it on
// (earlier arrears are recorded separately as arrears at handover). In the first month rent is due on the start date
// if the usual due day has already passed.
export function chargesNeeded(t, today = todayISO()) {
  if (!t || t.status === 'ended' && !t.end_date) return [];
  const from = monthOf(t.taken_over ? String(t.created_at).slice(0, 10) > t.start_date ? String(t.created_at).slice(0, 10) : t.start_date : t.start_date);
  const until = monthOf(t.end_date && t.end_date < today ? t.end_date : today);
  const out = [];
  for (let m = from; m <= until; m = addMonth(m, 1)) {
    let due = dueOn(m, t.rent_due_day);
    if (m === monthOf(t.start_date) && due < t.start_date) due = t.start_date;
    out.push({ period_month: m, due_on: due, amount_pence: t.rent_pence });
  }
  return out;
}

// ---------- the ledger, read for one tenancy ----------
// Rent payments are 'rent received' entries pointing at a charge; corrections are 'reversal' entries.
export const isRentIn = (e) => e.category === 'rent received' || (e.category === 'reversal' && /^Reversal of rent/.test(e.memo || ''));
export const isFee = (e) => e.account === 'client' && (e.category === 'management fee' || (e.category === 'reversal' && /^Reversal of management fee/.test(e.memo || '')));

// Each month: due, paid, owed and how it stands; and the totals.
export function rentAccount(charges, entries, today = todayISO()) {
  const rows = [...charges].sort((a, b) => a.period_month.localeCompare(b.period_month)).map((c) => {
    const paid = entries.filter((e) => e.rent_charge_id === c.id && isRentIn(e)).reduce((s, e) => s + Number(e.amount_pence), 0);
    const owed = c.amount_pence - paid, d = daysUntil(c.due_on);
    let st;
    if (owed <= 0) st = { cls: 'ok', text: owed < 0 ? 'Paid · ' + money(-owed) + ' over' : 'Paid' };
    else if (d > 0) st = { cls: 'info', text: (paid ? 'Part paid · ' : '') + 'Due ' + fmt(c.due_on) };
    else if (d === 0) st = { cls: 'due', text: (paid ? 'Part paid · ' : '') + 'Due today' };
    else st = { cls: -d >= 7 ? 'bad' : 'due', text: (paid ? 'Part paid · ' : '') + -d + ' day' + (d === -1 ? '' : 's') + ' late' };
    const fees = entries.filter((e) => e.rent_charge_id === c.id && isFee(e)).reduce((s, e) => s - Number(e.amount_pence), 0);
    return { ...c, paid, owed, late: owed > 0 && d < 0 ? -d : 0, st, feeTaken: fees > 0 };
  });
  const arrears = rows.filter((r) => r.owed > 0 && r.due_on <= today).reduce((s, r) => s + r.owed, 0);
  const credit = rows.filter((r) => r.owed < 0).reduce((s, r) => s - r.owed, 0);
  const oldestLate = rows.find((r) => r.late > 0);
  const current = rows.filter((r) => r.period_month <= monthOf(today)).pop() || null;
  return { rows, arrears, credit, daysLate: oldestLate ? oldestLate.late : 0, current, payable: rows.filter((r) => r.owed > 0) };
}

// Spread a payment over the months owed, oldest first. Anything left over sits on the latest month as credit.
export function allocate(amount, rows) {
  const out = []; let left = amount;
  for (const r of rows.filter((x) => x.owed > 0)) { if (left <= 0) break; const take = Math.min(left, r.owed); out.push({ charge: r, amount: take }); left -= take; }
  if (left > 0 && rows.length) { const last = rows[rows.length - 1]; const ex = out.find((o) => o.charge.id === last.id); if (ex) ex.amount += left; else out.push({ charge: last, amount: left }); }
  return out;
}

// ---------- chasing arrears ----------
// Our own steps. The formal letter carries the information a Scottish landlord must give before
// applying to the Tribunal on rent arrears grounds (pre-action requirements) — VERIFY the wording with a solicitor.
export const REMINDER_STAGES = ['Friendly reminder', 'Second reminder', 'Formal arrears letter'];
export function reminderText(stage, { tenant, address, owed, dueOn: due, agency, contact, rent, dueDay, breakdown = [] }) {
  if (stage === 0) return `Hi ${tenant}, this is ${agency}. Our records show the rent due on ${fmt(due)} for ${address} hasn't reached us yet (${money(owed)} outstanding). If you've already paid, thank you, please ignore this. If you're having difficulty paying, please get in touch so we can talk about it. ${contact}`;
  if (stage === 1) return `Hi ${tenant}, following our earlier reminder, ${money(owed)} rent is still outstanding for ${address}. Please pay as soon as you can, or contact us today to agree a payment plan. ${contact}`;
  return `Dear ${tenant},

Rent arrears at ${address}

Our records show rent arrears of ${money(owed)} on your tenancy. The oldest unpaid rent was due on ${fmt(due)}.
${rent ? `\nYour tenancy agreement says the rent is ${money(rent)} a month, due on day ${dueDay} of each month.\n` : ''}
${breakdown.length ? 'How the arrears are made up:\n' + breakdown.map((b) => `- Rent due ${fmt(b.due_on)}: ${money(b.amount_pence)} due, ${money(b.paid)} paid, ${money(b.owed)} unpaid`).join('\n') + `\n- Total unpaid: ${money(owed)}\n` : ''}
We would like to agree a reasonable plan with you to pay this back. Please contact us within 14 days at ${contact} so we can discuss it. If you are having difficulty, you may be entitled to help with your rent, for example through Universal Credit or a Discretionary Housing Payment from your council.

Free, confidential money and housing advice is available from:
- Citizens Advice Scotland: www.cas.org.uk, 0800 028 1456
- Shelter Scotland: scotland.shelter.org.uk, 0808 800 4444
- Your local council's housing and welfare rights service

If the arrears are not addressed, your landlord may have to consider applying to the First-tier Tribunal for Scotland (Housing and Property Chamber). We would much rather agree a way forward with you.

Yours sincerely,
${agency} (on behalf of your landlord)`;
}

export const PAY_METHODS = ['Bank transfer', 'Standing order', 'Universal Credit (paid direct)', 'Card', 'Cash', 'Cheque'];

// Make sure every tenancy has its monthly rent charges up to this month (safe to run any number of times).
export async function ensureCharges(sb, agency_id, tenancies) {
  const rows = tenancies.flatMap((t) => chargesNeeded(t).map((c) => ({ ...c, agency_id, tenancy_id: t.id })));
  if (!rows.length) return;
  await sb.from('rent_charges').upsert(rows, { onConflict: 'tenancy_id,period_month', ignoreDuplicates: true });
}

// ---------- Rent arrears: what a Tribunal looks for ----------
// Month-by-month list of what is unpaid, oldest first, with a running total
export function arrearsBreakdown(A, today = todayISO()) {
  let run = 0;
  return A.rows.filter((r) => r.due_on <= today && r.owed > 0).map((r) => ({ ...r, running: (run += r.owed) }));
}
// When the current run of arrears began, and how long it has lasted (balance above zero every day since)
export function arrearsSince(charges, entries, today = todayISO()) {
  const ev = [...charges.filter((c) => c.due_on <= today).map((c) => ({ d: c.due_on, v: Number(c.amount_pence), k: 0 })),
    ...entries.filter(isRentIn).filter((e) => e.entry_date <= today).map((e) => ({ d: e.entry_date, v: -Number(e.amount_pence), k: 1 }))]
    .sort((a, b) => a.d.localeCompare(b.d) || b.k - a.k); // payments on a day count before that day's charge
  let bal = 0, since = null;
  for (const e of ev) { const before = bal; bal += e.v; if (before <= 0 && bal > 0) since = e.d; if (bal <= 0) since = null; }
  if (!since || bal <= 0) return null;
  const [y1, m1, d1] = since.split('-').map(Number), [y2, m2, d2] = today.split('-').map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return { since, months, threeMonths: months >= 3 };
}
// Is an agreed payment plan being kept? Expected = rent due since it was agreed (if paid on top of rent) + instalments due so far.
export function planProgress(plan, charges, entries, today = todayISO()) {
  if (!plan || plan.status !== 'agreed') return null;
  const from = String(plan.created_at).slice(0, 10);
  const step = plan.frequency === 'weekly' ? 7 : plan.frequency === 'fortnightly' ? 14 : null;
  let n = 0, d = plan.first_due;
  while (d <= today && n < 520) { n++; d = step ? new Date(Date.parse(d + 'T00:00:00Z') + step * 864e5).toISOString().slice(0, 10) : addMonth(monthOf(d), 1).slice(0, 8) + d.slice(8); }
  const instalments = Math.min(n * plan.instalment_pence, plan.arrears_pence);
  const rentDue = plan.with_rent ? charges.filter((c) => c.due_on >= from && c.due_on <= today).reduce((s, c) => s + Number(c.amount_pence), 0) : 0;
  const paid = entries.filter(isRentIn).filter((e) => e.entry_date >= from && e.entry_date <= today).reduce((s, e) => s + Number(e.amount_pence), 0);
  const expected = rentDue + instalments, behind = Math.max(0, expected - paid);
  return { instalmentsDue: n, expected, paid, behind, onTrack: behind === 0, next: d };
}
export const ARREARS_LOG_KINDS = ['phone call', 'letter', 'email', 'text message', 'meeting', 'visit', 'tenant contacted us', 'advice referral', 'benefit or UC application', 'note'];
// The pre-action requirements, and whether the records show each one done
export function preActionChecklist({ formalSent, plans, log }) {
  const agreed = plans.find((p) => p.status === 'agreed' || p.status === 'completed' || p.status === 'broken');
  return [
    ['Told the tenant the rent terms in their tenancy', !!formalSent],
    ['Gave a breakdown of the arrears with the dates each payment was due', !!formalSent],
    ['Explained how the tenancy could be ended and the steps to avoid it', !!formalSent],
    ['Signposted free advice (Citizens Advice, Shelter Scotland, council)', !!formalSent || log.some((l) => l.kind === 'advice referral')],
    ['Made reasonable efforts to agree a payment plan', plans.length > 0],
    ['If agreed: sent the plan and got the tenant\'s confirmation', !!(agreed && agreed.sent_on && agreed.tenant_confirmed_on)],
    ['If the tenant proposed a plan we refused: explained why in writing', plans.filter((p) => p.status === 'tenant proposal rejected').every((p) => p.rejection_reason)],
    ['Kept a record of every contact', log.length > 0]
  ].map(([label, done]) => ({ label, done }));
}
