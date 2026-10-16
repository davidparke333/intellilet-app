import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';

async function addProperty(formData) {
  'use server';
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  const g = (k) => String(formData.get(k) || '').trim();
  const agency_id = member.agency_id;
  const beds = g('bedrooms') === '' ? null : Math.max(0, Math.min(30, parseInt(g('bedrooms'), 10) || 0));
  const { data: prop, error } = await sb.from('properties').insert({
    agency_id, address_line1: g('address_line1'), address_line2: g('address_line2') || null, town: g('town') || null,
    postcode: g('postcode').toUpperCase(), property_type: g('property_type') || 'Flat', bedrooms: beds
  }).select('id').single();
  if (error) redirect('/properties/new?error=' + encodeURIComponent(error.message));
  // Optional: the landlord, as a contact + landlord record linked to the property
  if (g('landlord_name')) {
    const { data: c } = await sb.from('contacts').insert({ agency_id, full_name: g('landlord_name'), email: g('landlord_email') || null, phone: g('landlord_phone') || null }).select('id').single();
    if (c) {
      const { data: l } = await sb.from('landlords').insert({ agency_id, contact_id: c.id, registration_number: g('landlord_reg') || null }).select('id').single();
      if (l) await sb.from('property_owners').insert({ agency_id, property_id: prop.id, landlord_id: l.id });
    }
  }
  redirect('/properties/' + prop.id);
}

export default async function NewProperty({ searchParams }) {
  const sp = await searchParams;
  const { member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  return (
    <>
      <Link href="/" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Homes</Link>
      <div className="pagehead"><h1>Add a property</h1><span className="sub">You can add the tenancy, certificates and deposit next.</span></div>
      {sp.error && <div className="error">Not saved: {sp.error}</div>}
      <form className="card" action={addProperty}>
        <h3>The property</h3>
        <div className="field"><label htmlFor="a1">Address line 1</label><input id="a1" name="address_line1" required placeholder="e.g. Flat 2, 14 High Street" /></div>
        <div className="field"><label htmlFor="a2">Address line 2 (optional)</label><input id="a2" name="address_line2" /></div>
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label htmlFor="town">Town</label><input id="town" name="town" placeholder="Grangemouth" /></div>
          <div className="field"><label htmlFor="pc">Postcode</label><input id="pc" name="postcode" required placeholder="FK3 8AA" /></div>
        </div>
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label htmlFor="type">Type</label><select id="type" name="property_type">{['Flat', 'House', 'HMO', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="beds">Bedrooms</label><input id="beds" name="bedrooms" type="number" min="0" max="30" inputMode="numeric" /></div>
        </div>
        <h3 style={{ marginTop: 8 }}>Landlord (optional)</h3>
        <div className="field"><label htmlFor="ln">Name</label><input id="ln" name="landlord_name" /></div>
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label htmlFor="le">Email</label><input id="le" name="landlord_email" type="email" /></div>
          <div className="field"><label htmlFor="lp">Phone</label><input id="lp" name="landlord_phone" type="tel" /></div>
        </div>
        <div className="field"><label htmlFor="lr">Landlord registration number</label><input id="lr" name="landlord_reg" /></div>
        <button className="btn">Save property</button>
      </form>
    </>
  );
}
