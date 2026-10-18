'use client';
import { useEffect, useState } from 'react';
import { searchClients } from './actions';
export default function ClientFields({ initial }) {
  const [mode, setMode] = useState('existing'), [q, setQ] = useState(''), [result, setResult] = useState(initial), [selected, setSelected] = useState(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode !== 'existing') return;
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const next = await searchClients(q); if (current) setResult(next); }
      catch { if (current) setResult({ clients: [], error: 'Could not load clients. Try searching again.' }); }
      finally { if (current) setLoading(false); }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [q, mode]);
  return <div className="stack">
    <h3>Client</h3><div className="field"><label htmlFor="client-mode">Who is this property for?</label><select id="client-mode" name="client_mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="existing">Existing client</option><option value="new">New client</option><option value="later">Add client later</option></select></div>
    {mode === 'existing' && <>
      <input type="hidden" name="client_id" value={selected?.id || ''} />
      {selected ? <div className="note"><b>{selected.name}</b><div className="muted small">{selected.email || 'No email recorded'}</div><button type="button" className="btn ghost small" onClick={() => setSelected(null)}>Change client</button></div> : <>
        <div className="field"><label htmlFor="client-search">Select client</label><input id="client-search" type="search" placeholder="Search client name" value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="client-search-help" /></div>
        <span id="client-search-help" className="muted small">Search by name, then select a result. Up to 20 matches are shown.</span>
        <div className="stack" style={{ gap: 6 }} aria-live="polite">{loading && <span className="muted small">Searching…</span>}{result.error && <span className="error" role="alert">{result.error}</span>}{!result.error && !result.clients.length && <span className="muted small">No clients found. Try another name or choose New client.</span>}{result.clients.map((c) => <button key={c.id} type="button" className="btn ghost small" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => setSelected(c)}>{c.name}{c.email ? ' · ' + c.email : ''}</button>)}</div>
      </>}
      <span className="muted small">This property will join the client’s portfolio and inherit their assigned staff manager.</span>
    </>}
    {mode === 'new' && <>
      <div className="field"><label htmlFor="ln">Client name</label><input id="ln" name="landlord_name" required /></div>
      <div className="grid2"><div className="field"><label htmlFor="le">Email</label><input id="le" name="landlord_email" type="email" /></div><div className="field"><label htmlFor="lp">Phone</label><input id="lp" name="landlord_phone" type="tel" /></div></div>
      <div className="field"><label htmlFor="lr">Landlord registration number</label><input id="lr" name="landlord_reg" /></div>
    </>}
    {mode === 'later' && <span className="muted small">The property will be saved without a client. Link one before making it live.</span>}
  </div>;
}
