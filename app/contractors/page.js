import Topbar from '../topbar';
import ActionForm from '@/components/ActionForm';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { TRADES, daysUntil, fmt, money } from '@/lib/rules';
import { addContractor } from '../repairs/actions';

const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

export default async function Contractors({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const { data: list } = await sb.from('contractors').select('id, trades, availability, areas, insurance_expires, hourly_rate_pence, gas_safe_number, niceic_number, status, contacts(full_name, phone, email)').order('created_at', { ascending: false });

  return (
    <>
      <Topbar here="/contractors" />
      <div className="pagehead"><h1>Trades</h1><span className="sub">The contractors you call for repairs. Only approved contractors with in-date insurance are offered on a repair.</span></div>
      {sp.saved && <div className="note" role="status">Contractor added</div>}

      {(list || []).map((c) => {
        const d = daysUntil(c.insurance_expires);
        const ins = !c.insurance_expires ? ['due', 'Insurance date not recorded'] : d < 0 ? ['bad', 'Insurance expired ' + fmt(c.insurance_expires)] : d <= 30 ? ['due', 'Insurance ends ' + fmt(c.insurance_expires)] : ['ok', 'Insured to ' + fmt(c.insurance_expires)];
        return (
          <div key={c.id} className="card">
            <div className="row"><b>{c.contacts.full_name}</b><span className={'pill ' + ins[0]}>{ins[1]}</span></div>
            <span className="small">{c.trades.join(', ')} · {c.availability === '24h' ? '24 hours' : 'office hours'}{c.hourly_rate_pence ? ' · ' + money(c.hourly_rate_pence) + ' an hour' : ''}{c.areas ? ' · ' + c.areas : ''}</span>
            <span className="muted small">{[c.contacts.phone, c.contacts.email].filter(Boolean).join(' · ') || 'No contact details'}{c.gas_safe_number ? ' · Gas Safe ' + c.gas_safe_number : ''}{c.niceic_number ? ' · NICEIC ' + c.niceic_number : ''}</span>
          </div>);
      })}
      {!(list || []).length && <div className="card"><span className="muted">No contractors yet. Add your first one below.</span></div>}

      {staff && (
        <details className="card" open={!(list || []).length}>
          <summary><b>Add a contractor</b></summary>
          <ActionForm className="stack" action={addContractor}>
            <div className="field"><label htmlFor="cn">Business or person's name</label><input id="cn" name="name" required /></div>
            <div style={two}><div className="field"><label htmlFor="cp">Phone</label><input id="cp" name="phone" type="tel" /></div>
              <div className="field"><label htmlFor="ce">Email</label><input id="ce" name="email" type="email" /></div></div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Trades they do</legend>
              <div style={two}>{TRADES.map((t) => <label key={t} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name={'trade_' + t} /> {t}</label>)}</div></fieldset>
            <div style={two}><div className="field"><label htmlFor="ca">Available</label><select id="ca" name="availability"><option value="office">Office hours</option><option value="24h">24 hours (emergencies)</option></select></div>
              <div className="field"><label htmlFor="cr">Hourly rate (£, optional)</label><input id="cr" name="rate" inputMode="decimal" /></div></div>
            <div style={two}><div className="field"><label htmlFor="ci">Insurance in date until</label><input id="ci" name="insurance_expires" type="date" /></div>
              <div className="field"><label htmlFor="car">Areas covered</label><input id="car" name="areas" placeholder="e.g. Glasgow, Paisley" /></div></div>
            <div style={two}><div className="field"><label htmlFor="cg">Gas Safe number (gas work)</label><input id="cg" name="gas_safe_number" /></div>
              <div className="field"><label htmlFor="cni">NICEIC or similar (electrics)</label><input id="cni" name="niceic_number" /></div></div>
            <button className="btn">Add contractor</button>
          </ActionForm>
        </details>
      )}
    </>
  );
}
