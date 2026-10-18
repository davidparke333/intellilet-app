import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import ActionForm from '@/components/ActionForm';
import ClientFields from './ClientFields';
import { addProperty, searchClients } from './actions';

export default async function NewProperty({ searchParams }) {
  const sp = await searchParams;
  const { member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  const initial = await searchClients('');
  return (
    <>
      <Link href="/" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ Homes</Link>
      <div className="pagehead"><h1>Add a property</h1><span className="sub">You can add the tenancy, certificates and deposit next.</span></div>
      {sp.error && <div className="error">Not saved: {sp.error}</div>}
      <ActionForm className="card" action={addProperty}>
        <h3>The property</h3>
        <div className="field"><label htmlFor="a1">Address line 1</label><input id="a1" name="address_line1" required placeholder="e.g. Flat 2, 14 High Street" /></div>
        <div className="field"><label htmlFor="a2">Address line 2 (optional)</label><input id="a2" name="address_line2" /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="town">Town</label><input id="town" name="town" placeholder="Grangemouth" /></div>
          <div className="field"><label htmlFor="pc">Postcode</label><input id="pc" name="postcode" required placeholder="FK3 8AA" /></div>
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="type">Type</label><select id="type" name="property_type">{['Flat', 'House', 'HMO', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="beds">Bedrooms</label><input id="beds" name="bedrooms" type="number" min="0" max="30" inputMode="numeric" /></div>
        </div>
        <ClientFields initial={initial} />
        <button className="btn">Save property</button>
      </ActionForm>
    </>
  );
}
