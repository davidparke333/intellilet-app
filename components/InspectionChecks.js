'use client';
import { useState } from 'react';
import FileField from './FileField';

// The ten Repairing Standard checks. Pass / Action / N/A per check; "Action" opens a note,
// a photo, and (if a similar repair is already open) a choice to link to it instead of raising another.
export default function InspectionChecks({ checks, repairFor, openRepairs, agencyId, propertyId, children }) {
  const [res, setRes] = useState({});
  const [raise, setRaise] = useState(true);
  const done = Object.keys(res).length, actions = Object.values(res).filter((v) => v === 'action').length;
  return (
    <>
      <div className="hero" style={{ position: 'sticky', top: 0, zIndex: 2 }}><span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 18 }}>{done} of {checks.length} checked · {actions} action{actions === 1 ? '' : 's'}</span></div>
      {checks.map(([code, label]) => {
        const v = res[code], dup = openRepairs.find((r) => r.category === repairFor[code]);
        return (
          <div key={code} className="card" style={{ gap: 10 }}>
            <h3>{code} · {label}</h3>
            <div className="tri" role="radiogroup" aria-label={label}>
              {[['pass', 'Pass', 'p'], ['action', 'Action', 'f'], ['na', 'N/A', 'n']].map(([val, text, cls]) => (
                <label key={val} className={'tribtn ' + cls + (v === val ? ' on' : '')}>
                  <input type="radio" name={'r_' + code} value={val} checked={v === val} onChange={() => setRes({ ...res, [code]: val })} />{text}
                </label>))}
            </div>
            {v === 'action' && (<>
              <div className="field"><label htmlFor={'n_' + code}>What needs doing?</label><input id={'n_' + code} name={'n_' + code} placeholder="e.g. mould on bathroom ceiling, extractor not working" /></div>
              <FileField label="Photo (optional)" agencyId={agencyId} propertyId={propertyId} prefix={'p_' + code} />
              {raise && dup && (
                <div className="field"><label htmlFor={'l_' + code}>A {dup.category.toLowerCase()} repair is already open here</label>
                  <select id={'l_' + code} name={'link_' + code} defaultValue="link"><option value="link">Add this to that repair: {dup.description.slice(0, 50)}</option><option value="new">Raise a separate repair</option></select></div>)}
            </>)}
          </div>);
      })}
      {children}
      {actions > 0 && <label className="check"><input type="checkbox" name="raise" checked={raise} onChange={(e) => setRaise(e.target.checked)} />Raise a repair for each action ({actions})</label>}
      <button className="btn" disabled={done < checks.length}>{done < checks.length ? 'Answer all ' + checks.length + ' checks to save' : 'Save inspection'}</button>
    </>
  );
}
