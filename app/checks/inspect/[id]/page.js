import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import InspectionChecks from '@/components/InspectionChecks';
import { CHECKS, CHECK_REPAIR, todayISO } from '@/lib/rules';
import { saveInspection } from '../../actions';

export default async function Inspect({ params }) {
  const { id } = await params;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  const { data: p } = await sb.from('properties').select('id, address_line1, postcode').eq('id', id).maybeSingle();
  if (!p) notFound();
  const { data: open } = await sb.from('repairs').select('id, category, description').eq('property_id', id).in('status', ['reported', 'assigned', 'invoiced']);
  const repairFor = Object.fromEntries(Object.entries(CHECK_REPAIR).map(([k, v]) => [k, v[0]]));
  return (
    <>
      <Link href={'/properties/' + id} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Back to property</Link>
      <div className="pagehead"><h1>Inspection</h1><span className="sub">{p.address_line1}, {p.postcode} · Repairing Standard A–J</span></div>
      <ActionForm className="stack" action={saveInspection.bind(null, id)}>
        <div className="card"><div className="field"><label htmlFor="d">Date of inspection</label><input id="d" name="inspected_on" type="date" defaultValue={todayISO()} max={todayISO()} required /></div></div>
        <InspectionChecks checks={CHECKS} repairFor={repairFor} openRepairs={open || []} agencyId={member.agency_id} propertyId={id}>
          <div className="card"><div className="field"><label htmlFor="nt">Notes for the landlord</label><textarea id="nt" name="notes" rows={3} placeholder="Overall condition, anything to keep an eye on" /></div></div>
        </InspectionChecks>
      </ActionForm>
    </>
  );
}
