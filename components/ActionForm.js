'use client';
import { useActionState, useEffect, useRef } from 'react';

// A form that keeps everything typed if the save is refused: the message shows at the top,
// every answer is put back, and only the problem needs fixing.
export default function ActionForm({ action, className, children }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef(null);
  useEffect(() => {
    const form = ref.current; if (!form || !state || !state.values) return;
    for (const el of form.elements) {
      if (!el.name || el.type === 'file' || el.type === 'hidden' || el.type === 'submit') continue;
      if (el.type === 'checkbox') el.checked = el.name in state.values;
      else if (el.type === 'radio') el.checked = state.values[el.name] === el.value;
      else if (el.name in state.values) el.value = state.values[el.name];
    }
    const msg = form.querySelector('[role=alert]');
    if (msg) msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {state && state.error && <div className="error" role="alert">Not saved: {state.error}. Everything you entered is still here — just correct it and save again.</div>}
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>{children}</fieldset>
    </form>
  );
}
