export interface WordToken { text: string; sentenceEnd: boolean }

const OPENERS = '¿¡«("\'“‘[–—';
const CLOSERS = '»)"\'”’]';
// Apertura que se pega a la palabra siguiente aunque el PDF meta espacio o salto entre medias (MH-11).
const GLUE_FORWARD = '¿¡«(–';

// Abreviaturas que, seguidas de mayúscula, no cierran frase (nombres propios tras tratamiento, etc.).
// `etc.` no está: seguido de mayúscula sí suele cerrar frase; seguido de minúscula ya lo cubre la regla general.
const ABBREVIATIONS = new Set([
  'sr', 'sra', 'srta', 'sres', 'sras', 'dr', 'dra', 'drs', 'dras', 'd', 'dña', 'ud', 'uds', 'vd', 'vds',
  'lic', 'ing', 'arq', 'prof', 'profa', 'mr', 'mrs', 'ms', 'st', 'sto', 'sta',
  'p', 'pp', 'pág', 'págs', 'ej', 'cap', 'caps', 'vol', 'vols', 'núm', 'art', 'fig', 'cf', 'vs',
  'aprox', 'tel', 'av', 'avda', 'c', 'apdo', 'dpto', 'depto', 'admón', 'gral', 'excmo', 'excma', 'ilmo', 'ilma',
]);

function stripLeading(s: string, chars: string): string {
  let i = 0;
  while (i < s.length && chars.includes(s.charAt(i))) i++;
  return s.slice(i);
}

function stripTrailing(s: string, chars: string): string {
  let i = s.length;
  while (i > 0 && chars.includes(s.charAt(i - 1))) i--;
  return s.slice(0, i);
}

function startsLowercase(word: string): boolean {
  const first = stripLeading(word, OPENERS).charAt(0);
  return first !== '' && first !== first.toUpperCase() && first === first.toLowerCase();
}

// Punto final que pertenece a una abreviatura, inicial o sigla duplicada (EE. UU.), no a la frase.
function isAbbreviationDot(word: string): boolean {
  const core = stripLeading(word, OPENERS).slice(0, -1);
  if (/^\p{Lu}$/u.test(core)) return true;
  if (/^(\p{Lu})\1$/u.test(core)) return true;
  return ABBREVIATIONS.has(core.toLowerCase());
}

function endsSentence(word: string, next: string | undefined): boolean {
  const core = stripTrailing(word, CLOSERS);
  const last = core.charAt(core.length - 1);
  if (last !== '.' && last !== '…' && last !== '!' && last !== '?') return false;
  if (next !== undefined && startsLowercase(next)) return false;
  if (last !== '.' || core.endsWith('...')) return true;
  // `!».`, `?».`, `».`: el punto cierra tras una cita o exclamación ya cerrada.
  if (/[!?…»”")]\.$/.test(core)) return true;
  return next === undefined || !isAbbreviationDot(core);
}

export function tokenize(text: string): WordToken[] {
  const words: string[] = [];
  let pending = '';
  for (const raw of text.split(/\s+/)) {
    const body = stripTrailing(raw, GLUE_FORWARD);
    const tail = raw.slice(body.length);
    if (stripLeading(body, GLUE_FORWARD) !== '') {
      words.push(pending + body);
      pending = '';
    } else {
      pending += body;
    }
    pending += tail;
  }
  // Una apertura al final del texto no tiene a quién pegarse: se descarta antes que dejarla suelta.
  return words.map((w, i) => ({ text: w, sentenceEnd: endsSentence(w, words[i + 1]) }));
}

// Fin de frase para palabras ya separadas (las de `Book`), con las mismas reglas que `tokenize`.
export function sentenceEnds(words: string[]): boolean[] {
  return words.map((w, i) => endsSentence(w, words[i + 1]));
}

const LONG_WORD = 14;
const CHUNK = 8;

function alnumLength(s: string): number {
  return s.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

// Palabras largas en trozos legibles (MH-12): por el guion si lo hay; si no, ⌈len/8⌉ trozos casi iguales.
export function splitLong(word: string): string[] {
  if (alnumLength(word) < LONG_WORD) return [word];
  if (word.includes('-')) {
    const parts = word.split(/(?<=-)(?=[^-])/);
    if (parts.length > 1) return parts;
  }
  const n = Math.ceil(word.length / CHUNK);
  // La puntuación final va entera al último trozo: ningún trozo intermedio la lleva ni el último queda solo con ella.
  const body = word.replace(/[^\p{L}\p{N}]+$/u, '');
  const trailing = word.slice(body.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const piece = body.slice(Math.round((i * body.length) / n), Math.round(((i + 1) * body.length) / n));
    parts.push(i < n - 1 ? `${piece}-` : piece + trailing);
  }
  return parts;
}
