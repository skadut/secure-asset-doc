const TOKEN_MARKER = ':t1:'

// A sealed title is `<masked prefix>:t1:<ciphertext>`. Show only the prefix.
export function maskTitle(title: string): string {
  const at = title.indexOf(TOKEN_MARKER)
  if (at === -1) return title
  return title.slice(0, at) || '••••••'
}

export function isSealedTitle(title: string): boolean {
  return title.includes(TOKEN_MARKER)
}
