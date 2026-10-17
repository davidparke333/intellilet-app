import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { dampStages, fmt, todayISO } from '@/lib/rules';

// Letters to the tenant for damp and mould: the written summary of the investigation (s.14(7)),
// or with ?delay=1 the notice that a deadline can't be met (s.14(9)).
export default async function DampLetter({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, user, member } = await currentMember();
  const { data: r } = await sb.from('repairs').select('*, properties(address_line1, address_line2, town, postcode), tenancies(tenancy_people(is_lead, contacts(full_name)))').eq('id', id).maybeSingle();
  if (!r || !r.is_damp) notFound();
  const { data: ev } = await sb.from('repair_events').select('kind, detail, at').eq('repair_id', id).eq('kind', 'dm_delay').order('at');
  const D = dampStages(r, (ev || []).map((e) => e.detail));
  const p = r.properties, ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'Your letting agent';
  const tenants = ((r.tenancies && r.tenancies.tenancy_people) || []).map((x) => x.contacts.full_name).filter(Boolean);
  const addr = [p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean);
  const delay = sp.delay ? (ev || []).map((e) => e.detail).pop() : null;
  const start = D.stages.find((s) => s.key === 'start');
  const stageName = { investigate: 'investigation of the damp and mould', summary: 'written summary of our investigation', start: 'start of the repair work' };
  const ready = sp.delay ? !!delay : !!r.dm_investigated_on;

  return (
    <>
      <div className="row noprint"><Link href={'/repairs/' + id} className="btn ghost small">‹ Back to the repair</Link>{ready && <PrintButton label="Print letter" />}</div>
      {!ready && <div className="note">{sp.delay ? 'No delay notice has been recorded yet.' : 'Record the investigation first. The summary is written from it.'}</div>}
      {ready && (
        <div className="sheet">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 18 }}>{agency}</b><span className="small">On behalf of your landlord</span></div>
            <span>{fmt(todayISO())}</span>
          </div>
          <div><b>To:</b> {tenants.length ? tenants.join(' and ') : 'The tenant'}<br />{addr.map((l) => <span key={l}>{l}<br /></span>)}</div>
          <h1 style={{ fontSize: 20 }}>{delay ? 'Damp and mould: update on timescales' : 'Damp and mould: results of our investigation'}</h1>

          {delay ? (<>
            <p>We are writing about the damp and mould at your home, which we became aware of on {fmt(D.aware)}.</p>
            <p>We are sorry, but due to circumstances beyond our control we are unable to complete the <b>{stageName[delay.stage]}</b> within the time the law requires.</p>
            <div className="box"><b>Reason</b><p style={{ margin: '6px 0 0' }}>{delay.reason}</p></div>
            <div className="box"><b>When we now expect to do it</b><p style={{ margin: '6px 0 0' }}>By {fmt(delay.expected_by)}.</p></div>
            <div className="box"><b>What we are doing in the meantime</b><p style={{ margin: '6px 0 0' }}>{delay.mitigation}</p></div>
            <p>If the damp or mould gets worse, or you think it is affecting anyone's health, please contact us straight away.</p>
          </>) : (<>
            <p>Thank you for letting us know about damp and mould at your home. We became aware of it on {fmt(D.aware)}, and it was investigated on <b>{fmt(r.dm_investigated_on)}</b> by {r.dm_investigator}.</p>
            <div className="box"><b>What we found</b>
              <p style={{ margin: '6px 0 0' }}>{r.dm_findings}</p>
              {r.dm_rooms && <p style={{ margin: '6px 0 0' }}><b>Where:</b> {r.dm_rooms}</p>}
              <p style={{ margin: '6px 0 0' }}><b>Likely cause:</b> {r.dm_cause}</p></div>
            {r.dm_work_needed ? (
              <div className="box"><b>What we will do</b><p style={{ margin: '6px 0 0' }}>{r.dm_work_planned}</p>
                <p style={{ margin: '6px 0 0' }}>{start && start.doneOn ? 'This work started on ' + fmt(start.doneOn) + '.' : 'This work will start by ' + fmt(start.due) + '. We will contact you to arrange access.'}</p></div>
            ) : (
              <div className="box"><b>What happens next</b><p style={{ margin: '6px 0 0' }}>The investigation found that no repair work to the property is needed at this time.</p></div>)}
            {r.dm_tenant_advice && <div className="box"><b>Things that will help</b><p style={{ margin: '6px 0 0' }}>{r.dm_tenant_advice}</p></div>}
            <p>If the damp or mould comes back, gets worse, or you think it is affecting anyone's health, please contact us straight away and we will look at it again.</p>
          </>)}
          <p>If you have any questions, contact us at {user.email}.</p>
          <p>Yours sincerely,<br /><br />{agency}</p>
        </div>)}
    </>
  );
}
