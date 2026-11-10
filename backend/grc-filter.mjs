// Pure: hidden means hidden, except super admin gets token-only stubs for unreadable docs. No I/O.
import { canReadLevel } from './auth.mjs';
import { isToken, localMask } from './tokens.mjs';

export function filterGrc(grc, { accessLevel, grantedIds = new Set(), securityOfficer = false, granteesByDoc = new Map(), superAdmin = false } = {}) {
  const documents = [];
  const hidden = new Set();
  for (const d of grc.documents) {
    if (canReadLevel(accessLevel, d.tlp)) documents.push(d);
    else if (grantedIds.has(d.id)) documents.push({ ...d, granted: true });
    else hidden.add(d.id);
  }
  const visible = new Set(documents.map((d) => d.id));
  const gone = (id) => id !== undefined && !visible.has(id);
  // A hidden id leaking through an audit summary/changes string also drops the event.
  const leaks = (e) => {
    if (hidden.size === 0) return false;
    const text = `${e.summary ?? ''} ${e.changes === undefined ? '' : JSON.stringify(e.changes)}`;
    for (const id of hidden) if (text.includes(id)) return true;
    return false;
  };
  const out = {
    ...grc,
    documents,
    evidenceLinks: grc.evidenceLinks.filter((e) => !gone(e.documentId)),
    assetDocLinks: grc.assetDocLinks.filter((l) => !gone(l.documentId)),
    auditEvents: grc.auditEvents.filter((e) => !(e.objectType === 'document' && gone(e.objectId)) && !leaks(e)),
  };
  if (superAdmin === true) {
    for (const d of grc.documents) if (hidden.has(d.id)) out.documents.push({
      id: d.id, title: isToken(d.title) ? d.title : localMask(String(d.title ?? '')), type: d.type, tlp: d.tlp,
      status: d.status, owner: d.owner, approver: d.approver, nextReview: d.nextReview, versions: [], tokenOnly: true,
    });
    out.documents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  if (securityOfficer) {
    out.restrictedDocuments = grc.documents
      .filter((d) => !visible.has(d.id))
      .map((d) => {
        const versions = d.versions ?? [];
        const dates = versions.map((v) => v.date).filter((x) => x !== undefined && x !== null).sort();
        return {
          id: d.id,
          tlp: d.tlp,
          createdAt: dates.length ? dates[0] : null,
          versionCount: versions.length,
          grantees: granteesByDoc.get(d.id) || [],
        };
      });
  }
  return out;
}
