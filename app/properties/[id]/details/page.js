import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property';
import FileField from '@/components/FileField';
import { saveDetails } from '../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const tick = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontWeight: 500 };

export default async function Details({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect(`/properties/${id}`);
  const data = await loadProperty(sb, id); if (!data) notFound();
  const { p, owners } = data; const L = (owners[0] && owners[0].landlords) || {}; const c = L.contacts || {};
  return (
    <>
      <Link href={`/properties/${id}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ {p.address_line1}</Link>
      <div className="pagehead"><h1>Property and landlord</h1></div>
      {sp.error && <div className="error" role="alert">{sp.error}</div>}
      <form className="stack" action={saveDetails.bind(null, id)}>
        <div className="card"><h3>The property</h3>
          <div className="field"><label htmlFor="a1">Address line 1</label><input id="a1" name="address_line1" required defaultValue={p.address_line1} /></div>
          <div className="field"><label htmlFor="a2">Address line 2</label><input id="a2" name="address_line2" defaultValue={p.address_line2 || ''} /></div>
          <div style={two}><div className="field"><label htmlFor="town">Town</label><input id="town" name="town" defaultValue={p.town || ''} /></div>
            <div className="field"><label htmlFor="pc">Postcode</label><input id="pc" name="postcode" required defaultValue={p.postcode} /></div></div>
          <div style={two}><div className="field"><label htmlFor="ty">Type</label><select id="ty" name="property_type" defaultValue={p.property_type}>{['Flat', 'House', 'HMO', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="bd">Bedrooms</label><input id="bd" name="bedrooms" type="number" min="0" max="30" defaultValue={p.bedrooms ?? ''} /></div></div>
          <div className="field"><label htmlFor="keys">Keys received and where they are kept</label><input id="keys" name="keys_location" placeholder="e.g. 2 sets, office safe tag 07" defaultValue={p.keys_location || ''} /></div>
          <span className="muted small">Never record alarm or key safe codes here.</span>
          <div style={two}><div className="field"><label htmlFor="hn">HMO licence number (HMOs only)</label><input id="hn" name="hmo_licence_number" defaultValue={p.hmo_licence_number || ''} /></div>
            <div className="field"><label htmlFor="he">HMO licence expires</label><input id="he" name="hmo_licence_expires" type="date" defaultValue={p.hmo_licence_expires || ''} /></div></div>
          <div style={two}><div className="field"><label htmlFor="ins">Buildings insurer</label><input id="ins" name="insurer" defaultValue={p.insurer || ''} /></div>
            <div className="field"><label htmlFor="ie">Insurance expires</label><input id="ie" name="insurance_expires" type="date" defaultValue={p.insurance_expires || ''} /></div></div>
        </div>
        <div className="card"><h3>Landlord and agreement</h3>
          <input type="hidden" name="landlord_id" value={L.id || ''} />
          <div className="field"><label htmlFor="ln">Name</label><input id="ln" name="landlord_name" defaultValue={c.full_name || ''} /></div>
          <div style={two}><div className="field"><label htmlFor="le">Email</label><input id="le" name="landlord_email" type="email" defaultValue={c.email || ''} /></div>
            <div className="field"><label htmlFor="lp">Phone</label><input id="lp" name="landlord_phone" type="tel" defaultValue={c.phone || ''} /></div></div>
          <div className="field"><label htmlFor="la">Postal address</label><input id="la" name="landlord_address" defaultValue={c.postal_address || ''} /></div>
          <div style={two}><div className="field"><label htmlFor="rn">Landlord registration number</label><input id="rn" name="registration_number" defaultValue={L.registration_number || ''} /></div>
            <div className="field"><label htmlFor="re">Registration expires</label><input id="re" name="registration_expires" type="date" defaultValue={L.registration_expires || ''} /></div></div>
          <div style={two}><div className="field"><label htmlFor="pk">Package</label><select id="pk" name="package" defaultValue={L.package || 'standard'}><option value="compact">Compact · £50 a month</option><option value="standard">Standard · £65 a month</option></select></div>
            <div className="field"><label htmlFor="al">Spend limit without asking (£)</label><input id="al" name="approval_limit" inputMode="decimal" defaultValue={L.approval_limit_pence != null ? (L.approval_limit_pence / 100).toFixed(0) : '250'} /></div></div>
          <div className="field"><label htmlFor="as">Management agreement signed on</label><input id="as" name="agreement_signed_on" type="date" defaultValue={L.agreement_signed_on || ''} /></div>
          <FileField label={L.agreement_document_id ? 'Replace the signed agreement copy' : 'Copy of the signed agreement'} agencyId={member.agency_id} propertyId={id} prefix="agreement" />
          <label style={tick}><span>Landlord bank details received for payouts (kept outside this app)</span><input type="checkbox" name="bank_details_received" defaultChecked={!!L.bank_details_received} style={{ width: 24, height: 24 }} /></label>
          <label style={tick}><span>Landlord identity and ownership checked</span><input type="checkbox" name="identity_checked" defaultChecked={!!L.identity_checked} style={{ width: 24, height: 24 }} /></label>
        </div>
        <button className="btn">Save</button>
      </form>
    </>
  );
}
