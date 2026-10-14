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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
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

function paragraphBreaks(lines: Line[]): boolean[] {
  const margins = pageMargins(lines);
  const steps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    if (prev && cur && prev.page === cur.page && prev.y > cur.y) steps.push(prev.y - cur.y);
  }
  const step = median(steps);

  return lines.map((cur, i) => {
    const prev = lines[i - 1];
    if (!prev) return true;
    const indent = cur.x - (margins.get(cur.page) ?? cur.x) > cur.size * 0.5;
    if (indent) return true;
    if (prev.page !== cur.page) return false;
    const gap = prev.y - cur.y;
    return gap <= 0 || (step > 0 && gap > step * 1.4);
  });
}

export function linesToBook(lines: Line[], pageCount: number): Book {
  const words: string[] = [];
  const paragraphStarts: number[] = [];
  const listItemStarts: number[] = [];
  const breaks = paragraphBreaks(lines);

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
  });
  // Raya o viñeta colgando al final del libro: no hay palabra a la que pegarla.
  if (words.length > 0 && paragraphStarts[0] !== 0) paragraphStarts.unshift(0);

  return { words, paragraphStarts, titles: [], listItemStarts, pageCount };
}

export async function extractBook(bytes: Uint8Array): Promise<Book> {
  const pdfjs = await loadPdfJs();
  const { lines, pageCount } = await readLines(pdfjs, bytes);
  const book = linesToBook(lines, pageCount);
  if (book.words.length === 0) throw new IngestError('NO_TEXT');
  return book;
}
