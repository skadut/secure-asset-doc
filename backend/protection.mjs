// TLP -> stored protection. Pure: no I/O.
// 'integrity' stays valid for old CLEAR rows until db/scripts/protect-documents.mjs migrates them; new writes never get it.
export const PROTECTIONS = Object.freeze(['none', 'integrity', 'encrypted']);
export const INTEGRITY_ERROR = 'integrity check failed';

// Every known TLP, CLEAR included: sealed (/sealfile) plus HMAC tag. Unknown TLP throws, never defaults.
export function protectionFor(tlp) {
  if (tlp === 'CLEAR' || tlp === 'GREEN' || tlp === 'AMBER' || tlp === 'AMBER+STRICT' || tlp === 'RED' || tlp === 'RED+STRICT') return 'encrypted';
  throw new Error('unknown tlp');
}
