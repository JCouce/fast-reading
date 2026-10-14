// Mapa propio en vez de NFKC: NFKC también rompería `n.º` → `n.o` y `1.ª` → `1.a`.
const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

const LIGATURE_RE = /[ﬀ-ﬆ]/g;
const SOFT_HYPHEN_RE = /­/g;

export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(LIGATURE_RE, (c) => LIGATURES[c] ?? c)
    .replace(SOFT_HYPHEN_RE, '');
}
