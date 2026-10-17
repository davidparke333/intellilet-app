'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// Reached from the password reset email: set a new password
export default function Reset() {
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const [ready, setReady] = useState(false); const [welcome, setWelcome] = useState(false); const [pw, setPw] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    setWelcome(window.location.search.includes('welcome'));
    const code = new URLSearchParams(window.location.search).get('code');
    (code ? sb.auth.exchangeCodeForSession(code) : sb.auth.getSession()).then(({ error }) => { if (error) setErr('This reset link has expired. Ask for a new one from the sign-in page.'); setReady(true); });
  }, []);
  async function save(e) {
    e.preventDefault(); setErr('');
    if (pw.length < 10) { setErr('Use at least 10 characters.'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) setErr(error.message); else { setMsg('Password changed.'); setTimeout(() => { window.location.href = '/'; }, 1200); }
  }
  return (
    <form className="card" onSubmit={save} style={{ marginTop: 24 }}>
      <h1 style={{ fontSize: 24 }}>{welcome ? 'Welcome. Choose your password' : 'Choose a new password'}</h1>
      <div className="field"><label htmlFor="pw">New password (at least 10 characters)</label><input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={!ready} /></div>
      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div className="note" role="status">{msg}</div>}
      <button className="btn" disabled={!ready}>Save password</button>
    </form>
  );
}
