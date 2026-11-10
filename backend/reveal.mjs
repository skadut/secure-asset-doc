// Field-level reveal for tokens (masked:t1:...) and sealed text (skadut-t1:...). Pure except injected crypto calls.
import { isToken, maskedPart } from './tokens.mjs';

export const SEALED_PREFIX = 'skadut-t1:';
export const SEALED_MASK = '***';
export const isSealed = (v) => typeof v === 'string' && v.startsWith(SEALED_PREFIX);

// targets: [obj, key][]. Plain values untouched. One batched call per kind, run in parallel.
// detokenize/unseal: string[] -> string[] | null. Fail closed: token -> maskedPart, sealed -> SEALED_MASK.
export async function reveal(targets, { detokenize, unseal }) {
  const tok = targets.filter(([o, k]) => isToken(o[k]));
  const sea = targets.filter(([o, k]) => isSealed(o[k]));
  const [tp, sp] = await Promise.all([
    tok.length ? detokenize(tok.map(([o, k]) => o[k])) : null,
    sea.length ? unseal(sea.map(([o, k]) => o[k])) : null,
  ]);
  tok.forEach(([o, k], i) => { o[k] = tp?.length === tok.length ? tp[i] : maskedPart(o[k]); });
  sea.forEach(([o, k], i) => { o[k] = sp?.length === sea.length ? sp[i] : SEALED_MASK; });
}

// Same masking as a failed reveal, without any crypto call. For callers not allowed to see the value.
export function conceal(targets) {
  for (const [o, k] of targets) {
    if (isToken(o[k])) o[k] = maskedPart(o[k]);
    else if (isSealed(o[k])) o[k] = SEALED_MASK;
  }
}
