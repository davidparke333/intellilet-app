import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property';
import FileField from '@/components/FileField';
import ActionForm from '@/components/ActionForm';
import { certByKey, todayISO } from '@/lib/rules';
import { recordCertificate } from '../../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

export default async function Certificate({ params, searchParams }) {
  const { id, kind } = await params; const sp = await searchParams;
  const c = certByKey(kind); if (!c) notFound();
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect(`/properties/${id}`);
  const data = await loadProperty(sb, id); if (!data) notFound();
  return (
    <>
      <Link href={`/properties/${id}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ {data.p.address_line1}</Link>
      <div className="pagehead"><h1>Record {c.label}</h1><span className="sub">{c.rule}</span></div>
            <ActionForm className="card" action={recordCertificate.bind(null, id, kind)}>
        <div style={two}><div className="field"><label htmlFor="ck">Date of check</label><input id="ck" name="checked_on" type="date" required max={todayISO()} defaultValue={todayISO()} /></div>
          <div className="field"><label htmlFor="ex">Expiry (blank = {c.years} year{c.years > 1 ? 's' : ''})</label><input id="ex" name="expires_on" type="date" /></div></div>
        <div style={two}><div className="field"><label htmlFor="rs">{kind === 'epc' ? 'Rating' : 'Result'}</label><select id="rs" name="result">{c.results.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="field"><label htmlFor="by">Carried out by</label><input id="by" name="carried_out_by" defaultValue="In-house engineer" /></div></div>
        <div className="field"><label htmlFor="no">Certificate number</label><input id="no" name="certificate_no" /></div>
        <FileField label="Certificate file (PDF or photo)" agencyId={member.agency_id} propertyId={id} prefix="cert" />
        {kind !== 'epc' && <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}><span>If it fails, raise an urgent repair</span><input type="checkbox" name="raise_repair" defaultChecked style={{ width: 24, height: 24 }} /></label>}
        <button className="btn">Save certificate</button>
        <span className="muted small">The previous {c.label} stays in the history. A failed result stays red until a passing one is recorded.</span>
      </ActionForm>
    </>
  );
}
