'use client';
import { useRef, useState } from 'react';

// Labour, parts and VAT. For a VAT-registered contractor the VAT box fills itself at 20%
// of labour + parts, but stays editable (e.g. 5% on some energy-saving work).
// For a contractor who is not VAT registered there is no VAT box at all.
const num = (v) => { const n = parseFloat(String(v || '').replace(/[£,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const gbp = (n) => '£' + n.toFixed(2);

export default function CostFields({ vatRegistered }) {
  const box = useRef(null);
  const [typedVat, setTypedVat] = useState(false);
  const [total, setTotal] = useState(0);
  function recalc(e) {
    const f = box.current; if (!f) return;
    const labour = num(f.querySelector('[name=labour]').value), parts = num(f.querySelector('[name=parts]').value);
    const vatEl = f.querySelector('[name=vat]');
    let manual = typedVat;
    if (e && e.target === vatEl) { manual = vatEl.value.trim() !== ''; setTypedVat(manual); }
    if (vatEl && !manual) vatEl.value = labour + parts > 0 ? (Math.round((labour + parts) * 20) / 100).toFixed(2) : '';
    setTotal(labour + parts + (vatEl ? num(vatEl.value) : 0));
  }
  return (
    <div ref={box} className="stack" style={{ gap: 10 }} onInput={recalc}>
      <div className="grid2">
        <div className="field"><label htmlFor="lb">Labour (£)</label><input id="lb" name="labour" inputMode="decimal" placeholder="0.00" /></div>
        <div className="field"><label htmlFor="pt">Parts (£)</label><input id="pt" name="parts" inputMode="decimal" placeholder="0.00" /></div>
      </div>
      {vatRegistered ? (
        <div className="field"><label htmlFor="vt">VAT (£)</label><input id="vt" name="vat" inputMode="decimal" placeholder="Fills in at 20%" />
          <span className="muted small">VAT registered: worked out at 20% for you. Change it if their invoice shows a different amount.</span></div>
      ) : <span className="muted small">Not VAT registered, so no VAT is added.</span>}
      <div className="row"><b>Total</b><b>{gbp(total)}</b></div>
    </div>
  );
}
