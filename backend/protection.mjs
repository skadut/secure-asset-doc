// TLP -> stored protection. Pure: no I/O.
export const PROTECTIONS = Object.freeze(['none', 'integrity', 'encrypted']);
export const INTEGRITY_ERROR = 'integrity check failed';

// CLEAR: HMAC tag only, content stays plain. GREEN and above (RED+STRICT same as RED): sealed. Unknown TLP throws, never defaults.
export function protectionFor(tlp) {
  if (tlp === 'CLEAR') return 'integrity';
  if (tlp === 'GREEN' || tlp === 'AMBER' || tlp === 'AMBER+STRICT' || tlp === 'RED' || tlp === 'RED+STRICT') return 'encrypted';
  throw new Error('unknown tlp');
}
