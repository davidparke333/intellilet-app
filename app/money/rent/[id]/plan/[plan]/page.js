import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { loadArrears } from '@/lib/arrearsData';
import { fmt, money, todayISO } from '@/lib/rules';

// The payment plan for the tenant to keep and sign (or a refusal letter if we can't accept their proposal)
export default async function Plan({ params }) {
  const { id, plan } = await params;
  const { sb, user, member } = await currentMember();
  const X = await loadArrears(sb, id);
  const P = X && X.plans.find((p) => p.id === plan);
  if (!X || !P) notFound();
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'Your letting agent';
  const n = Math.ceil(P.arrears_pence / Math.max(1, P.instalment_pence));
  const refused = P.status === 'tenant proposal rejected';
  return (<>
    <div className="row noprint"><Link href={'/money/rent/' + id} className="btn ghost small">‹ Back</Link><PrintButton label="Print" /></div>
    <div className="sheet">
      <div className="row" style={{ alignItems: 'flex-start' }}><b style={{ fontSize: 18 }}>{agency}</b><span>{fmt(todayISO())}</span></div>
      <div><b>To:</b> {X.tenants.map((x) => x.full_name).join(' and ') || 'The tenant'}<br />{X.address.map((l) => <span key={l}>{l}<br /></span>)}</div>
      <h1 style={{ fontSize: 20 }}>{refused ? 'Your proposed payment plan' : 'Rent arrears payment plan'}</h1>
      {refused ? (<>
        <p>Thank you for your proposal to pay {money(P.instalment_pence)} {P.frequency} towards the arrears of {money(P.arrears_pence)}.</p>
        <div className="box"><b>Why we can't accept it</b><p style={{ margin: '6px 0 0' }}>{P.rejection_reason}</p></div>
        <p>We still want to agree a plan with you. Please contact us at {user.email} to discuss an amount that works for you and clears the arrears in a reasonable time.</p>
      </>) : (<>
        <div className="box"><dl>
          <dt>Arrears covered</dt><dd>{money(P.arrears_pence)}</dd>
          <dt>Instalment</dt><dd>{money(P.instalment_pence)} {P.frequency}{P.with_rent ? ', on top of your normal rent of ' + money(X.t.rent_pence) + ' a month' : ''}</dd>
          <dt>First instalment</dt><dd>{fmt(P.first_due)}</dd>
          <dt>Number of instalments</dt><dd>About {n} (the last may be smaller)</dd>
        </dl></div>
        <p>If you can't keep to this plan, please contact us straight away so we can look at it again. If payments stop without contact, we may need to discuss the next steps with your landlord.</p>
        <p>Free advice: Citizens Advice Scotland (www.cas.org.uk), Shelter Scotland (scotland.shelter.org.uk), or your council's welfare rights service.</p>
        <div className="box"><b>Please confirm</b><p style={{ margin: '6px 0 0' }}>I understand and agree to this payment plan.</p>
          <div className="sign"><div>Signed</div><div>Date</div></div></div>
        <span className="small">Please return a signed copy, or reply to our email to confirm.</span>
      </>)}
      <p>Yours sincerely,<br /><br />{agency}</p>
    </div></>);
}
