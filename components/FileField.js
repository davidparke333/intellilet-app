'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// Uploads a PDF or photo straight to private storage (agency/property folder), then hands the
// stored path to the form as hidden fields, so large files never pass through the server.
export default function FileField({ label, agencyId, propertyId, prefix = 'doc' }) {
  const [state, setState] = useState({ status: '', path: '', name: '', mime: '', size: '' });
  async function onChange(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setState({ status: 'That file is over 20 MB. Use a smaller PDF or photo.' }); return; }
    setState({ status: 'Uploading…' });
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80);
    const path = `${agencyId}/${propertyId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await sb.storage.from('documents').upload(path, f, { contentType: f.type || 'application/octet-stream' });
    if (error) setState({ status: 'Upload failed: ' + error.message });
    else setState({ status: 'Uploaded ✓ ' + f.name, path, name: f.name, mime: f.type, size: String(f.size) });
  }
  return (
    <div className="field">
      <label>{label}</label>
      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={onChange} />
      {state.status && <span className="muted small">{state.status}</span>}
      <input type="hidden" name={prefix + '_path'} value={state.path} />
      <input type="hidden" name={prefix + '_name'} value={state.name} />
      <input type="hidden" name={prefix + '_mime'} value={state.mime} />
      <input type="hidden" name={prefix + '_size'} value={state.size} />
    </div>
  );
}
