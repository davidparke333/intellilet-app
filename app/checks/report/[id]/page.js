import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { CHECKS, fmt, findingState } from '@/lib/rules';

// Inspection report for the landlord: every A–J check, what was found, and where each problem has got to.
export default async function Report({ params }) {
  const { id } = await params;
  const { sb, member } = await currentMember();
  const { data: i } = await sb.from('inspections').select('*, properties(id, address_line1, address_line2, town, postcode, property_owners(landlords(contacts(full_name))))').eq('id', id).maybeSingle();
  if (!i) notFound();
  const { data: F } = await sb.from('inspection_findings').select('*, repairs(status, verified_at, tenant_confirmed)').eq('inspection_id', id);
  const { data: photos } = await sb.from('documents').select('id').in('about_id', (F || []).map((f) => f.id).concat(id));
  const p = i.properties, ag = member.agencies || {};
  const owner = p.property_owners && p.property_owners[0] && p.property_owners[0].landlords;
  const res = i.results || {}, byCode = Object.fromEntries((F || []).map((f) => [f.check_code, f]));
  const actions = CHECKS.filter(([c]) => res[c] === 'action' || byCode[c]).length;
  return (
    <>
      <div className="row noprint"><Link href={isStaff(member) ? '/properties/' + p.id : '/portal'} className="btn ghost small">‹ Back</Link><PrintButton label="Print report" /></div>
      <div className="sheet">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 2 }}><h1>Property inspection</h1><span>{ag.trading_name || ag.name}</span></div>
          <dl><dt>Date</dt><dd><b>{fmt(i.inspected_on)}</b></dd><dt>Result</dt><dd><b>{actions ? actions + ' item' + (actions === 1 ? '' : 's') + ' need action' : 'All checks passed'}</b></dd></dl>
        </div>
        <div className="grid2">
          <div className="box"><b>Property</b><br />{[p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean).map((l) => <span key={l}>{l}<br /></span>)}</div>
          <div className="box"><b>Prepared for</b><br />{owner ? owner.contacts.full_name : 'The landlord'}<br /><span className="small">Checked against the Repairing Standard (Housing (Scotland) Act 2006), items A to J.</span></div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}><th style={{ padding: '6px 4px' }}>Check</th><th>Result</th><th>Notes and progress</th></tr></thead>
          <tbody>{CHECKS.map(([code, label]) => {
            const f = byCode[code], v = res[code] || (f ? 'action' : null), st = f ? findingState(f) : null;
            return (<tr key={code} style={{ borderBottom: '1px solid #ddd', verticalAlign: 'top' }}>
              <td style={{ padding: '7px 4px', width: '38%' }}><b>{code}</b> {label}</td>
              <td style={{ padding: '7px 4px', fontWeight: 700, color: v === 'action' ? '#a12' : v === 'pass' ? '#1a5f45' : '#555' }}>{v === 'action' ? 'Action' : v === 'pass' ? 'Pass' : v === 'na' ? 'N/A' : '–'}</td>
              <td style={{ padding: '7px 4px' }}>{f ? <>{f.note}<br /><span style={{ color: '#555' }}>{st.text}</span></> : ''}</td></tr>);
          })}</tbody>
        </table>
        {i.notes && <div className="box"><b>Notes</b><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{i.notes}</p></div>}
        {(photos || []).length > 0 && <span className="small">{photos.length} photo{photos.length === 1 ? '' : 's'} taken, held on file.</span>}
      </div>
    </>
  );
}
