import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property';
import FileField from '@/components/FileField';
import ActionForm from '@/components/ActionForm';
import { DEPOSIT_SCHEMES, PI_ITEMS, PI_METHODS, depositStatus, prescribedInfo, money } from '@/lib/rules';
import { saveDeposit } from '../actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const tick = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontWeight: 500 };

export default async function Deposit({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect(`/properties/${id}`);
  const data = await loadProperty(sb, id); if (!data) notFound();
  const { p, tenancy: t } = data;
  if (!t) redirect(`/properties/${id}/tenancy`);
  const ds = depositStatus(t), pi = prescribedInfo(t), items = t.pi_items || {};
  return (
    <>
      <Link href={`/properties/${id}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>‹ {p.address_line1}</Link>
      <div className="pagehead"><h1>Deposit {money(t.deposit_pence)}</h1><span className="sub">Must be protected within 30 working days of the tenancy starting, and the prescribed information given within 30 working days of lodging.</span></div>
            {ds && <div className="row card"><span className="small">Protection</span><span className={'pill ' + ds.cls}>{ds.text}</span></div>}
      <ActionForm className="stack" action={saveDeposit.bind(null, id)}>
        <input type="hidden" name="tenancy_id" value={t.id} />
        <div className="card"><h3>Protection</h3>
          <div style={two}><div className="field"><label htmlFor="rc">Received on</label><input id="rc" name="deposit_received_on" type="date" defaultValue={t.deposit_received_on || t.start_date} /></div>
            <div className="field"><label htmlFor="lo">Lodged with scheme on</label><input id="lo" name="deposit_lodged_on" type="date" defaultValue={t.deposit_lodged_on || ''} /></div></div>
          <div className="field"><label htmlFor="sc">Scheme</label><select id="sc" name="deposit_scheme" defaultValue={t.deposit_scheme || ''}><option value="">Not chosen yet</option>{DEPOSIT_SCHEMES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="rf">Scheme reference</label><input id="rf" name="deposit_reference" defaultValue={t.deposit_reference || ''} /></div>
        </div>
        <div className="card"><h3>Prescribed information</h3>
          {pi && <div className="row"><span className="small">Status</span><span className={'pill ' + pi.cls}>{pi.text}</span></div>}
          <div style={two}><div className="field"><label htmlFor="pg">Date given to tenant</label><input id="pg" name="pi_given_on" type="date" defaultValue={t.pi_given_on || ''} /></div>
            <div className="field"><label htmlFor="pm">How it was given</label><select id="pm" name="pi_method" defaultValue={t.pi_method || ''}><option value="">Choose…</option>{PI_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div></div>
          <span className="muted small">Tick each item the information included (reg 42):</span>
          {PI_ITEMS.map(([k, l]) => <label key={k} style={tick}><span>{l}</span><input type="checkbox" name={'pi_' + k} defaultChecked={!!items[k]} style={{ width: 24, height: 24, flexShrink: 0 }} /></label>)}
          <FileField label={t.pi_document_id ? 'Replace the copy of what was sent' : 'Copy of what was sent (PDF, screenshot or photo)'} agencyId={member.agency_id} propertyId={id} prefix="pi" />
        </div>
        <button className="btn">Save deposit</button>
        <span className="muted small">Working days skip weekends and bank holidays in every part of the UK. Check deadlines yourself before relying on them.</span>
      </ActionForm>
    </>
  );
}
