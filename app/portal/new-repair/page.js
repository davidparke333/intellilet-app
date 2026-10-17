import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import FileField from '@/components/FileField';
import { CATS, URGENCY } from '@/lib/rules';
import { tenantReport } from '../actions';

export default async function NewRepair() {
  const { sb, member } = await currentMember();
  if (!member || member.role !== 'tenant') redirect('/portal');
  const { data: t } = await sb.from('tenancies').select('property_id').in('id', ((await sb.from('tenancy_people').select('tenancy_id').eq('contact_id', member.contact_id)).data || []).map((x) => x.tenancy_id).concat('00000000-0000-0000-0000-000000000000')).in('status', ['active', 'pending']).limit(1).maybeSingle();
  return (<>
    <Link href="/portal" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Back</Link>
    <div className="pagehead"><h1>Report a repair</h1><span className="sub">If anyone is in danger, or there's a gas smell, leave the property and call 999 or the gas emergency line (0800 111 999) first.</span></div>
    <ActionForm className="card" action={tenantReport}>
      <div className="field"><label htmlFor="ct">What kind of problem?</label><select id="ct" name="category">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="field"><label htmlFor="ds">What's wrong?</label><textarea id="ds" name="description" rows={4} placeholder="e.g. No hot water since Monday. The boiler shows F28" /></div>
      <div className="field"><label htmlFor="pr">How urgent is it?</label><select id="pr" name="priority" defaultValue="routine">{URGENCY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <label className="check"><input type="checkbox" name="is_damp" />There is damp or mould</label>
      <div className="field"><label htmlFor="bt">Best times for a visit</label><input id="bt" name="best_times" placeholder="e.g. weekdays after 3pm" /></div>
      <label className="check"><input type="checkbox" name="access_with_key" />OK to use the agency's key if I'm out</label>
      {t && [1, 2, 3].map((n) => <FileField key={n} label={'Photo ' + n + ' (optional)'} agencyId={member.agency_id} propertyId={t.property_id} prefix={'photo' + n} />)}
      <button className="btn">Send report</button>
    </ActionForm>
  </>);
}
