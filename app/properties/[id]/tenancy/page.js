import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property';
import FileField from '@/components/FileField';
import { saveTenancy } from '../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const pounds = (p) => p != null ? (p / 100).toFixed(2) : '';

export default async function Tenancy({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect(`/properties/${id}`);
  const data = await loadProperty(sb, id); if (!data) notFound();
  const { p, tenancy: t, tenants } = data;
  const person = (n) => { const x = tenants[n - 1]; const c = (x && x.contacts) || {}; return (
    <div className="stack" style={{ gap: 8 }}><b className="small">{n === 1 ? 'Lead tenant' : 'Joint tenant (optional)'}</b>
      <input type="hidden" name={`t${n}_contact`} value={x ? x.contact_id : ''} />
      <div className="field"><label htmlFor={`t${n}n`}>Full name</label><input id={`t${n}n`} name={`t${n}_name`} required={n === 1} defaultValue={c.full_name || ''} /></div>
      <div style={two}><div className="field"><label htmlFor={`t${n}e`}>Email</label><input id={`t${n}e`} name={`t${n}_email`} type="email" defaultValue={c.email || ''} /></div>
        <div className="field"><label htmlFor={`t${n}p`}>Phone</label><input id={`t${n}p`} name={`t${n}_phone`} type="tel" defaultValue={c.phone || ''} /></div></div>
    </div>); };
  return (
    <>
      <Link href={`/properties/${id}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ {p.address_line1}</Link>
      <div className="pagehead"><h1>{t ? 'Tenancy' : 'Add a tenancy'}</h1><span className="sub">{p.address_line1}, {p.postcode}</span></div>
      {sp.error && <div className="error" role="alert">{sp.error}</div>}
      <form className="stack" action={saveTenancy.bind(null, id)}>
        <input type="hidden" name="tenancy_id" value={t ? t.id : ''} />
        <div className="card"><h3>Tenants</h3>{person(1)}{person(2)}</div>
        <div className="card"><h3>Terms</h3>
          <div style={two}><div className="field"><label htmlFor="sd">Tenancy start date</label><input id="sd" name="start_date" type="date" required defaultValue={t ? t.start_date : ''} /></div>
            <div className="field"><label htmlFor="rd">Rent due day of the month</label><input id="rd" name="rent_due_day" type="number" min="1" max="28" required defaultValue={t ? t.rent_due_day : 1} /></div></div>
          <div style={two}><div className="field"><label htmlFor="rent">Rent a month (£)</label><input id="rent" name="rent" inputMode="decimal" required defaultValue={t ? pounds(t.rent_pence) : ''} /></div>
            <div className="field"><label htmlFor="dep">Deposit (£, 0 if none)</label><input id="dep" name="deposit" inputMode="decimal" defaultValue={t ? pounds(t.deposit_pence) : ''} /></div></div>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}><span>Taking over an existing tenancy from another agent or landlord</span><input type="checkbox" name="taken_over" defaultChecked={!!(t && t.taken_over)} style={{ width: 24, height: 24 }} /></label>
          <div className="field"><label htmlFor="ah">Rent arrears at handover (£, 0 if none)</label><input id="ah" name="arrears_at_handover" inputMode="decimal" defaultValue={t ? pounds(t.arrears_at_handover_pence) : '0'} /></div>
          <FileField label={t && t.tenancy_document_id ? 'Replace the tenancy agreement copy' : 'Copy of the tenancy agreement'} agencyId={member.agency_id} propertyId={id} prefix="agreement" />
        </div>
        <button className="btn">Save tenancy</button>
        <span className="muted small">You can record the deposit and prescribed information after saving.</span>
      </form>
    </>
  );
}
