import Link from 'next/link';
import styles from './Today.module.css';
import TopBar from '../topbar';
import PortfolioScope from '@/components/PortfolioScope';
import { portfolioContext, portfolioScope, EMPTY_PORTFOLIO_ID } from '@/lib/portfolio';
import { currentMember, isStaff } from '@/lib/supabase/server';
import { quoteState, CERTS, certStatus, depositStatus, prescribedInfo, inspectionDue, dampStages, pastTarget, statusLabel, daysUntil, money, fmt, todayISO, INSPECT_MONTHS, PRIORITY, daysOpen } from '@/lib/rules';
import { ensureCharges, rentAccount, arrearsSince, planProgress } from '@/lib/money';
import { redirect } from 'next/navigation';

// Today: everything that needs a person, most urgent first. Each item links to where it gets done.
export default async function Today({ searchParams }) {
  const sp = await searchParams;
  const { sb, user, member } = await currentMember();
  if (!isStaff(member)) redirect('/portal');
  const { profile, error: portfolioError } = await portfolioContext(sb, member, user);
  const scope = portfolioScope(sp, member, profile);
  let portfolioIds = null;
  if (scope === 'mine') {
    const { data, error } = await sb.from('properties').select('id').eq('agency_id', member.agency_id).eq('portfolio_staff_id', profile?.id || EMPTY_PORTFOLIO_ID).is('archived_at', null);
    if (error) return <><TopBar here="/today" /><div className="error">Could not load your portfolio. Please try again.</div></>;
    portfolioIds = data?.length ? data.map((p) => p.id) : [EMPTY_PORTFOLIO_ID];
  }
  const scoped = (query, column) => portfolioIds ? query.in(column, portfolioIds) : query;
  const [{ data: props }, { data: reps }, { data: tens }, { data: certs }, { data: insps }, { data: cons }, { data: bals }, { data: setting }] = await Promise.all([
    scoped(sb.from('properties').select('id, address_line1, onboarding_status').is('archived_at', null), 'id'),
    scoped(sb.from('repairs').select('*, properties(address_line1, property_owners(landlords(approval_limit_pence)))').not('status', 'in', '(cancelled)').order('reported_at'), 'property_id'),
    scoped(sb.from('tenancies').select('*, properties(address_line1)').in('status', ['active', 'pending']), 'property_id'),
    scoped(sb.from('current_certificates').select('*'), 'property_id'),
    scoped(sb.from('inspections').select('property_id, inspected_on').order('inspected_on', { ascending: false }), 'property_id'),
    sb.from('contractors').select('id, insurance_expires, status, contacts(full_name)').eq('status', 'approved'),
    sb.from('landlord_balances').select('landlord_id, balance_pence'),
    sb.from('agency_settings').select('inspection_months').maybeSingle()
  ]);
  const T = tens || [];
  await ensureCharges(sb, member.agency_id, T.filter((t) => t.start_date <= todayISO()));
  const [{ data: charges }, { data: led }] = await Promise.all([sb.from('rent_charges').select('*'), sb.from('ledger_entries').select('tenancy_id, rent_charge_id, category, memo, amount_pence, account, entry_date')]);

  const { data: qev } = await sb.from('repair_events').select('repair_id, kind, detail, at').in('repair_id', (reps || []).filter((r) => r.status === 'assigned').map((r) => r.id).concat('00000000-0000-0000-0000-000000000000')).in('kind', ['quote', 'quote_decision']).order('at');
  const { data: plansAll } = await sb.from('arrears_plans').select('*').eq('status', 'agreed');
  const invoicesToApprove = [], awaitingLandlord = [];
  const items = []; // level: 0 = now (legal or overdue), 1 = this week, 2 = coming up
  const add = (level, area, text, sub, href) => items.push({ level, area, text, sub, href });

  for (const r of reps || []) {
    const a = r.properties ? r.properties.address_line1 : '', href = '/repairs/' + r.id;
    if (r.is_damp) { const D = dampStages(r); if (D && D.next && r.status !== 'paid') { add(D.overdue ? 0 : D.next.st.cls === 'due' ? 0 : 1, 'Damp and mould', (D.overdue ? 'OVERDUE: ' : '') + D.next.label + ', ' + a, D.next.st.text + ' · legal deadline', href); continue; } }
    if (r.status === 'reported') add(r.priority === 'emergency' || pastTarget(r) ? 0 : 1, 'Repairs', 'Book a contractor: ' + r.category + ', ' + a, PRIORITY[r.priority].label + (pastTarget(r) ? ' · past target' : ''), href);
    else if (r.status === 'assigned' && (() => { const own = r.properties && r.properties.property_owners && r.properties.property_owners[0];
      const Q = quoteState((qev || []).filter((e) => e.repair_id === r.id), (own && own.landlords && own.landlords.approval_limit_pence) || 25000);
      if (Q.stage === 'staff') { add(1, 'Repairs', 'Approve the quote: ' + money(Q.amount) + ', ' + a, Q.quote.detail.work || r.category, href); return true; }
      if (Q.stage === 'landlord') { awaitingLandlord.push({ href, address: a, amount: Q.amount }); add(daysOpen(Q.quote.at) >= 2 ? 1 : 2, 'Repairs', 'Waiting for the landlord: ' + money(Q.amount) + ' quote, ' + a, 'Above their limit. Chase them if no answer', href); return true; }
      if (Q.stage === 'declined') { add(1, 'Repairs', 'Quote declined: ' + r.category + ', ' + a, 'Get another price or release the contractor', href); return true; }
      return false; })()) {}
    else if (r.status === 'assigned' && pastTarget(r)) add(1, 'Repairs', 'Chase the contractor: ' + r.category + ', ' + a, 'Past the ' + PRIORITY[r.priority].days + '-day target', href);
    else if (r.status === 'invoiced') {
      if (r.verified_at) invoicesToApprove.push({ href, address: a, category: r.category });
      add(1, 'Repairs', (r.verified_at ? 'Approve the invoice: ' : 'Check it\'s fixed: ') + r.category + ', ' + a, statusLabel(r)[1], href);
    }
    else if (r.status === 'approved') add(1, 'Repairs', 'Pay the contractor: ' + r.category + ', ' + a, 'Invoice approved', href);
  }
  for (const t of T) {
    const A = rentAccount((charges || []).filter((c) => c.tenancy_id === t.id), (led || []).filter((e) => e.tenancy_id === t.id));
    const tc = (charges || []).filter((c) => c.tenancy_id === t.id), te = (led || []).filter((e) => e.tenancy_id === t.id);
    const since = A.arrears > 0 ? arrearsSince(tc, te) : null, plan = (plansAll || []).filter((x) => x.tenancy_id === t.id).pop(), prog = planProgress(plan, tc, te);
    if (since && since.threeMonths) add(0, 'Rent', 'Arrears three months in a row: ' + t.properties.address_line1, money(A.arrears) + ' since ' + fmt(since.since) + '. Speak to the landlord; check the pre-action steps', '/money/rent/' + t.id);
    else if (prog && !prog.onTrack) add(0, 'Rent', 'Payment plan behind: ' + t.properties.address_line1, 'Behind by ' + money(prog.behind) + '. Contact the tenant and record it', '/money/rent/' + t.id);
    else if (A.arrears > 0) add(A.daysLate >= 7 ? 0 : 1, 'Rent', 'Chase ' + money(A.arrears) + ' rent: ' + t.properties.address_line1, A.daysLate + ' days late' + (plan ? ' · payment plan on track' : ''), '/money/rent/' + t.id);
    const ds = depositStatus(t); if (ds && !ds.lodged) add(ds.cls === 'bad' ? 0 : 1, 'Deposits', 'Lodge the deposit: ' + t.properties.address_line1, ds.text, '/properties/' + t.property_id + '/deposit');
    const pi = prescribedInfo(t); if (pi && !pi.given) add(pi.cls === 'bad' ? 0 : 1, 'Deposits', 'Give the prescribed information: ' + t.properties.address_line1, pi.text, '/properties/' + t.property_id + '/deposit');
  }
  const months = (setting && setting.inspection_months) || INSPECT_MONTHS;
  for (const p of (props || []).filter((x) => x.onboarding_status === 'live')) {
    for (const c of CERTS) { const st = certStatus(c, (certs || []).find((x) => x.property_id === p.id && x.kind === c.key));
      if (st.cls === 'bad') add(c.basis === 'law' ? 0 : 1, 'Certificates', c.label + ': ' + p.address_line1, st.text, `/properties/${p.id}/certificate/${c.key}`);
      else if (st.cls === 'due') add(2, 'Certificates', c.label + ': ' + p.address_line1, st.text, `/properties/${p.id}/certificate/${c.key}`); }
    const last = (insps || []).find((i) => i.property_id === p.id), iv = inspectionDue(last && last.inspected_on, months);
    if (iv.cls !== 'ok') add(iv.cls === 'bad' ? 1 : 2, 'Inspections', 'Inspect ' + p.address_line1, iv.text, '/checks/inspect/' + p.id);
  }
  for (const c of cons || []) { const d = daysUntil(c.insurance_expires); if (c.insurance_expires && d <= 30) add(d < 0 ? 1 : 2, 'Trades', 'Insurance ' + (d < 0 ? 'expired' : 'ends soon') + ': ' + c.contacts.full_name, (d < 0 ? 'Expired ' : 'Ends ') + fmt(c.insurance_expires) + '. Not offered on repairs once expired', '/contractors'); }
  for (const b of bals || []) if (Number(b.balance_pence) < 0) add(0, 'Money', 'Landlord balance below zero', money(b.balance_pence) + '. Client money must never go negative', '/money?t=landlords');

  const queuedHrefs = new Set([...invoicesToApprove, ...awaitingLandlord].map((job) => job.href));
  const groups = [[0, 'Do now', 'Legal deadlines and overdue', 'do-now'], [1, 'This week', 'Keep things moving', 'this-week'], [2, 'Coming up', 'Plan ahead', 'coming-up']].map(([level, title, subtitle, id]) => ({ level, title, subtitle, id, tasks: items.filter((i) => i.level === level && !queuedHrefs.has(i.href)) }));
  const now = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
  const overview = [
    ['do-now', 'Do now', groups[0].tasks.length, 'Urgent and overdue work', 'urgent'],
    ['this-week', 'This week', groups[1].tasks.length, 'Tasks to keep things moving', 'normal'],
    ['invoices-to-approve', 'Invoices to approve', invoicesToApprove.length, 'Checked and ready for approval', 'decision'],
    ['awaiting-landlord', 'Awaiting landlord permission', awaitingLandlord.length, 'Quotes waiting for a decision', 'decision']
  ];
  return (
    <div className={styles.root}>
      <TopBar here="/today" />
      <header className={styles.heading}><div><span className={styles.eyebrow}>YOUR WORKSPACE</span><h1>Today</h1><p>{now} · {scope === 'mine' ? 'Your portfolio' : 'Across your agency'}</p></div><span className={styles.dateNote}>A clear view of what needs you next.</span></header>
      <PortfolioScope base="/today" scope={scope} profile={profile} />
      {portfolioError && <div className="error">Could not load your portfolio settings.</div>}
      {scope === 'mine' && <span className="muted small">Property tasks are for your portfolio. Agency-wide money and contractor alerts are also shown.</span>}
      <nav className={styles.overview} aria-label="Work overview">
        {overview.map(([id, title, count, description, tone]) => <Link key={id} href={'#' + id} className={styles.metric} data-tone={tone}><span className={styles.metricLabel}>{title}<span aria-hidden="true">↗</span></span><strong>{count}</strong><span className={styles.metricHint}>{count ? description : 'Nothing waiting'}</span></Link>)}
      </nav>
      {!items.length && <div className="note"><b>All caught up.</b> Nothing needs doing right now.</div>}
      <div className={styles.board}>
        {groups.map(({ level, title, subtitle, id, tasks }) => <section key={id} id={id} className={styles.column} data-level={level} aria-labelledby={id + '-heading'}>
          <div className={styles.columnHead}><div><h2 id={id + '-heading'}>{title}</h2><span className="muted small">{subtitle}</span></div><span className={'pill ' + (level === 0 && tasks.length ? 'bad' : level === 1 && tasks.length ? 'due' : 'info')}>{tasks.length}</span></div>
          <div className={styles.tasks}>
            {!tasks.length && <div className={styles.empty}><span className={styles.check} aria-hidden="true">✓</span><b>{level === 0 ? 'No urgent tasks' : level === 1 ? 'Nothing else waiting' : 'Nothing coming up'}</b><span className="muted small">{level === 0 ? 'No overdue or urgent items in this view.' : 'New items will appear here when they need attention.'}</span></div>}
            {tasks.map((item, index) => <Link key={item.href + '-' + index} href={item.href} className={styles.task} data-level={level}><span className={styles.taskArea}>{item.area}<span aria-hidden="true">↗</span></span><b>{item.text}</b><span className={styles.taskHint}>{item.sub}</span></Link>)}
          </div>
        </section>)}
      </div>
      <div className={styles.decisions}>
        {[
          ['invoices-to-approve', 'Invoices to approve', invoicesToApprove, 'No invoices are waiting for approval.'],
          ['awaiting-landlord', 'Awaiting landlord permission', awaitingLandlord, 'No quotes are waiting for permission.']
        ].map(([id, title, queue, empty]) => <section key={id} id={id} className={styles.decisionPanel} aria-labelledby={id + '-heading'}>
          <div className={styles.columnHead}><h2 id={id + '-heading'}>{title}</h2><span className={'pill ' + (queue.length ? 'due' : 'ok')}>{queue.length}</span></div>
          {!queue.length && <p className="muted small">{empty}</p>}
          {queue.map((job) => <Link key={job.href} href={job.href} className={styles.decisionRow}><span><b>{job.address}</b><span className={styles.taskHint}>{job.amount != null ? money(job.amount) + ' quote · Review and chase permission' : job.category + ' · Review invoice'}</span></span><span aria-hidden="true">↗</span></Link>)}
        </section>)}
      </div>
    </div>
  );
}
