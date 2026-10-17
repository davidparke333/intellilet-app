import Link from 'next/link';
import TopBar from '../topbar';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { CERTS, certStatus, inspectionDue, fmt, INSPECT_MONTHS } from '@/lib/rules';

// Checks: inspections due, and every certificate across every home, most urgent first.
export default async function Checks({ searchParams }) {
  const sp = await searchParams;
  const tab = sp.t === 'certs' ? 'certs' : 'insp';
  const { sb, member } = await currentMember();
  const staff = isStaff(member);
  const [{ data: props }, { data: insps }, { data: open }, { data: certs }, { data: setting }] = await Promise.all([
    sb.from('properties').select('id, address_line1, postcode, onboarding_status').is('archived_at', null).order('address_line1'),
    sb.from('inspections').select('id, property_id, inspected_on').order('inspected_on', { ascending: false }),
    sb.from('open_findings').select('property_id'),
    sb.from('current_certificates').select('*'),
    sb.from('agency_settings').select('inspection_months').maybeSingle()
  ]);
  const months = (setting && setting.inspection_months) || INSPECT_MONTHS;
  const P = props || [];
  const rank = (st) => (st.cls === 'bad' ? 0 : st.cls === 'due' ? 1 : 2);

  const inspRows = P.map((p) => { const last = (insps || []).find((i) => i.property_id === p.id); const st = inspectionDue(last && last.inspected_on, months);
    return { p, last, st, open: (open || []).filter((f) => f.property_id === p.id).length }; })
    .sort((a, b) => rank(a.st) - rank(b.st) || (a.st.d ?? -1e9) - (b.st.d ?? -1e9));

  const certRows = P.flatMap((p) => CERTS.map((c) => { const cert = (certs || []).find((x) => x.property_id === p.id && x.kind === c.key); const st = certStatus(c, cert);
    return { p, c, cert, st, d: cert ? Math.round((new Date(cert.expires_on) - Date.now()) / 864e5) : -1e9 }; }))
    .sort((a, b) => rank(a.st) - rank(b.st) || a.d - b.d);
  const showAll = sp.all === '1';
  const certList = showAll ? certRows : certRows.filter((r) => r.st.cls !== 'ok');
  const counts = { insp: inspRows.filter((r) => r.st.cls !== 'ok' || r.open).length, certs: certRows.filter((r) => r.st.cls !== 'ok').length };

  return (
    <>
      <TopBar here="/checks" />
      <div className="pagehead"><h1>Checks</h1><span className="sub">{tab === 'insp' ? 'Inspections every ' + months + ' months, against the Repairing Standard' : 'Safety certificates and reviews for every home'}</span></div>
      <nav style={{ display: 'flex', gap: 6 }}>
        <Link href="/checks" className={'btn small ' + (tab === 'insp' ? '' : 'ghost')}>Inspections {counts.insp}</Link>
        <Link href="/checks?t=certs" className={'btn small ' + (tab === 'certs' ? '' : 'ghost')}>Certificates {counts.certs}</Link>
      </nav>

      {tab === 'insp' && inspRows.map(({ p, last, st, open: n }) => (
        <div key={p.id} className="card">
          <div className="row"><Link href={'/properties/' + p.id} className="proplink"><b>{p.address_line1}</b></Link><span className={'pill ' + st.cls}>{st.text}</span></div>
          <span className="muted small">{last ? <>Last inspected <Link href={'/checks/report/' + last.id}>{fmt(last.inspected_on)}</Link></> : 'No inspection on record'}{n ? ' · ' + n + ' finding' + (n === 1 ? '' : 's') + ' still open' : ''}</span>
          {staff && <Link href={'/checks/inspect/' + p.id} className={'btn small ' + (st.cls === 'ok' ? 'ghost' : '')}>Start inspection</Link>}
        </div>))}

      {tab === 'certs' && (<>
        <Link href={showAll ? '/checks?t=certs' : '/checks?t=certs&all=1'} className="small" style={{ alignSelf: 'flex-start' }}>{showAll ? 'Show only ones needing action' : 'Show all certificates, including in-date ones'}</Link>
        {!certList.length && <div className="card"><span className="muted">Everything is in date.</span></div>}
        {certList.map(({ p, c, cert, st }) => (
          <div key={p.id + c.key} className="card" style={{ gap: 6 }}>
            <div className="row"><span><b>{c.label}</b><br /><Link href={'/properties/' + p.id} className="small">{p.address_line1}, {p.postcode}</Link></span><span className={'pill ' + st.cls}>{st.text}</span></div>
            <span className="muted small">{cert ? 'Checked ' + fmt(cert.checked_on) + ' · ' + cert.result : c.rule}{c.basis === 'policy' ? ' · agency policy, not a legal deadline' : ''}</span>
            {staff && <Link href={`/properties/${p.id}/certificate/${c.key}`} className="btn ghost small">{cert ? 'Record new certificate' : 'Record certificate'}</Link>}
          </div>))}
      </>)}
    </>
  );
}
