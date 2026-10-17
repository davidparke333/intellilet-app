import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import EmailButton from '@/components/EmailButton';
import { money, fmt, todayISO } from '@/lib/rules';
import { rentAccount, monthName, REMINDER_STAGES, reminderText, PAY_METHODS, ensureCharges, arrearsBreakdown, arrearsSince, planProgress, preActionChecklist, ARREARS_LOG_KINDS } from '@/lib/money';
import FileField from '@/components/FileField';
import { recordPayment, reversePayment, logReminder, addArrearsLog, savePlan, planUpdate } from '../../actions';

export default async function RentAccount({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, user, member } = await currentMember();
  const staff = isStaff(member);
  const { data: t } = await sb.from('tenancies').select('*, properties(id, address_line1, address_line2, town, postcode), tenancy_people(is_lead, contacts(full_name, email, phone))').eq('id', id).maybeSingle();
  if (!t) notFound();
  if (staff) await ensureCharges(sb, member.agency_id, [t]);
  const [{ data: charges }, { data: entries }, { data: sent }] = await Promise.all([
    sb.from('rent_charges').select('*').eq('tenancy_id', id),
    sb.from('ledger_entries').select('*').eq('tenancy_id', id).order('id'),
    sb.from('outbox').select('rule, channel, sent_at, dedupe_key').like('dedupe_key', 'arrears:' + id + ':%').order('sent_at')
  ]);
  const [{ data: logRows }, { data: planRows }] = await Promise.all([
    sb.from('arrears_log').select('*').eq('tenancy_id', id).order('happened_on', { ascending: false }).order('id', { ascending: false }),
    sb.from('arrears_plans').select('*').eq('tenancy_id', id).order('created_at', { ascending: false })
  ]);
  const log = logRows || [], plans = planRows || [];
  const E = entries || [];
  const A = rentAccount(charges || [], E);
  const people = (t.tenancy_people || []).map((x) => x.contacts).filter(Boolean);
  const tenant = people.map((p) => p.full_name).join(' & ') || 'tenant';
  const address = [t.properties.address_line1, t.properties.address_line2, t.properties.town, t.properties.postcode].filter(Boolean).join(', ');
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'Your letting agent';
  // reminders sent since the arrears started
  const firstLate = A.rows.find((r) => r.late > 0);
  const sentSince = (sent || []).filter((s) => firstLate && s.sent_at.slice(0, 10) >= firstLate.due_on);
  const stage = Math.min(sentSince.length, REMINDER_STAGES.length - 1);
  const breakdown = arrearsBreakdown(A);
  const since = arrearsSince(charges || [], E);
  const msg = firstLate ? reminderText(stage, { tenant: stage === 2 ? tenant : (people.length ? people[0].full_name.split(' ')[0] : 'there'), address, owed: A.arrears, dueOn: firstLate.due_on, agency, contact: user.email, rent: t.rent_pence, dueDay: t.rent_due_day, breakdown }) : '';
  const formalSent = (sent || []).some((x) => x.rule === 'rent_arrears_2');
  const checklist = preActionChecklist({ formalSent, plans, log });
  const activePlan = plans.find((p) => p.status === 'agreed'), prog = planProgress(activePlan, charges || [], E);
  const showArrears = A.arrears > 0 || log.length > 0 || plans.length > 0;
  const phone = people.map((p) => p.phone).find(Boolean);
  const pays = E.filter((e) => e.category === 'rent received');
  const reversed = new Set(E.filter((e) => e.reverses_entry_id).map((e) => String(e.reverses_entry_id)));
  // group split payments (same reference and date) for display
  const groups = Object.values(pays.reduce((g, e) => { const k = e.entry_date + '|' + e.reference + '|' + e.created_at.slice(0, 16); (g[k] = g[k] || []).push(e); return g; }, {})).reverse();

  return (
    <>
      <Link href="/money" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Money</Link>
      <div className="pagehead"><h1>{t.properties.address_line1}</h1><span className="sub">{tenant} · {money(t.rent_pence)} a month, due day {t.rent_due_day}</span></div>
      {sp.saved && <div className="note" role="status">{sp.saved}</div>}

      <div className="card">
        <div className="row"><h3>Rent account</h3><span className={'pill ' + (A.arrears ? (A.daysLate >= 7 ? 'bad' : 'due') : 'ok')}>{A.arrears ? money(A.arrears) + ' owed' : A.credit ? money(A.credit) + ' in credit' : 'Up to date'}</span></div>
        {since && <div className={since.threeMonths ? 'error' : 'note'}>In arrears continuously since {fmt(since.since)} ({since.months} month{since.months === 1 ? '' : 's'}).{since.threeMonths ? ' That is three months or more in a row: speak to the landlord about next steps. Before any Tribunal application, check every pre-action step below is done.' : ''}</div>}
        {t.taken_over && t.arrears_at_handover_pence > 0 && <span className="small">Plus {money(t.arrears_at_handover_pence)} arrears from before we took over (not included above).</span>}
        {A.rows.slice().reverse().map((r) => (
          <div key={r.id} className="row small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <span><b>{monthName(r.period_month)}</b><br /><span className="muted">{money(r.amount_pence)} due {fmt(r.due_on)}{r.paid ? ' · ' + money(r.paid) + ' paid' : ''}{r.feeTaken ? ' · fee taken' : ''}</span></span>
            <span className={'pill ' + r.st.cls}>{r.st.text}</span></div>))}
        {!A.rows.length && <span className="muted">No rent due yet. The first month appears from {fmt(t.start_date)}.</span>}
      </div>

      {staff && A.rows.length > 0 && (
        <ActionForm className="card" action={recordPayment.bind(null, id)}>
          <h3>Record a payment</h3>
          <span className="muted small">It's put against the oldest month owed first. Anything extra is kept as credit.</span>
          <div className="grid2">
            <div className="field"><label htmlFor="am">Amount (£)</label><input id="am" name="amount" inputMode="decimal" defaultValue={((A.arrears || (A.current && A.current.owed > 0 ? A.current.owed : t.rent_pence)) / 100).toFixed(2)} /></div>
            <div className="field"><label htmlFor="ro">Date it reached the bank</label><input id="ro" name="received_on" type="date" defaultValue={todayISO()} max={todayISO()} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="me">How it was paid</label><select id="me" name="method">{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div className="field"><label htmlFor="rf">Bank reference</label><input id="rf" name="reference" placeholder="As it appears on the statement" /></div>
          </div>
          <button className="btn">Record payment</button>
        </ActionForm>)}

      {staff && A.arrears > 0 && firstLate && (
        <div className="card">
          <div className="nextbox"><span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)' }}>Next step</span>
            <b>Send the {REMINDER_STAGES[stage].toLowerCase()}</b><span className="muted small">{money(A.arrears)} owed, {A.daysLate} days late. {sentSince.length ? sentSince.length + ' reminder' + (sentSince.length === 1 ? '' : 's') + ' sent so far.' : 'No reminders sent yet.'}</span></div>
          <textarea readOnly rows={stage === 2 ? 14 : 4} defaultValue={msg} aria-label="Reminder text" />
          <EmailButton to={people.map((p) => p.email).filter(Boolean)} cc={[]} subject={stage === 2 ? 'Rent arrears at ' + t.properties.address_line1 : 'Rent reminder: ' + t.properties.address_line1} body={msg} label={'Email the ' + REMINDER_STAGES[stage].toLowerCase()} />
          {phone && stage < 2 && <a className="btn ghost" href={'sms:' + phone.replace(/\s/g, '') + '?&body=' + encodeURIComponent(msg)}>Text it to {phone} (on your phone)</a>}
          <ActionForm className="stack" action={logReminder.bind(null, id)}>
            <input type="hidden" name="stage" value={stage} /><input type="hidden" name="body" value={msg} />
            <div className="field"><label htmlFor="ch">Sent by</label><select id="ch" name="channel"><option value="email">Email</option><option value="sms">Text message</option></select></div>
            <button className="btn ghost small">Record it as sent</button>
          </ActionForm>
          {stage === 2 && <Link className="btn ghost small" href={'/money/rent/' + id + '/letter'}>Print the formal letter (with the arrears breakdown)</Link>}
          {stage === 2 && <span className="muted small">Before any Tribunal application for rent arrears, Scottish law requires you to have given the tenant clear information about the arrears and their rights, signposted advice, and tried to agree a payment plan. Keep a record of every contact. Check the letter with your solicitor before relying on it.</span>}
          {sentSince.length > 0 && <span className="muted small">Sent: {sentSince.map((s) => REMINDER_STAGES[Number(s.rule.split('_').pop())] + ' ' + fmt(s.sent_at.slice(0, 10)) + ' (' + s.channel + ')').join(' · ')}</span>}
        </div>)}

      {staff && showArrears && (
        <div className="card">
          <div className="row"><h3>Arrears record</h3><Link className="btn ghost small" href={'/money/rent/' + id + '/evidence'}>Evidence pack</Link></div>
          <span className="muted small">What a Tribunal will look for before any eviction for rent arrears. Everything here is dated and can't be changed later.</span>
          <b className="small">Pre-action steps</b>
          {checklist.map((c) => <span key={c.label} className="small"><span aria-hidden="true" style={{ display: 'inline-block', width: 20, fontWeight: 700, color: c.done ? 'var(--accent)' : 'var(--bad-ink)' }}>{c.done ? '✓' : '○'}</span>{c.label}</span>)}

          <b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>Payment plan</b>
          {activePlan ? (<div className="stack small" style={{ gap: 4 }}>
            <span>{money(activePlan.instalment_pence)} {activePlan.frequency} from {fmt(activePlan.first_due)} towards {money(activePlan.arrears_pence)}{activePlan.with_rent ? ', on top of the rent' : ''}</span>
            {prog && <span className={'pill ' + (prog.onTrack ? 'ok' : 'bad')} style={{ alignSelf: 'flex-start' }}>{prog.onTrack ? 'On track' : 'Behind by ' + money(prog.behind)}</span>}
            <span className="muted">Copy sent: {activePlan.sent_on ? fmt(activePlan.sent_on) : 'not yet'} · Tenant confirmed: {activePlan.tenant_confirmed_on ? fmt(activePlan.tenant_confirmed_on) + ' (' + activePlan.confirmed_how + ')' : 'not yet'}</span>
            <Link className="btn ghost small" href={'/money/rent/' + id + '/plan/' + activePlan.id}>Print the plan for the tenant to sign</Link>
            {!activePlan.sent_on && <ActionForm className="row" action={planUpdate.bind(null, id, activePlan.id)}><input type="hidden" name="what" value="sent" /><input name="on" type="date" defaultValue={todayISO()} max={todayISO()} aria-label="Date sent" /><button className="btn ghost small">Copy sent</button></ActionForm>}
            {!activePlan.tenant_confirmed_on && <ActionForm className="stack" action={planUpdate.bind(null, id, activePlan.id)}><input type="hidden" name="what" value="confirmed" />
              <div className="grid2"><div className="field"><label htmlFor="cfo">Tenant confirmed on</label><input id="cfo" name="on" type="date" defaultValue={todayISO()} max={todayISO()} /></div>
                <div className="field"><label htmlFor="cfh">How</label><input id="cfh" name="how" placeholder="e.g. signed copy returned, by email" /></div></div>
              <FileField label="Their signed copy or email (optional)" agencyId={member.agency_id} propertyId={t.property_id} prefix="conffile" />
              <button className="btn ghost small">Record confirmation</button></ActionForm>}
            <div className="row"><ActionForm className="row" action={planUpdate.bind(null, id, activePlan.id)}><input type="hidden" name="what" value="completed" /><button className="btn ghost small">Plan completed</button></ActionForm>
              <ActionForm className="row" action={planUpdate.bind(null, id, activePlan.id)}><input type="hidden" name="what" value="broken" /><button className="btn ghost small">Plan broken</button></ActionForm></div>
          </div>) : <span className="muted small">No plan agreed. You must make reasonable efforts to agree one covering the arrears and future rent.</span>}
          <details className="more"><summary>{activePlan ? 'Replace with a new plan' : 'Record a payment plan'}</summary>
            <ActionForm className="stack" action={savePlan.bind(null, id)}>
              <div className="field"><label htmlFor="ps">Where it stands</label><select id="ps" name="status" defaultValue="agreed"><option value="offered">We offered it, waiting for the tenant</option><option value="agreed">Agreed with the tenant</option><option value="tenant proposal rejected">Tenant proposed it and we can't accept it</option></select></div>
              <div className="grid2"><div className="field"><label htmlFor="pa">Arrears it covers (£)</label><input id="pa" name="arrears" inputMode="decimal" defaultValue={(A.arrears / 100).toFixed(2)} /></div>
                <div className="field"><label htmlFor="pi">Instalment (£)</label><input id="pi" name="instalment" inputMode="decimal" placeholder="e.g. 100.00" /></div></div>
              <div className="grid2"><div className="field"><label htmlFor="pf">How often</label><select id="pf" name="frequency" defaultValue="monthly"><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></div>
                <div className="field"><label htmlFor="pd">First instalment due</label><input id="pd" name="first_due" type="date" /></div></div>
              <label className="check"><input type="checkbox" name="with_rent" defaultChecked />Paid on top of the normal rent</label>
              <label className="check"><input type="checkbox" name="tenant_proposed" />The tenant suggested this plan</label>
              <div className="field"><label htmlFor="pr">If we can't accept the tenant's proposal: why</label><input id="pr" name="rejection_reason" placeholder="e.g. £10 a month would take 23 years to clear the arrears" /></div>
              <div className="field"><label htmlFor="pn">Notes (optional)</label><input id="pn" name="notes" placeholder="e.g. Tenant starting new job in November" /></div>
              <button className="btn">Save plan</button></ActionForm></details>

          <b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>Contact record ({log.length})</b>
          <details className="more"><summary>Add a call, letter, visit or note</summary>
            <ActionForm className="stack" action={addArrearsLog.bind(null, id)}>
              <div className="grid2"><div className="field"><label htmlFor="lo">Date</label><input id="lo" name="happened_on" type="date" defaultValue={todayISO()} max={todayISO()} /></div>
                <div className="field"><label htmlFor="lk">What</label><select id="lk" name="kind">{ARREARS_LOG_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div></div>
              <div className="field"><label htmlFor="ls">What was said or done</label><textarea id="ls" name="summary" rows={3} placeholder="e.g. Spoke to tenant, lost hours at work, will pay £200 on Friday. Gave Citizens Advice number" /></div>
              <FileField label="Attachment (optional)" agencyId={member.agency_id} propertyId={t.property_id} prefix="logfile" />
              <button className="btn ghost">Add to record</button></ActionForm></details>
          {log.slice(0, 8).map((l) => <span key={l.id} className="small"><b>{fmt(l.happened_on)}</b> · {l.kind}: {l.summary}</span>)}
          {log.length > 8 && <Link className="small" href={'/money/rent/' + id + '/evidence'}>See all {log.length} in the evidence pack</Link>}
        </div>)}

      <div className="card"><h3>Payments</h3>
        {!groups.length && <span className="muted">None recorded yet.</span>}
        {groups.map((g) => { const tot = g.reduce((s, e) => s + Number(e.amount_pence), 0), rev = g.every((e) => reversed.has(String(e.id)));
          return (<div key={g[0].id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <div className="row small"><span><b>{money(tot)}</b> · {fmt(g[0].entry_date)} · ref {g[0].reference}<br /><span className="muted">{g.map((e) => e.memo).join('; ')}</span></span>{rev && <span className="pill info">Reversed</span>}</div>
            {staff && !rev && g.map((e) => !reversed.has(String(e.id)) && (
              <details key={e.id} className="more"><summary>Reverse {g.length > 1 ? money(e.amount_pence) + ' part' : 'this payment'}</summary>
                <ActionForm className="stack" action={reversePayment.bind(null, id, e.id)}>
                  <span className="muted small">For a mistake or a payment that bounced. The original stays on record and a reversal is added.</span>
                  <div className="field"><label htmlFor={'rv' + e.id}>Why</label><input id={'rv' + e.id} name="reason" placeholder="e.g. Recorded twice / payment returned by bank" /></div>
                  <button className="btn ghost small">Reverse</button></ActionForm></details>))}
          </div>); })}
      </div>
    </>
  );
}
