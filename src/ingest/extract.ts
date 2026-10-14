import type { Book } from '../core/types';
import { resolveLineBreakHyphen } from './dehyphenate';
import { IngestError } from './errors';
import { normalizeText } from './normalize';

type PdfJs = typeof import('pdfjs-dist');

export interface Line {
  page: number;      // 1-based
  x: number;
  y: number;         // línea base, en coordenadas PDF (crece hacia arriba)
  size: number;      // tamaño de fuente
  font: string;      // fuente mayoritaria del renglón
  text: string;      // normalizado, sin basura
}

const isNode = (): boolean =>
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';

async function loadPdfJs(): Promise<PdfJs> {
  if (isNode()) return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  // En el Web Worker de la app: pdf.js usa este handler en el mismo hilo en vez de abrir otro worker.
  const handler = await import('pdfjs-dist/build/pdf.worker.mjs');
  Object.assign(globalThis, { pdfjsWorker: handler });
  return import('pdfjs-dist');
}

// Controles, U+FFFD y uso privado: aparecen con fuentes ofuscadas y no son texto.
const GARBAGE_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f�-]|[\u{f0000}-\u{10ffff}]/gu;
const BULLET_RE = /^[·•]$/;
const DASH_RE = /^[–—]$/;
const LINE_END_HYPHEN_RE = /[\p{L}][-‐‑]$/u;

interface RawItem { str: string; x: number; y: number; width: number; size: number; font: string; eol: boolean }

function itemsToLines(page: number, items: RawItem[]): Line[] {
  const lines: Line[] = [];
  let text = '';
  let x = 0;
  let y = 0;
  let size = 0;
  let end = 0;
  const fontChars = new Map<string, number>();
  let open = false;

  const flush = (): void => {
    if (!open) return;
    const clean = normalizeText(text).replace(GARBAGE_RE, '').replace(/\s+/g, ' ').trim();
    if (clean) {
      let font = '';
      let best = -1;
      for (const [f, n] of fontChars) if (n > best) [font, best] = [f, n];
      lines.push({ page, x, y, size, font, text: clean });
    }
    text = '';
    fontChars.clear();
    open = false;
  };

  for (const it of items) {
    const sameLine = open && Math.abs(it.y - y) <= Math.max(1, size * 0.3) && it.x >= end - size;
    if (!sameLine) flush();
    if (it.str.length > 0 || it.width > 0) {
      if (!open) {
        open = true;
        x = it.x;
        y = it.y;
        size = it.size;
        end = it.x;
      } else if (it.x - end > size * 0.2 && !/\s$/.test(text) && !/^\s/.test(it.str)) {
        // Hueco horizontal sin carácter de espacio: separa palabras igualmente.
        text += ' ';
      }
      text += it.str;
      end = Math.max(end, it.x + it.width);
      if (it.str.trim()) fontChars.set(it.font, (fontChars.get(it.font) ?? 0) + it.str.length);
    }
    if (it.eol) flush();
  }
  flush();
  return lines;
}

async function readLines(pdfjs: PdfJs, bytes: Uint8Array): Promise<{ lines: Line[]; pageCount: number }> {
  // pdf.js se queda con el buffer (lo transfiere); trabajamos sobre una copia.
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') throw new IngestError('ENCRYPTED');
    throw new IngestError('CORRUPT');
  }
  try {
    const lines: Line[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const it of content.items) {
        if (!('str' in it)) continue;
        const [a = 0, b = 0, , , tx = 0, ty = 0] = it.transform as number[];
        items.push({
          str: it.str,
          x: tx,
          y: ty,
          width: it.width,
          size: Math.hypot(a, b) || it.height,
          font: it.fontName,
          eol: it.hasEOL,
        });
      }
      lines.push(...itemsToLines(p, items));
      page.cleanup();
    }
    return { lines, pageCount: doc.numPages };
  } finally {
    void doc.destroy();
  }
}

