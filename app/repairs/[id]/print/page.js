import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { PRIORITY, money } from '@/lib/rules';

// A works order (job sheet) for the contractor. It deliberately leaves out the landlord's details.
const day = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export default async function WorksOrder({ params }) {
  const { id } = await params;
  const { sb, user, member } = await currentMember();
  const { data: r } = await sb.from('repairs').select('*, properties(address_line1, address_line2, town, postcode, keys_location), tenancies(tenancy_people(is_lead, contacts(full_name, phone))), contractors(*, contacts(full_name, phone, email))').eq('id', id).maybeSingle();
  if (!r) notFound();
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'The agency';
  const ref = 'WO-' + id.slice(0, 8).toUpperCase();
  const p = r.properties, pr = PRIORITY[r.priority];
  const raised = new Date(r.reported_at), due = new Date(raised.getTime() + pr.days * 86400000);
  const lead = r.tenancies && (r.tenancies.tenancy_people || []).find((x) => x.is_lead);
  const c = r.contractors;

  return (
    <>
      <div className="row noprint"><Link href={'/repairs/' + id} className="btn ghost small">‹ Back to the repair</Link><PrintButton label="Print works order" /></div>
      {!c && <div className="note noprint">No contractor booked yet. You can still print this, but the "To" section will be blank.</div>}
      <div className="sheet">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 2 }}><h1>Works order</h1><span>{agency}</span></div>
          <dl><dt>Order no.</dt><dd><b>{ref}</b></dd><dt>Raised</dt><dd>{day(raised)}</dd><dt>Priority</dt><dd><b>{pr.label}</b>, attend by {day(due)}</dd></dl>
        </div>

        <div className="grid2">
          <div className="box"><b>To</b><br />{c ? <>{c.contacts.full_name}<br />{c.contacts.phone}{c.contacts.email ? <><br />{c.contacts.email}</> : null}</> : <>&nbsp;<br />&nbsp;</>}</div>
          <div className="box"><b>Property</b><br />{[p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean).map((l) => <span key={l}>{l}<br /></span>)}</div>
        </div>

        <div className="box"><b>Work required: {r.category}</b><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.description}</p>
          {r.is_damp && <p style={{ margin: '6px 0 0' }}>Damp and mould: please note the likely cause (for example a leak, ventilation or condensation) on your invoice.</p>}</div>

        <div className="box"><b>Access</b>
          <dl style={{ marginTop: 6 }}>
            <dt>Tenant</dt><dd>{lead ? lead.contacts.full_name + (lead.contacts.phone ? ', ' + lead.contacts.phone : '') : 'Vacant or not recorded. Contact us'}</dd>
            <dt>Best times</dt><dd>{r.best_times || 'Arrange with the tenant'}</dd>
            <dt>Keys</dt><dd>{r.access_with_key ? 'Tenant is happy for our key to be used if they are out. Collect it from us' : 'Tenant must be in. Do not use a key'}</dd>
          </dl></div>

        <div className="box"><b>Cost</b><p style={{ margin: '6px 0 0' }}>{r.spend_limit_pence
          ? <>Do not go over <b>{money(r.spend_limit_pence)}</b>{c && c.vat_registered ? ' plus VAT' : ''} without calling us for approval first.</>
          : 'Call us with a price before starting any work.'}</p>
          <p style={{ margin: '6px 0 0' }}>Invoice {agency}, quoting order no. <b>{ref}</b> and the property address. Include what you did, labour and parts separately{c && c.vat_registered ? ', and your VAT number' : ''}. Before and after photos help us pay you faster.</p></div>

        <span className="small">Questions about this job: {user.email}</span>
        <div className="sign"><div>Contractor signature and date</div><div>Tenant signature (work completed)</div></div>
      </div>
    </>
  );
}
