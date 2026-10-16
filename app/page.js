import Link from 'next/link';
import { currentMember, isStaff } from '@/lib/supabase/server';
import TopBar from './topbar';

const PAGE = 25;
const name = (c) => (c && c.full_name) || '';

// Homes: every property in the agency, searchable, 25 at a time
export default async function Homes({ searchParams }) {
  const sp = await searchParams;
  const q = String(sp.q || '').trim().slice(0, 80);
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const { sb, user, member } = await currentMember();
  if (!member) return (<><TopBar sub={user ? user.email : ''} /><div className="card"><h3>Your account is not linked to an agency yet</h3><p className="muted">Ask the IntelliLet office to add you.</p></div></>);
  const agencyName = (member.agencies && (member.agencies.trading_name || member.agencies.name)) || 'IntelliLet';

  let query = sb.from('properties')
    .select('id, address_line1, address_line2, town, postcode, property_type, bedrooms, onboarding_status, property_owners(landlords(contacts(full_name))), tenancies(status, rent_pence, tenancy_people(is_lead, contacts(full_name)))', { count: 'exact' })
    .is('archived_at', null).order('address_line1').range((page - 1) * PAGE, page * PAGE - 1);
  if (q) {
    const term = '%' + q.replace(/[%_,()"\\]/g, ' ') + '%';
    query = query.or(`address_line1.ilike.${term},address_line2.ilike.${term},town.ilike.${term},postcode.ilike.${term}`);
  }
  const { data: props, count, error } = await query;
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
  const link = (p) => '/?' + new URLSearchParams({ ...(q ? { q } : {}), page: String(p) });

  return (
    <>
      <TopBar sub={`${agencyName} · ${member.role}`} />
      <div className="row"><div className="pagehead"><h1>Homes</h1><span className="sub">{count || 0} propert{count === 1 ? 'y' : 'ies'}</span></div>
        {isStaff(member) && <Link className="btn small" href="/properties/new">Add</Link>}</div>
      <form className="row" action="/" method="get">
        <input name="q" type="search" defaultValue={q} placeholder="Search address, town or postcode" aria-label="Search properties" />
        <button className="btn ghost small">Search</button>
      </form>
      {error && <div className="error">Could not load properties: {error.message}</div>}
      {!error && !props.length && (
        <div className="card"><h3>{q ? 'No matches' : 'No properties yet'}</h3>
          <p className="muted">{q ? 'Try part of the address or the postcode.' : 'Tap Add to set up your first property.'}</p></div>
      )}
      {(props || []).map((p) => {
        const t = (p.tenancies || []).find((x) => x.status === 'active');
        const lead = t && ((t.tenancy_people || []).find((x) => x.is_lead) || (t.tenancy_people || [])[0]);
        const owners = (p.property_owners || []).map((o) => name(o.landlords && o.landlords.contacts)).filter(Boolean);
        return (
          <Link key={p.id} href={`/properties/${p.id}`} className="card proplink">
            <div className="row"><h3>{p.address_line1}{p.address_line2 ? ', ' + p.address_line2 : ''}</h3>
              <span className={`pill ${p.onboarding_status === 'live' ? 'ok' : 'due'}`}>{p.onboarding_status === 'live' ? 'Live' : 'Setting up'}</span></div>
            <span className="muted small">{[p.town, p.postcode].filter(Boolean).join(' · ')}{p.bedrooms != null ? ` · ${p.bedrooms} bed ${p.property_type.toLowerCase()}` : ''}</span>
            <span className="small">{owners.length ? 'Landlord: ' + owners.join(', ') : 'No landlord recorded'}{' · '}{t ? 'Tenant: ' + (name(lead && lead.contacts) || 'not recorded') + ` · £${(t.rent_pence / 100).toFixed(2)} a month` : 'Vacant'}</span>
          </Link>
        );
      })}
      {pages > 1 && (
        <div className="pager">
          {page > 1 ? <Link className="btn ghost small" href={link(page - 1)}>‹ Previous</Link> : <span />}
          <span className="muted small">Page {page} of {pages}</span>
          {page < pages ? <Link className="btn ghost small" href={link(page + 1)}>Next ›</Link> : <span />}
        </div>
      )}
    </>
  );
}
