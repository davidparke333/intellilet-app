import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { CERTS, certStatus, depositStatus, prescribedInfo, inspectionDue, findingState, dampStages, checkLabel, fmt, todayISO, daysUntil, INSPECT_MONTHS } from '@/lib/rules';

// A property's compliance record, built live from the app's records. It summarises what we hold;
// it is not a certificate issued by a regulator. The underlying certificates are linked where uploaded.
const Mark = ({ ok, warn }) => <b style={{ color: ok ? '#1a5f45' : warn ? '#8a5a00' : '#a12', whiteSpace: 'nowrap' }}>{ok ? '✓ In date' : warn ? '! Due soon' : '✗ Action needed'}</b>;

export default async function Compliance({ params }) {
  const { id } = await params;
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const { data: p } = await sb.from('properties').select('*, property_owners(landlords(registration_number, registration_expires, contacts(full_name)))').eq('id', id).maybeSingle();
  if (!p) notFound();
  const [{ data: certs }, { data: tens }, { data: insps }, { data: finds }, { data: damp }, { data: setting }] = await Promise.all([
    sb.from('current_certificates').select('*').eq('property_id', id),
    sb.from('tenancies').select('*').eq('property_id', id).in('status', ['active', 'pending']).limit(1),
    sb.from('inspections').select('id, inspected_on').eq('property_id', id).order('inspected_on', { ascending: false }).limit(1),
    sb.from('inspection_findings').select('*, repairs(status, verified_at, tenant_confirmed)').eq('property_id', id),
    sb.from('repairs').select('*').eq('property_id', id).eq('is_damp', true).neq('status', 'cancelled'),
    sb.from('agency_settings').select('inspection_months').maybeSingle()
  ]);
  const { data: docs } = await sb.from('documents').select('id, storage_path, about_id').eq('about_table', 'certificates').in('about_id', (certs || []).map((c) => c.id).concat('00000000-0000-0000-0000-000000000000'));
  const links = Object.fromEntries(await Promise.all((docs || []).map(async (d) => [d.about_id, (await sb.storage.from('documents').createSignedUrl(d.storage_path, 3600)).data?.signedUrl])));
  const L = p.property_owners && p.property_owners[0] && p.property_owners[0].landlords;
  const t = (tens || [])[0], last = (insps || [])[0];
  const ag = member.agencies || {}, agency = ag.trading_name || ag.name || 'The agency';

  // every line: [requirement, basis, status cell, detail, ok, warn, link]
  const rows = [];
  for (const c of CERTS) {
    const cert = (certs || []).find((x) => x.kind === c.key), st = certStatus(c, cert);
    rows.push({ what: c.label, basis: c.basis === 'law' ? 'Legal requirement' : 'Law requires it; the review date is our schedule', ok: st.cls === 'ok', warn: st.cls === 'due' && st.ok,
      detail: cert ? 'Checked ' + fmt(cert.checked_on) + ' · ' + cert.result + (cert.expires_on ? ' · ' + (c.basis === 'law' ? 'expires ' : 'next review ') + fmt(cert.expires_on) : '') : 'No record held', link: cert && links[cert.id] });
  }
  if (L) { const d = daysUntil(L.registration_expires);
    rows.push({ what: 'Landlord registration', basis: 'Legal requirement', ok: !!L.registration_number && d > 60, warn: !!L.registration_number && d >= 0 && d <= 60,
      detail: L.registration_number ? 'Number ' + L.registration_number + (L.registration_expires ? ' · expires ' + fmt(L.registration_expires) : ' · expiry not recorded') : 'Not recorded' }); }
  if (p.property_type === 'HMO') { const d = daysUntil(p.hmo_licence_expires);
    rows.push({ what: 'HMO licence', basis: 'Legal requirement', ok: !!p.hmo_licence_number && d > 60, warn: !!p.hmo_licence_number && d >= 0 && d <= 60, detail: p.hmo_licence_number ? 'Licence ' + p.hmo_licence_number + (p.hmo_licence_expires ? ' · expires ' + fmt(p.hmo_licence_expires) : '') : 'Not recorded' }); }
  if (t && Number(t.deposit_pence)) {
    const ds = depositStatus(t), pi = prescribedInfo(t);
    rows.push({ what: 'Tenancy deposit protected', basis: 'Legal requirement', ok: ds && ds.cls === 'ok', warn: ds && ds.cls === 'due', detail: ds ? ds.text + (t.deposit_scheme ? ' · ' + t.deposit_scheme : '') : '' });
    rows.push({ what: 'Prescribed information given to tenant', basis: 'Legal requirement', ok: pi && pi.cls === 'ok', warn: pi && pi.cls === 'due', detail: pi ? pi.text : 'After the deposit is lodged' });
  }
  const iv = inspectionDue(last && last.inspected_on, (setting && setting.inspection_months) || INSPECT_MONTHS);
  const openF = (finds || []).filter((f) => findingState(f).open);
  rows.push({ what: 'Property inspection (Repairing Standard)', basis: 'Our schedule', ok: iv.cls === 'ok' && !openF.length, warn: iv.cls === 'due' || (iv.cls === 'ok' && openF.length > 0),
    detail: (last ? 'Last inspected ' + fmt(last.inspected_on) + ' · ' + iv.text : 'Not inspected yet') + (openF.length ? ' · ' + openF.length + ' finding' + (openF.length === 1 ? '' : 's') + ' being fixed: ' + openF.map((f) => f.check_code + ' ' + checkLabel(f.check_code)).join(', ') : ''), link: last ? (staff ? '/checks/report/' : '/portal/report/') + last.id : null, internal: true });
  const openDamp = (damp || []).filter((r) => { const D = dampStages(r); return D && !D.done; });
  const lateDamp = openDamp.filter((r) => dampStages(r).overdue);
  rows.push({ what: 'Damp and mould reports (Awaab\'s Law)', basis: 'Legal requirement', ok: !openDamp.length, warn: openDamp.length > 0 && !lateDamp.length,
    detail: !openDamp.length ? 'No open cases' : openDamp.length + ' open case' + (openDamp.length === 1 ? '' : 's') + (lateDamp.length ? ', ' + lateDamp.length + ' past a legal deadline' : ', all within the legal deadlines') });

  const legal = rows.filter((r) => r.basis === 'Legal requirement');
  const verdict = legal.every((r) => r.ok) ? ['ok', 'All legal requirements in date'] : legal.some((r) => !r.ok && !r.warn) ? ['bad', 'Action needed on a legal requirement'] : ['due', 'All in date, some due soon'];
  return (
    <>
      <div className="row noprint"><Link href={staff ? '/properties/' + id : '/portal'} className="btn ghost small">‹ Back</Link><PrintButton label="Print or save as PDF" /></div>
      <div className="sheet">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 2 }}><h1>Property compliance record</h1><span>{agency}</span></div>
          <dl><dt>Produced</dt><dd><b>{fmt(todayISO())}</b></dd></dl>
        </div>
        <div className="grid2">
          <div className="box"><b>Property</b><br />{[p.address_line1, p.address_line2, p.town, p.postcode].filter(Boolean).map((l) => <span key={l}>{l}<br /></span>)}</div>
          <div className="box"><b>Landlord</b><br />{L && L.contacts ? L.contacts.full_name : '—'}<br /><b style={{ display: 'inline-block', marginTop: 8, color: verdict[0] === 'ok' ? '#1a5f45' : verdict[0] === 'bad' ? '#a12' : '#8a5a00' }}>{verdict[1]}</b></div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}><th style={{ padding: '6px 4px' }}>Requirement</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.what} style={{ borderBottom: '1px solid #ddd', verticalAlign: 'top' }}>
              <td style={{ padding: '7px 4px', width: '34%' }}><b>{r.what}</b><br /><span style={{ fontSize: 12, color: '#666' }}>{r.basis}</span></td>
              <td style={{ padding: '7px 4px' }}><Mark ok={r.ok} warn={r.warn} /></td>
              <td style={{ padding: '7px 4px' }}>{r.detail}{r.link && <> · {r.internal ? <Link href={r.link}>report</Link> : <a href={r.link} target="_blank" rel="noopener">view certificate</a>}</>}</td>
            </tr>))}</tbody>
        </table>
        <span className="small" style={{ color: '#555' }}>This record is produced from the information held by {agency} on {fmt(todayISO())} and updates automatically when new checks are recorded. It summarises the certificates and records we hold; it is not itself a certificate issued by a regulator or engineer. Copies of the underlying certificates are available on request.</span>
      </div>
    </>
  );
}