// Margen izquierdo de cada página = la x más frecuente de sus renglones.
function pageMargins(lines: Line[]): Map<number, number> {
  const counts = new Map<number, Map<number, number>>();
  for (const l of lines) {
    const m = counts.get(l.page) ?? new Map<number, number>();
    const k = Math.round(l.x);
    m.set(k, (m.get(k) ?? 0) + 1);
    counts.set(l.page, m);
  }
  const margins = new Map<number, number>();
  for (const [page, m] of counts) {
    let best = 0;
    let bestN = -1;
    for (const [k, n] of m) if (n > bestN || (n === bestN && k < best)) [best, bestN] = [k, n];
    margins.set(page, best);
  }
  return margins;
}

// Interlineado normal ≈ 1,2–1,4× el tamaño; entre párrafos el hueco es ~2×.
const PARAGRAPH_GAP = 1.7;
const INDENT = 0.5;
const MAX_INDENT = 4;
const LOWER_START_RE = /^[^\p{L}\p{N}]*\p{Ll}/u;
const TERMINAL_END_RE = /[.!?…:][»"'”’)\]]*$/u;

function paragraphBreaks(lines: Line[]): boolean[] {
  const margins = pageMargins(lines);
  const offset = (l: Line): number => l.x - (margins.get(l.page) ?? l.x);

  return lines.map((cur, i) => {
    const prev = lines[i - 1];
    if (!prev) return true;
    // Minúscula tras un renglón sin puntuación final: la frase sigue aunque haya hueco (imagen, maquetación).
    if (LOWER_START_RE.test(cur.text) && !TERMINAL_END_RE.test(prev.text)) return false;
    const thr = cur.size * INDENT;
    if (Math.abs(cur.size - prev.size) > Math.min(cur.size, prev.size) * 0.15) return true;

    if (prev.page !== cur.page) {
      // Frase que cruza página: solo abre párrafo si el renglón está sangrado respecto al que le sigue
      // (o, si no hay siguiente en la página, respecto al margen). Las citas en bloque van enteras sangradas.
      const next = lines[i + 1];
      if (next && next.page === cur.page) return cur.x > next.x + thr;
      return offset(cur) > offset(prev) + thr;
    }
    // Sangría frente al renglón anterior: un bloque entero desplazado (cita) no abre párrafo en cada renglón.
    // Un desplazamiento enorme es un renglón centrado (título partido), no una sangría.
    const shift = cur.x - prev.x;
    if (shift > thr && shift < cur.size * MAX_INDENT) return true;
    const gap = prev.y - cur.y;
    return gap <= 0 || gap > Math.max(cur.size, prev.size) * PARAGRAPH_GAP;
  });
}

const TITLE_PUNCT_END_RE = /[.,;:!?…»"'”’)\]-]$/u;
const UPPER_START_RE = /^[^\p{L}\p{N}]*[\p{Lu}\p{N}]/u;
const MAX_TITLE_LINES = 3;
const SHORT_LINE = 0.6;

function mostFrequent<T>(xs: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | undefined;
  let bestN = -1;
  for (const [x, n] of counts) if (n > bestN) [best, bestN] = [x, n];
  return best;
}

// Rangos [from, to] de renglones que son títulos. Un título es un bloque aislado (empieza en párrafo y lo que
// sigue también) cuyo último renglón no acaba en puntuación, y que o bien va en otra fuente (o más grande) que el
// cuerpo, o bien es un único renglón corto en mayúscula: en el apéndice los títulos usan la fuente del cuerpo.
function titleRanges(lines: Line[], breaks: boolean[]): Array<[number, number]> {
  const bodyFont = mostFrequent(lines.map((l) => l.font));
  const bodySize = mostFrequent(lines.map((l) => Math.round(l.size))) ?? 0;
  const bodyLens = lines
    .filter((l) => l.font === bodyFont && Math.round(l.size) === bodySize)
    .map((l) => l.text.length)
    .sort((a, b) => a - b);
  const medianLen = bodyLens[Math.floor(bodyLens.length / 2)] ?? 0;
  const styled = (l: Line): boolean => l.font !== bodyFont || l.size > bodySize * 1.1;

  // Fin de bloque: siguiente renglón abre párrafo, o cambia de página y empieza en mayúscula
  // (al pie de página el hueco tras un título no se ve).
  const endsBlock = (i: number): boolean => {
    const next = lines[i + 1];
    const cur = lines[i];
    if (!next || !cur || breaks[i + 1]) return true;
    return next.page !== cur.page && !TITLE_PUNCT_END_RE.test(cur.text) && UPPER_START_RE.test(next.text);
  };

  const ranges: Array<[number, number]> = [];
  let from = 0;
  while (from < lines.length) {
    let to = from;
    while (!endsBlock(to)) to++;
    const block = lines.slice(from, to + 1);
    const first = block[0];
    const last = block[block.length - 1];
    // Letra más pequeña que el cuerpo (créditos, colofón) no es un título.
    if (first && last && first.size >= bodySize * 0.9 && !TITLE_PUNCT_END_RE.test(last.text) && UPPER_START_RE.test(first.text.replace(/^[·•]\s*/, ''))) {
      const byFont =
        block.length <= MAX_TITLE_LINES &&
        block.every((l) => styled(l) && l.font === first.font && Math.abs(l.size - first.size) < 0.5);
      const byShortLine = block.length === 1 && first.text.length < medianLen * SHORT_LINE;
      if (byFont || byShortLine) ranges.push([from, to]);
    }
    from = to + 1;
  }
  return ranges;
}

export function linesToBook(lines: Line[], pageCount: number): Book {
  const words: string[] = [];
  const paragraphStarts: number[] = [];
  const listItemStarts: number[] = [];
  const titles: Book['titles'] = [];
  const breaks = paragraphBreaks(lines);
  const ranges = titleRanges(lines, breaks);
  // Un título es su propio párrafo y lo que le sigue abre otro.
  for (const [from, to] of ranges) {
    breaks[from] = true;
    if (to + 1 < lines.length) breaks[to + 1] = true;
  }
  const titleFrom = new Map(ranges);
  const titleTo = new Map(ranges.map(([from, to]) => [to, from]));
  let titleStart = 0;

  let pendingPrefix = '';
  let pendingListItem = false;
  let pendingParagraph = false;
  let joinHyphen = false;

  const push = (w: string): void => {
    if (pendingParagraph && paragraphStarts[paragraphStarts.length - 1] !== words.length) paragraphStarts.push(words.length);
    if (pendingListItem) listItemStarts.push(words.length);
    words.push(pendingPrefix + w);
    pendingPrefix = '';
    pendingListItem = false;
    pendingParagraph = false;
  };

  lines.forEach((line, li) => {
    if (breaks[li]) {
      pendingParagraph = true;
      joinHyphen = false;
    }
    if (titleFrom.has(li)) titleStart = words.length;
    const tokens = line.text.split(' ').filter((t) => t.length > 0);
    tokens.forEach((tok, ti) => {
      if (BULLET_RE.test(tok)) {
        pendingListItem = true;
        return;
      }
      if (DASH_RE.test(tok)) {
        pendingPrefix += tok;
        return;
      }
      if (ti === 0 && joinHyphen && !pendingPrefix && !pendingListItem && words.length > 0) {
        const last = words.length - 1;
        words[last] = resolveLineBreakHyphen(words[last] ?? '', tok);
        return;
      }
      push(tok);
    });
    const lastTok = tokens[tokens.length - 1] ?? '';
    joinHyphen = LINE_END_HYPHEN_RE.test(lastTok);
    if (titleTo.has(li) && words.length > titleStart) {
      titles.push({ start: titleStart, end: words.length, text: words.slice(titleStart, words.length).join(' ') });
    }
  });
  // Raya o viñeta colgando al final del libro: no hay palabra a la que pegarla.
  if (words.length > 0 && paragraphStarts[0] !== 0) paragraphStarts.unshift(0);

  return { words, paragraphStarts, titles, listItemStarts, pageCount };
}

export async function extractLines(bytes: Uint8Array): Promise<{ lines: Line[]; pageCount: number }> {
  return readLines(await loadPdfJs(), bytes);
}

export async function extractBook(bytes: Uint8Array): Promise<Book> {
  const { lines, pageCount } = await extractLines(bytes);
  const book = linesToBook(lines, pageCount);
  if (book.words.length === 0) throw new IngestError('NO_TEXT');
  return book;
}
