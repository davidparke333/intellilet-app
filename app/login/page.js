'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  async function signIn(e) {
    e.preventDefault(); setBusy(true); setError(''); setNote('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password do not match. Check them and try again.' : error.message);
    else window.location.href = '/';
  }
  async function reset() {
    if (!email.trim()) { setError('Type your email address first, then tap Forgotten password.'); return; }
    setError(''); const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/reset' });
    if (error) setError(error.message); else setNote('If that email has an account, a reset link is on its way.');
  }
  return (
    <>
      <div className="brand" style={{ marginTop: 24 }}><div className="logo" aria-hidden="true">iL</div>
        <div><b style={{ fontFamily: 'var(--display)', fontSize: 18 }}>IntelliLet</b><div className="muted small">Lettings with compliance done in-house</div></div></div>
      <form className="card" onSubmit={signIn}>
        <h1 style={{ fontSize: 24 }}>Sign in</h1>
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <div className="note" role="status">{note}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn ghost small" onClick={reset}>Forgotten password</button>
      </form>
      <p className="muted small">Accounts are set up by IntelliLet. If you are a landlord, tenant or contractor and need access, contact the office.</p>
    </>
  );
}
