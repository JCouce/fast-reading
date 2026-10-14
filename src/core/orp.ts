const ALNUM = /[\p{L}\p{N}]/u;

function pivotOrdinal(len: number): number {
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

export function pivotIndex(word: string): number {
  // Posiciones en code units (no en code points) porque el índice se usa sobre el string tal cual.
  const positions: number[] = [];
  let i = 0;
  for (const ch of word) {
    if (ALNUM.test(ch)) positions.push(i);
    i += ch.length;
  }
  if (positions.length === 0) return 0;
  return positions[pivotOrdinal(positions.length)] ?? 0;
}
