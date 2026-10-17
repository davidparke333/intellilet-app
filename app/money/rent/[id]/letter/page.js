import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { loadArrears } from '@/lib/arrearsData';
import { fmt, money, todayISO } from '@/lib/rules';

// The formal arrears letter, with everything the pre-action requirements ask for
export default async function Letter({ params }) {
  const { id } = await params;
  const { sb, user, member } = await currentMember();
  const X = await loadArrears(sb, id);
  if (!X) notFound();
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'Your letting agent';
  return (<>
    <div className="row noprint"><Link href={'/money/rent/' + id} className="btn ghost small">‹ Back</Link><PrintButton label="Print letter" /></div>
    <div className="sheet">
      <div className="row" style={{ alignItems: 'flex-start' }}><div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 18 }}>{agency}</b><span className="small">On behalf of your landlord{X.L ? ', ' + X.L.contacts.full_name : ''}</span></div><span>{fmt(todayISO())}</span></div>
      <div><b>To:</b> {X.tenants.map((x) => x.full_name).join(' and ') || 'The tenant'}<br />{X.address.map((l) => <span key={l}>{l}<br /></span>)}</div>
      <h1 style={{ fontSize: 20 }}>Rent arrears at {X.p.address_line1}</h1>
      <p>Our records show rent arrears of <b>{money(X.A.arrears)}</b> on your tenancy{X.since ? ', unpaid since ' + fmt(X.since.since) : ''}.</p>
      <div className="box"><b>Your rent</b><p style={{ margin: '6px 0 0' }}>Your tenancy agreement says the rent is {money(X.t.rent_pence)} a month, due on day {X.t.rent_due_day} of each month.</p></div>
      <div className="box"><b>How the arrears are made up</b>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 6 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}><th>Rent due</th><th style={{ textAlign: 'right' }}>Due</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Unpaid</th><th style={{ textAlign: 'right' }}>Running total</th></tr></thead>
          <tbody>{X.breakdown.map((b) => <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}><td>{fmt(b.due_on)}</td><td style={{ textAlign: 'right' }}>{money(b.amount_pence)}</td><td style={{ textAlign: 'right' }}>{money(b.paid)}</td><td style={{ textAlign: 'right' }}>{money(b.owed)}</td><td style={{ textAlign: 'right' }}>{money(b.running)}</td></tr>)}
            <tr><td colSpan={4}><b>Total unpaid</b></td><td style={{ textAlign: 'right' }}><b>{money(X.A.arrears)}</b></td></tr></tbody></table></div>
      <div className="box"><b>Let's agree a plan</b><p style={{ margin: '6px 0 0' }}>We would like to agree a reasonable plan with you to pay back the arrears alongside your normal rent. Please contact us within 14 days at {user.email} so we can discuss what you can afford. If your circumstances have changed, or you have applied for benefits such as Universal Credit or a Discretionary Housing Payment from your council, please tell us and we will take this into account.</p></div>
      <div className="box"><b>Free, confidential advice</b><p style={{ margin: '6px 0 0' }}>Citizens Advice Scotland: www.cas.org.uk · Shelter Scotland: scotland.shelter.org.uk · your local council's housing and welfare rights service. If you are getting debt advice, please let us know.</p></div>
      <div className="box"><b>What happens if the arrears are not dealt with</b><p style={{ margin: '6px 0 0' }}>A private residential tenancy can only be ended by an order of the First-tier Tribunal for Scotland (Housing and Property Chamber). If the arrears continue for three months or more in a row, your landlord may consider giving you a notice to leave and applying to the Tribunal. The Tribunal will consider whether it is reasonable to make an order, and you would have the chance to take part. Eviction is a last resort: we would much rather agree a way forward with you.</p></div>
      <p>Yours sincerely,<br /><br />{agency}</p>
    </div></>);
}
