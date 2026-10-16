import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import FileField from '@/components/FileField';
import { CATS, PRIORITY, SOURCES } from '@/lib/rules';
import { logRepair } from '../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
export default async function NewRepair({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  const { data: props } = await sb.from('properties').select('id, address_line1, postcode').is('archived_at', null).order('address_line1');
  return (
    <>
      <Link href="/repairs" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Repairs</Link>
      <div className="pagehead"><h1>Log a repair</h1></div>
      <ActionForm className="card" action={logRepair}>
        <div className="field"><label htmlFor="pp">Property</label><select id="pp" name="property_id" defaultValue={sp.p || ''} required><option value="">Choose…</option>{(props || []).map((p) => <option key={p.id} value={p.id}>{p.address_line1}, {p.postcode}</option>)}</select></div>
        <div style={two}><div className="field"><label htmlFor="ct">Type</label><select id="ct" name="category">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="pr">Priority</label><select id="pr" name="priority" defaultValue="routine">{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label} · {p.days} day{p.days > 1 ? 's' : ''}</option>)}</select></div></div>
        <div className="field"><label htmlFor="ds">What is the problem?</label><textarea id="ds" name="description" rows={3} required placeholder="e.g. No hot water since Monday, boiler shows fault F28" /></div>
        <div style={two}><div className="field"><label htmlFor="so">Reported by</label><select id="so" name="source">{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="bt">Best times for access</label><input id="bt" name="best_times" placeholder="e.g. after 3pm" /></div></div>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}><span>OK to use our key if the tenant is out</span><input type="checkbox" name="access_with_key" style={{ width: 24, height: 24 }} /></label>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}><span>Damp or mould (logs it and makes it urgent)</span><input type="checkbox" name="is_damp" style={{ width: 24, height: 24 }} /></label>
        {[1, 2, 3].map((n) => <FileField key={n} label={'Photo of the fault ' + n + ' (optional)'} agencyId={member.agency_id} propertyId={sp.p || 'repairs'} prefix={'photo' + n} />)}
        <button className="btn">Log repair</button>
      </ActionForm>
    </>
  );
}
