// Everything the property pages need, read as the signed-in user (access rules apply)
export async function loadProperty(sb, id) {
  const { data: p } = await sb.from('properties').select('*').eq('id', id).maybeSingle();
  if (!p) return null;
  const [{ data: owners }, { data: tenancies }, { data: certs }] = await Promise.all([
    sb.from('property_owners').select('landlord_id, landlords(*, contacts(*))').eq('property_id', id),
    sb.from('tenancies').select('*, tenancy_people(contact_id, is_lead, role, contacts(*))').eq('property_id', id).order('start_date', { ascending: false }),
    sb.from('current_certificates').select('*').eq('property_id', id)
  ]);
  const tenancy = (tenancies || []).find((t) => t.status !== 'ended') || null;
  const tenants = tenancy ? (tenancy.tenancy_people || []).sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0)) : [];
  return { p, owners: owners || [], tenancy, tenants, certs: certs || [] };
}
// A short-lived private link to a stored document
export async function docLink(sb, documentId) {
  if (!documentId) return null;
  const { data: d } = await sb.from('documents').select('storage_path, file_name').eq('id', documentId).maybeSingle();
  if (!d) return null;
  const { data: s } = await sb.storage.from('documents').createSignedUrl(d.storage_path, 3600);
  return s ? { url: s.signedUrl, name: d.file_name || 'View document' } : null;
}
