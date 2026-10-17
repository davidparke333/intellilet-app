import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import FileField from '@/components/FileField';
import EmailButton from '@/components/EmailButton';
import { dampSummaryText, dampDelayText, dampPeople } from '@/lib/dampLetters';
import { dampStages, DAMP_CAUSES, DAMP_SEVERITY, DAMP_SUMMARY_METHODS, DAMP_RULES, todayISO, fmt } from '@/lib/rules';
import { recordInvestigation, dampSummarySent, dampWorkStarted, dampDelay, dampCloseNoWork } from '../actions';

// Awaab's Law (Scotland): the three legal steps for any damp or mould report, with their deadlines,
// and the form for whichever step is next.
export default function DampCard({ r, ev, staff, agencyId, agency, contact }) {
  const delays = ev.filter((e) => e.kind === 'dm_delay').map((e) => e.detail);
  const D = dampStages(r, delays);
  if (!D) return null;
  const nx = D.next, t = todayISO(), closed = r.status === 'cancelled';
  const who = dampPeople(r);
  const summaryMail = r.dm_investigated_on ? dampSummaryText({ r, D, agency, contact, ...who }) : null;
  const lastDelay = delays[delays.length - 1];
  const delayMail = lastDelay && lastDelay.reason ? dampDelayText({ delay: lastDelay, D, agency, contact, ...who }) : null;
  return (
    <div className="card" style={{ borderColor: D.overdue ? 'var(--bad-ink)' : undefined }}>
      <div className="row"><div className="stack" style={{ gap: 2 }}><h3>Damp and mould: legal steps</h3>
        <span className="muted small">Awaab's Law, Housing (Scotland) Act 2006 s.14. We became aware {fmt(D.aware)}. Deadlines count Scottish working days.</span></div>
        <span className={'pill ' + (D.overdue ? 'bad' : D.done ? 'ok' : 'due')}>{D.overdue ? 'Overdue' : D.done ? 'All steps done' : 'In progress'}</span></div>

      {D.stages.map((s, n) => (
        <div key={s.key} className="row" style={{ alignItems: 'flex-start', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <span className="small"><b>{n + 1}. {s.label}</b><br /><span className="muted">{s.key === 'investigate' ? DAMP_RULES.investigate + ' working days from becoming aware' : s.key === 'summary' ? DAMP_RULES.summary + ' working days after the investigation' : DAMP_RULES.start + ' working days after the investigation, if work is needed'}</span>
            {s.delay && <><br /><span style={{ color: 'var(--bad-ink)' }}>Delay notice sent {fmt(s.delay.sent_on)}: now expected by {fmt(s.delay.expected_by)}</span></>}</span>
          <span className={'pill ' + s.st.cls} style={{ textAlign: 'right' }}>{s.st.text}</span>
        </div>))}

      {r.dm_investigated_on && (
        <details className="more"><summary>What the investigation found</summary>
          <div className="stack small" style={{ gap: 4 }}>
            <span><b>By:</b> {r.dm_investigator} ({r.dm_competence})</span>
            <span><b>Cause:</b> {r.dm_cause} · <b>Severity:</b> {r.dm_severity}{r.dm_rooms ? ' · ' + r.dm_rooms : ''}</span>
            <span><b>Findings:</b> {r.dm_findings}</span>
            <span><b>Work:</b> {r.dm_work_needed ? r.dm_work_planned : 'No repair work needed'}</span>
            {r.dm_tenant_advice && <span><b>Advice to tenant:</b> {r.dm_tenant_advice}</span>}
          </div></details>)}
      {r.dm_investigated_on && <Link href={`/repairs/${r.id}/damp-summary`} className="btn ghost small">Print the written summary for the tenant</Link>}

      {staff && !closed && nx && nx.key === 'investigate' && (
        <ActionForm className="stack" action={recordInvestigation.bind(null, r.id)}>
          <b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>Record the investigation</b>
          <span className="muted small">Must be done by a competent person: someone who, in your reasonable opinion, has the skills and experience to find the cause and say what work is needed. That can be you, staff, or a contractor.</span>
          <div className="grid2">
            <div className="field"><label htmlFor="io">Date completed</label><input id="io" name="investigated_on" type="date" defaultValue={t} max={t} /></div>
            <div className="field"><label htmlFor="iv">Investigated by</label><input id="iv" name="investigator" placeholder="Name, and company if a contractor" /></div>
          </div>
          <div className="field"><label htmlFor="ic">Why they are competent</label><input id="ic" name="competence" placeholder="e.g. PCA damp surveyor; 10 years in building maintenance" /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="ca">Likely cause</label><select id="ca" name="cause" defaultValue=""><option value="" disabled>Choose</option>{DAMP_CAUSES.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="sv">How bad</label><select id="sv" name="severity" defaultValue=""><option value="" disabled>Choose</option>{DAMP_SEVERITY.map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="rm">Rooms affected</label><input id="rm" name="rooms" placeholder="e.g. Bathroom ceiling, back bedroom window wall" /></div>
          <div className="field"><label htmlFor="fi">What was found</label><textarea id="fi" name="findings" rows={3} placeholder="e.g. Extractor fan not working, black mould 1m² on ceiling, moisture readings high near window" /></div>
          <div className="field"><label htmlFor="wn">Is repair work needed?</label><select id="wn" name="work_needed" defaultValue=""><option value="" disabled>Choose</option><option value="yes">Yes</option><option value="no">No (for example condensation, advice given instead)</option></select></div>
          <div className="field"><label htmlFor="wp">Work to be done</label><input id="wp" name="work_planned" placeholder="e.g. Replace extractor, mould wash, stain-block and repaint ceiling" /><span className="hint">Fix the cause, not just the mould. Leave blank only if no work is needed.</span></div>
          <div className="field"><label htmlFor="ad">Advice for the tenant (optional)</label><input id="ad" name="advice" placeholder="e.g. Keep the extractor on while showering, open the trickle vents" /></div>
          {[1, 2, 3].map((k) => <FileField key={k} label={'Investigation photo ' + k + ' (optional)'} agencyId={agencyId} propertyId={r.property_id} prefix={'inv' + k} />)}
          <button className="btn">Save investigation</button>
        </ActionForm>)}

      {staff && !closed && nx && nx.key === 'summary' && (
        <ActionForm className="stack" action={dampSummarySent.bind(null, r.id)}>
          <b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>Send the written summary, by {fmt(nx.due)}</b>
          <span className="muted small">Email it, or print it and hand or post it, then record it here.</span>
          <EmailButton to={who.tenantEmails} cc={who.landlordEmails} subject={summaryMail.subject} body={summaryMail.body} label="Email the summary" ccLabel="Also send a copy to the landlord (not needed once landlords can log in)" />
          <div className="grid2">
            <div className="field"><label htmlFor="so">Date sent</label><input id="so" name="sent_on" type="date" defaultValue={t} max={t} /></div>
            <div className="field"><label htmlFor="sm">How</label><select id="sm" name="method" defaultValue={who.tenantEmails.length ? "Email" : ""}><option value="" disabled>Choose</option>{DAMP_SUMMARY_METHODS.map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <FileField label="Copy of what was sent (optional)" agencyId={agencyId} propertyId={r.property_id} prefix="sumcopy" />
          <button className="btn">Summary sent</button>
        </ActionForm>)}

      {staff && !closed && nx && nx.key === 'start' && (
        <ActionForm className="stack" action={dampWorkStarted.bind(null, r.id)}>
          <b className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>Start the work, by {fmt(nx.due)}</b>
          <span className="muted small">Booking a contractor isn't enough: the work itself must start. Book below, then record the day work began. Marking the work done also records it.</span>
          <div className="grid2">
            <div className="field"><label htmlFor="ws">Date work started</label><input id="ws" name="started_on" type="date" defaultValue={t} max={t} /></div>
            <div className="field"><label htmlFor="wsn">Note (optional)</label><input id="wsn" name="note" placeholder="e.g. Contractor on site, extractor replaced" /></div>
          </div>
          <button className="btn ghost">Work has started</button>
        </ActionForm>)}

      {staff && !closed && D.done && r.dm_work_needed === false && (
        <form action={dampCloseNoWork.bind(null, r.id)}><button className="btn ghost" style={{ width: '100%' }}>Close: no repair work needed</button></form>)}

      {staff && !closed && nx && (
        <details className="more"><summary>Can't meet a deadline?</summary>
          <ActionForm className="stack" action={dampDelay.bind(null, r.id)}>
            <span className="muted small">Only for reasons beyond your control (for example no access, parts on order). You must tell the tenant why and when, and keep the damp down meanwhile.</span>
            <div className="grid2">
              <div className="field"><label htmlFor="ds">Which step</label><select id="ds" name="stage" defaultValue={nx.key}>{D.stages.filter((s) => s.open).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
              <div className="field"><label htmlFor="db">Now expected by</label><input id="db" name="expected_by" type="date" min={t} /></div>
            </div>
            <div className="field"><label htmlFor="dr">Reason (beyond our control)</label><input id="dr" name="reason" placeholder="e.g. tenant unable to give access until 3 November" /></div>
            <div className="field"><label htmlFor="dm">What we're doing meanwhile to reduce the damp or mould</label><input id="dm" name="mitigation" placeholder="e.g. dehumidifier supplied, mould wash done" /></div>
            <div className="grid2">
              <div className="field"><label htmlFor="dso">Tenant told on</label><input id="dso" name="sent_on" type="date" defaultValue={t} max={t} /></div>
              <div className="field"><label htmlFor="dmm">How</label><select id="dmm" name="method" defaultValue=""><option value="" disabled>Choose</option>{DAMP_SUMMARY_METHODS.map((x) => <option key={x}>{x}</option>)}</select></div>
            </div>
            <button className="btn ghost small">Record delay notice</button>
            <span className="muted small">After saving, print the notice from the link that appears under the steps.</span>
          </ActionForm>
        </details>)}
      {delayMail && staff && !closed && (<div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <b className="small">Latest delay notice</b>
        <EmailButton to={who.tenantEmails} cc={who.landlordEmails} subject={delayMail.subject} body={delayMail.body} label="Email the delay notice" ccLabel="Also send a copy to the landlord" />
        <Link href={`/repairs/${r.id}/damp-summary?delay=1`} className="small">Or print the delay notice</Link></div>)}
    </div>
  );
}
