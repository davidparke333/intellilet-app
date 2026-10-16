import Topbar from '../topbar';
import ActionForm from '@/components/ActionForm';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { TRADES, daysUntil, fmt, money } from '@/lib/rules';
import { addContractor } from '../repairs/actions';


export default async function Contractors({ searchParams }) {
  const sp = await searchParams;
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const { data: list } = await sb.from('contractors').select('*, contacts(full_name, phone, email)').order('created_at', { ascending: false });

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
            <span className="small">{c.trades.join(', ')} · {c.availability === '24h' ? '24 hours' : 'office hours'}{c.hourly_rate_pence ? ' · ' + money(c.hourly_rate_pence) + ' an hour' : ''}{c.vat_registered ? ' · VAT registered' : ''}{c.areas ? ' · ' + c.areas : ''}</span>
            <span className="muted small">{[c.contacts.phone, c.contacts.email].filter(Boolean).join(' · ') || 'No contact details'}{c.gas_safe_number ? ' · Gas Safe ' + c.gas_safe_number : ''}{c.niceic_number ? ' · NICEIC ' + c.niceic_number : ''}</span>
          </div>);
      })}
      {!(list || []).length && <div className="card"><span className="muted">No contractors yet. Add your first one below.</span></div>}

      {staff && (
        <details className="card" open={!(list || []).length}>
          <summary><b>Add a contractor</b></summary>
          <ActionForm className="stack" action={addContractor}>
            <div className="formsection" style={{ borderTop: 0, paddingTop: 8 }}><h4>Who they are</h4>
              <div className="field"><label htmlFor="cn">Business or person's name</label><input id="cn" name="name" required /></div>
              <div className="grid2">
                <div className="field"><label htmlFor="cp">Phone</label><input id="cp" name="phone" type="tel" /></div>
                <div className="field"><label htmlFor="ce">Email</label><input id="ce" name="email" type="email" /></div>
              </div>
              <div className="field"><label htmlFor="car">Areas covered</label><input id="car" name="areas" placeholder="e.g. Falkirk, Grangemouth, Stirling" /></div>
            </div>

            <div className="formsection"><h4>Trades they do</h4>
              <div className="checks">{TRADES.map((t) => <label key={t} className="check"><input type="checkbox" name={'trade_' + t} />{t}</label>)}</div>
            </div>

            <div className="formsection"><h4>Rates and availability</h4>
              <div className="grid2">
                <div className="field"><label htmlFor="ca">Available</label><select id="ca" name="availability"><option value="office">Office hours</option><option value="24h">24 hours (emergencies)</option></select></div>
                <div className="field"><label htmlFor="cr">Hourly rate (£)</label><input id="cr" name="rate" inputMode="decimal" placeholder="Optional" /></div>
              </div>
              <label className="check"><input type="checkbox" name="vat_registered" />VAT registered (adds 20% VAT to their jobs)</label>
              <div className="field"><label htmlFor="cv">VAT number</label><input id="cv" name="vat_number" placeholder="Only if VAT registered, e.g. GB123456789" /></div>
            </div>

            <div className="formsection"><h4>Insurance and registration</h4>
              <div className="field"><label htmlFor="ci">Insurance in date until</label><input id="ci" name="insurance_expires" type="date" />
                <span className="hint">They're only offered on repairs while this date is in the future.</span></div>
              <div className="grid2">
                <div className="field"><label htmlFor="cg">Gas Safe number</label><input id="cg" name="gas_safe_number" placeholder="For gas work" /></div>
                <div className="field"><label htmlFor="cni">NICEIC / NAPIT number</label><input id="cni" name="niceic_number" placeholder="For electrics" /></div>
              </div>
            </div>
            <button className="btn">Add contractor</button>
          </ActionForm>
        </details>
      )}
    </>
  );
}
