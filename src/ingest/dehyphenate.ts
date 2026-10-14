// Solo el guion ASCII y sus variantes Unicode; la raya – (U+2013) no es guion de corte.
const HYPHENS = /[-‐‑]/;
const TRAILING_HYPHEN = /[-‐‑]$/;

export function resolveLineBreakHyphen(left: string, right: string): string {
  if (!TRAILING_HYPHEN.test(left)) return left + right;
  // Si el trozo derecho ya lleva guion, es un compuesto (lucha-huida-inmovilidad): se mantiene.
  if (HYPHENS.test(right)) return left + right;
  return left.slice(0, -1) + right;
}
