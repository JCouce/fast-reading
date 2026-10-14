export interface WordToken { text: string; sentenceEnd: boolean }

const OPENERS = '¿¡«("\'“‘[–—';
const CLOSERS = '»)"\'”’]';

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
  const words = text.split(/\s+/).filter((w) => w !== '');
  return words.map((w, i) => ({ text: w, sentenceEnd: endsSentence(w, words[i + 1]) }));
}
