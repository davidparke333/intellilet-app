'use client';
export default function PrintButton({ label = 'Print' }) {
  return <button type="button" className="btn noprint" onClick={() => window.print()}>{label}</button>;
}
