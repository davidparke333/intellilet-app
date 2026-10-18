import Link from 'next/link';
import { previewPortfolio } from '../team/actions';
import TopBar from '../topbar';
import { redirect } from 'next/navigation';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { grantAccess, revokeAccess, previewAs } from './actions';
import styles from './Access.module.css';

const PAGE = 24;
const ROLES = [['staff', 'Staff', 'Your team'], ['landlord', 'Landlords', 'Property owners'], ['tenant', 'Tenants', 'People at home'], ['contractor', 'Contractors', 'Your trade network']];
const initials = (name) => String(name || '').replace(/\(test\)/gi, '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export default async function Access({ searchParams }) {
  const sp = await searchParams, { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/portal');
  const role = ROLES.some(([key]) => key === sp.role) ? sp.role : 'staff';
  const q = String(sp.q || '').trim().slice(0, 80), page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const manager = ['owner', 'admin'].includes(member.role);
  const roleLabel = ROLES.find(([key]) => key === role)[1];
  const rootQuery = (key, countOnly = false) => {
    const opts = countOnly ? { count: 'exact', head: true } : { count: 'exact' };
    if (key === 'staff') return sb.from('staff_profiles').select(countOnly ? 'id' : 'id, full_name, is_demo, user_id', opts).eq('agency_id', member.agency_id).eq('active', true);
    if (key === 'landlord') return sb.from('landlords').select(countOnly ? 'id' : 'id, contact_id, contacts!inner(full_name, email)', opts).eq('agency_id', member.agency_id).is('archived_at', null);
    if (key === 'tenant') return sb.from('tenancy_people').select(countOnly ? 'contact_id, tenancies!inner(status)' : 'contact_id, contacts!inner(full_name, email), tenancies!inner(status, properties(address_line1))', opts).eq('agency_id', member.agency_id).in('tenancies.status', ['active', 'pending']);
    return sb.from('contractors').select(countOnly ? 'id' : 'id, contact_id, contacts!inner(full_name, email)', opts).eq('agency_id', member.agency_id).eq('status', 'approved');
  };
  const totals = await Promise.all(ROLES.map(async ([key]) => { const { count, error } = await rootQuery(key, true); return [key, error ? null : count || 0]; }));
  const totalsByRole = Object.fromEntries(totals);
  let query = rootQuery(role);
  if (q) query = query.ilike(role === 'staff' ? 'full_name' : 'contacts.full_name', '%' + q.replace(/[%_]/g, '') + '%');
  query = role === 'staff' ? query.order('full_name') : role === 'tenant' ? query.order('contact_id').order('tenancy_id') : query.order('created_at').order('id');
  const { data, count, error } = await query.range((page - 1) * PAGE, page * PAGE - 1);
  const people = (data || []).map((p) => role === 'staff' ? p : ({ id: p.contact_id, ...p.contacts, where: p.tenancies?.properties?.address_line1 }));
  const contactIds = [...new Set(people.map((p) => p.id))];
  const { data: memberships, error: membershipError } = role !== 'staff' && contactIds.length ? await sb.from('memberships').select('contact_id, active').eq('agency_id', member.agency_id).eq('role', role).eq('active', true).in('contact_id', contactIds) : { data: [], error: null };
  const hasAccess = (id) => (memberships || []).some((m) => m.contact_id === id && m.active);
  const href = (key, p = 1, search = '') => '/access?' + new URLSearchParams({ role: key, ...(search ? { q: search } : {}), ...(p > 1 ? { page: String(p) } : {}) });
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE));

  return <div className={styles.root}>
    <TopBar here="/access" />
    <header className={styles.heading}><div><span className={styles.eyebrow}>YOUR AGENCY</span><h1>People & portal access</h1><p>Everyone connected to your agency, in one place.</p></div><Link href="/team" className="btn ghost small">Manage staff portfolios</Link></header>
    {sp.saved && <div className="note" role="status">{sp.saved}</div>}{sp.error && <div className="error" role="alert">{sp.error}</div>}
    <nav className={styles.roles} aria-label="Choose account type">{ROLES.map(([key, title, hint]) => <Link key={key} href={href(key)} className={styles.role + (role === key ? ' ' + styles.selected : '')} aria-current={role === key ? 'page' : undefined}><span>{title}</span><strong>{totalsByRole[key] ?? '—'}</strong><small>{hint}</small></Link>)}</nav>
    <section className={styles.workspace} aria-label={roleLabel}>
      <div className={styles.toolbar}><div><h2>{roleLabel}</h2><span className="muted small">{error ? 'Unable to load profiles' : `${count || 0} ${role === 'tenant' ? 'tenancy contacts' : 'profiles'}${q ? ' matching your search' : ''}`}</span></div><form action="/access" className={styles.search}><input type="hidden" name="role" value={role} /><input type="search" name="q" defaultValue={q} placeholder="Search by name" aria-label={'Search ' + roleLabel.toLowerCase()} /><button className="btn small">Search</button>{q && <Link href={href(role)} className="btn ghost small">Clear</Link>}</form></div>
      {role === 'staff' && <p className={styles.hint}>Preview a test colleague’s portfolio, or manage allocations in Team. Test profiles do not have separate logins.</p>}
      {(error || membershipError) && <div className="error" role="alert">Could not load {error ? 'profiles' : 'access status'}. Please refresh before changing access.</div>}
      {!error && !people.length && <div className={styles.empty}><h3>{q ? 'No matching profiles' : 'No profiles yet'}</h3><p>{q ? 'Try another name or clear the search.' : 'Profiles will appear here when they are added to your agency.'}</p></div>}
      <div className={styles.grid}>{people.map((p, index) => {
        const on = hasAccess(p.id), demo = p.is_demo || p.full_name?.includes('(test)');
        return <article key={p.id + '-' + (p.where || index)} className={styles.person}>
          <div className={styles.personHead}><span className={styles.avatar} aria-hidden="true">{initials(p.full_name)}</span><div className={styles.identity}><h3>{p.full_name}</h3><span className="muted small">{role === 'staff' ? 'Portfolio manager' : roleLabel.slice(0, -1)}</span></div>{demo && <span className={styles.test}>TEST</span>}</div>
          <div className={styles.details}>{role === 'staff' ? <span className="muted small">{p.is_demo ? 'Explore their allocated properties and tasks.' : p.user_id ? 'Linked staff account' : 'Not linked to a login'}</span> : <><span className={styles.email}>{p.email || 'No email recorded'}</span>{p.where && <span className="muted small">{p.where}</span>}</>}</div>
          <div className={styles.status}><span className={'pill ' + (role === 'staff' ? 'info' : membershipError ? 'info' : on ? 'ok' : 'due')}>{role === 'staff' ? p.is_demo ? 'Preview enabled' : 'Staff profile' : membershipError ? 'Access status unavailable' : on ? 'Has access' : 'Access not enabled'}</span></div>
          <div className={styles.actions}>
            {role === 'staff' ? p.is_demo && manager && <form action={previewPortfolio.bind(null, p.id)}><button className="btn small">Preview portfolio <span aria-hidden="true">↗</span></button></form> : <><form action={previewAs.bind(null, p.id, role)}><button className="btn ghost small">Preview portal <span aria-hidden="true">↗</span></button></form>{!membershipError && (on ? <form action={revokeAccess.bind(null, p.id, role)}><button className={'btn ghost small ' + styles.remove}>Remove access</button></form> : <form action={grantAccess.bind(null, p.id, role)}><button className="btn small" disabled={!p.email}>Give access</button></form>)}</>}
          </div>
        </article>;
      })}</div>
      {pages > 1 && <nav className="pager" aria-label="Profile pages">{page > 1 ? <Link className="btn ghost small" href={href(role, page - 1, q)}>Previous</Link> : <span />}<span className="muted small">Page {page} of {pages}</span>{page < pages ? <Link className="btn ghost small" href={href(role, page + 1, q)}>Next</Link> : <span />}</nav>}
    </section>
    <details className={styles.help} open={!!sp.error}><summary>How to give portal access <span className="muted small">Two steps</span></summary><ol><li>In Supabase, open <b>Authentication → Users → Add user → Send invitation</b> and enter their email. They receive an email to set their password.</li><li>Choose their account type above, find their profile and press <b>Give access</b>. The email must match the invitation.</li></ol><p>Preview lets you inspect a portal without creating a separate login. Portal users see their own records; staff can cover the whole agency.</p></details>
  </div>;
}
