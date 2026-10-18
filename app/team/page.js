import SectionLayout, { SectionGrid } from '@/components/SectionLayout';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopBar from '../topbar';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { assignLandlord, previewPortfolio } from './actions';
const PAGE = 25;
export default async function Team({ searchParams }) {
  const sp = await searchParams, { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/portal');
  const manage = ['owner', 'admin'].includes(member.role);
  const q = String(sp.q || '').trim().slice(0, 80), page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const { data: staff, error } = await sb.from('staff_profiles').select('id, full_name, is_demo, user_id').eq('agency_id', member.agency_id).eq('active', true).order('full_name');
  if (error) return <><TopBar here="/team" /><div className="error">Could not load staff portfolios. Please contact the administrator.</div></>;
  const counts = await Promise.all((staff || []).map(async (s) => { const { count } = await sb.from('properties').select('id', { count: 'exact', head: true }).eq('agency_id', member.agency_id).eq('portfolio_staff_id', s.id).is('archived_at', null); return [s.id, count || 0]; }));
  const byStaff = Object.fromEntries(counts);
  let query = sb.from('landlords').select('id, portfolio_staff_id, contacts!inner(full_name), property_owners(properties(id, archived_at))', { count: 'exact' }).eq('agency_id', member.agency_id).is('archived_at', null).order('created_at').range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.ilike('contacts.full_name', '%' + q.replace(/[%_]/g, '') + '%');
  const { data: landlords, count, error: propertyError } = await query;
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
  const pageHref = (p) => '/team?' + new URLSearchParams({ q, page: String(p) });
  return <SectionLayout><TopBar here="/team" /><div className="pagehead"><h1>Staff portfolios</h1><span className="sub">One manager for each landlord’s whole portfolio. Colleagues can still cover all properties.</span></div>
    {sp.saved && <div className="note" role="status">{sp.saved}</div>}{sp.error && <div className="error" role="alert">{sp.error}</div>}
    <SectionGrid>{(staff || []).map((s) => <div className="card" key={s.id}><b>{s.full_name}</b><span className="muted small">{byStaff[s.id]} properties · {s.is_demo ? 'Test profile · preview enabled, no separate login' : s.user_id ? 'Linked staff account' : 'Not linked to a login'}</span>{s.is_demo && manage && <form action={previewPortfolio.bind(null, s.id)}><button className="btn ghost small">Preview portfolio</button></form>}</div>)}</SectionGrid>
    <h2>Allocate landlord portfolios</h2><p className="muted small">All of a landlord’s properties stay together. Joint owners sharing a property move as one group.</p><form className="row" action="/team"><input name="q" defaultValue={q} type="search" aria-label="Search landlords to allocate" placeholder="Search landlord name" /><button className="btn small">Search</button></form>
    {propertyError && <div className="error">Could not load property allocations.</div>}
    <SectionGrid>
    {(landlords || []).map((l) => <div className="card" key={l.id}><b>{l.contacts?.full_name || 'Landlord'}</b><span className="muted small">{(l.property_owners || []).filter((o) => o.properties && !o.properties.archived_at).length} properties · allocated together</span>{manage ? <form action={assignLandlord} className="stack"><input type="hidden" name="landlord_id" value={l.id} /><label htmlFor={'staff-' + l.id}>Portfolio manager</label><select id={'staff-' + l.id} name="staff_id" defaultValue={l.portfolio_staff_id || ''}><option value="">Unassigned</option>{(staff || []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select><button className="btn small">Assign whole portfolio</button></form> : <span>{(staff || []).find((s) => s.id === l.portfolio_staff_id)?.full_name || 'Unassigned'}</span>}</div>)}
    </SectionGrid>
    <div className="pager">{page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span />}<span className="muted small">Page {page} of {pages}</span>{page < pages ? <Link href={pageHref(page + 1)}>Next</Link> : <span />}</div>
  </SectionLayout>;
}
