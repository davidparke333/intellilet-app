'use client';
import { useState } from 'react';

// Opens the user's own email program with the message filled in. Nothing is sent until they press Send there,
// and the sent copy stays in their Sent folder.
export default function EmailButton({ to, cc, subject, body, label = 'Email', ccLabel = 'Also send a copy to the landlord' }) {
  const [withCc, setWithCc] = useState(true);
  const [opened, setOpened] = useState(false);
  if (!to.length) return <span className="muted small">No email address recorded for the tenant. Add one on the tenancy, or print the letter instead.</span>;
  const href = 'mailto:' + to.map(encodeURIComponent).join(',') + '?' + [withCc && cc.length ? 'cc=' + cc.map(encodeURIComponent).join(',') : '', 'subject=' + encodeURIComponent(subject), 'body=' + encodeURIComponent(body)].filter(Boolean).join('&');
  return (
    <div className="stack" style={{ gap: 8 }}>
      {cc.length > 0 && <label className="check"><input type="checkbox" checked={withCc} onChange={(e) => setWithCc(e.target.checked)} />{ccLabel} ({cc.join(', ')})</label>}
      <a className="btn" href={href} onClick={() => setOpened(true)}>{label} to {to.join(', ')}</a>
      {opened && <span className="note small">Your email program should have opened with the letter ready. Check it, press Send there, then record it as sent below.</span>}
    </div>
  );
}
