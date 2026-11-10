// Masked+sealed TLP token helpers. Pure: no DB, no HTTP. Also imported by db/scripts/tokenize-titles.mjs as /app/tokens.mjs.
const TOKEN = /^[^:]*:t1:/;

export function isToken(v) {
  return typeof v === 'string' && TOKEN.test(v);
}

// Per code point: '%' keep, '$' hide. First 3 kept; whitespace/punct kept except ':'.
function classify(text) {
  return Array.from(text, (ch, i) => (i < 3 || (ch !== ':' && /[\s\p{P}]/u.test(ch)) ? '%' : '$'));
}

export function maskPattern(text) {
  return classify(text).join('');
}

export function maskedPart(token) {
  return token.slice(0, token.indexOf(':'));
}

// Same pattern applied locally: '$' -> '*'. Fail-closed mask for non-token values.
export function localMask(text) {
  const k = classify(text);
  return Array.from(text, (ch, i) => (k[i] === '$' ? '*' : ch)).join('');
}
