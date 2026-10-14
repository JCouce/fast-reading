import { bookToTokens, type BookTokens } from './core/bookTokens';
import { pivotIndex } from './core/orp';
import { createPlayer, type Clock, type Player, type Visibility } from './core/player';
import { MESSAGES } from './ingest/errors';
import type { Book } from './core/types';
import type { IngestResult } from './ingest/ingest';
import type { IngestMessage } from './ingest/worker';
import { cacheKey } from './persist/cacheKey';
import { createStore, type Progress } from './persist/store';
import './style.css';

const WPM_STEP = 25;
const DEFAULT_WPM = 300;
const SAVE_EVERY_MS = 1000;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Falta #app');

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';

app.innerHTML = `
  <header class="top">
    <span class="brand"><span class="brand-mark" aria-hidden="true"></span>fast reading</span>
    <button type="button" class="chip open-other" hidden>Abrir otro PDF</button>
  </header>
  <input class="sr-only" type="file" accept="application/pdf,.pdf" tabindex="-1" data-testid="file-input" aria-label="Elegir un libro en PDF" />
  <section class="hero">
    <h1>Lee una palabra cada vez.</h1>
    <p class="lede">Abre un libro en PDF y léelo a la velocidad que quieras. El archivo no sale de tu navegador.</p>
    <button type="button" class="drop">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
      <strong>Elige un PDF</strong>
      <span>o arrástralo aquí</span>
    </button>
    <p class="keys"><kbd>Espacio</kbd> reproducir o pausar · <kbd>↑</kbd> <kbd>↓</kbd> velocidad</p>
  </section>
  <div class="drop-overlay" aria-hidden="true"><span>Suelta el PDF para abrirlo</span></div>
  <div class="toasts">
    <p class="toast loading" role="status" hidden><span class="spinner" aria-hidden="true"></span>Procesando el PDF…</p>
    <p class="toast error" data-testid="error" role="alert" hidden></p>
  </div>
  <main class="reader" data-testid="reader" data-playing="false" hidden>
    <div class="progress" aria-hidden="true"><div class="progress-fill"></div></div>
    <div class="stage">
      <div class="word" data-testid="word" aria-hidden="true"><span class="pre"></span><span class="pivot" data-testid="pivot"></span><span class="post"></span></div>
    </div>
    <div class="dock">
      <section class="sheet" aria-label="Contexto">
        <div class="sheet-inner">
          <div class="sheet-head"><span class="chapter"></span><span class="remaining"></span></div>
          <p class="context" data-testid="context"></p>
        </div>
      </section>
      <div class="controls">
        <div class="speed">
          <button type="button" class="icon slower" aria-label="Más lento">−</button>
          <span class="wpm-box"><span data-testid="wpm">${DEFAULT_WPM}</span><small>wpm</small></span>
          <button type="button" class="icon faster" aria-label="Más rápido">+</button>
        </div>
        <button type="button" class="play" data-testid="play" aria-label="Reproducir">${ICON_PLAY}</button>
        <span class="pct">0 %</span>
      </div>
    </div>
  </main>
`;

const $ = <T extends HTMLElement>(sel: string) => {
  const el = app.querySelector<T>(sel);
  if (!el) throw new Error(`Falta ${sel}`);
  return el;
};

const fileInput = $<HTMLInputElement>('[data-testid="file-input"]');
const errorEl = $('[data-testid="error"]');
const loadingEl = $('.loading');
const readerEl = $('[data-testid="reader"]');
const preEl = $('.word .pre');
const pivotEl = $('[data-testid="pivot"]');
const postEl = $('.word .post');
const playBtn = $<HTMLButtonElement>('[data-testid="play"]');
const wpmEl = $('[data-testid="wpm"]');
const contextEl = $('[data-testid="context"]');
const sheetEl = $('.sheet');
const chapterEl = $('.chapter');
const remainingEl = $('.remaining');
const pctEl = $('.pct');
const progressEl = $('.progress-fill');
const heroEl = $('.hero');
const openOtherBtn = $<HTMLButtonElement>('.open-other');

let player: Player | null = null;
let current: { key: string; book: Book; tokens: BookTokens } | null = null;
let wpm = DEFAULT_WPM;

function show(text: string) {
  const p = pivotIndex(text);
  const pivot = /^./su.exec(text.slice(p))?.[0] ?? '';
  preEl.textContent = text.slice(0, p);
  pivotEl.textContent = pivot;
  postEl.textContent = text.slice(p + pivot.length);
}

// Párrafo [start, end) que contiene la palabra `w` (paragraphStarts viene ordenado).
function paragraphRange(book: Book, w: number): [number, number] {
  let start = 0;
  let end = book.words.length;
  for (const s of book.paragraphStarts) {
    if (s <= w) start = s;
    else {
      end = s;
      break;
    }
  }
  return [start, end];
}

function renderContext() {
  if (!player || !current) return;
  const { book, tokens: { tokens, wordOf } } = current;
  const t = player.index;
  const w = wordOf[t];
  if (w === undefined) {
    contextEl.replaceChildren();
    return;
  }
  const [start, end] = paragraphRange(book, w);
  const nodes: (Node | string)[] = [];
  if (start < w) nodes.push(`${book.words.slice(start, w).join(' ')} `);
  // Si splitLong partió la palabra se ven sus trozos y solo se resalta el que estaba en pantalla.
  let first = t;
  while (first > 0 && wordOf[first - 1] === w) first--;
  for (let i = first; wordOf[i] === w; i++) {
    const text = tokens[i]?.text ?? '';
    if (i === t) {
      const mark = document.createElement('mark');
      mark.dataset.testid = 'context-current';
      mark.textContent = text;
      nodes.push(mark);
    } else {
      nodes.push(text);
    }
  }
  if (w + 1 < end) nodes.push(` ${book.words.slice(w + 1, end).join(' ')}`);
  contextEl.replaceChildren(...nodes);
  const mark = contextEl.querySelector<HTMLElement>('mark');
  if (mark) contextEl.scrollTop = mark.offsetTop - contextEl.clientHeight / 2;

  let chapter = '';
  for (const title of book.titles) {
    if (title.start > w) break;
    chapter = title.text;
  }
  chapterEl.textContent = chapter;
  remainingEl.textContent = formatRemaining(player.remainingMs());
}

function formatRemaining(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `quedan ${min} min`;
  return `quedan ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function renderProgress() {
  const p = player?.progress() ?? 0;
  progressEl.style.transform = `scaleX(${p})`;
  pctEl.textContent = `${Math.floor(p * 100)} %`;
}

function sync() {
  const playing = player?.playing ?? false;
  sheetEl.inert = playing;
  if (!playing) renderContext();
  renderProgress();
  readerEl.dataset.playing = String(playing);
  playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  wpmEl.textContent = String(player?.wpm ?? wpm);
  saveProgress();
}

let lastSave = 0;
function saveProgress() {
  if (!player || !current) return;
  lastSave = performance.now();
  const { key } = current;
  const p = { index: player.index, wpm: player.wpm };
  void storePromise.then((store) => store.saveProgress(key, p));
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

const clock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, Math.max(0, ms)),
  clearTimeout: (h) => window.clearTimeout(h as number),
};

const visibility: Visibility = {
  get hidden() { return document.hidden; },
  onChange: (cb) => document.addEventListener('visibilitychange', cb),
};

function extractInWorker(bytes: Uint8Array): Promise<IngestResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./ingest/worker.ts', import.meta.url), { type: 'module' });
    const done = (r: IngestResult) => {
      worker.terminate();
      resolve(r);
    };
    const crash = () => done({ ok: false, error: { code: 'WORKER_CRASH', message: MESSAGES.WORKER_CRASH } });
    worker.onmessage = (e: MessageEvent<IngestMessage | { kind?: undefined }>) => {
      if (e.data.kind === 'ingest-result') done(e.data.result);
    };
    worker.onerror = crash;
    worker.onmessageerror = crash;
    worker.postMessage(bytes, [bytes.buffer]);
  });
}

const storePromise = createStore();

async function open(file: File) {
  player?.pause();
  errorEl.hidden = true;
  loadingEl.hidden = false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [store, key] = await Promise.all([storePromise, cacheKey(bytes)]);
  let book = await store.loadBook(key);
  if (!book) {
    const result = await extractInWorker(bytes);
    if (!result.ok) {
      loadingEl.hidden = true;
      showError(result.error.message);
      return;
    }
    book = result.book;
    await store.saveBook(key, book);
  }
  const progress = await store.loadProgress(key);
  loadingEl.hidden = true;
  await store.setLastBook(key);
  startReader(key, book, progress);
}

async function openLast() {
  const store = await storePromise;
  const key = await store.getLastBook();
  if (!key || current) return;
  const [book, progress] = await Promise.all([store.loadBook(key), store.loadProgress(key)]);
  // Si mientras tanto se ha elegido otro archivo, manda ese.
  if (book && !current) startReader(key, book, progress);
}

function startReader(key: string, book: Book, progress: Progress | null) {
  player?.pause();
  const bookTokens = bookToTokens(book);
  const { tokens } = bookTokens;
  current = { key, book, tokens: bookTokens };
  if (progress) wpm = progress.wpm;
  const p = createPlayer({
    tokens,
    clock,
    wpm,
    visibility,
    onWord: (i) => {
      show(tokens[i]?.text ?? '');
      renderProgress();
      if (performance.now() - lastSave >= SAVE_EVERY_MS) saveProgress();
    },
    onBlank: () => show(''),
    onEnd: sync,
  });
  if (progress) p.seek(progress.index);
  player = p;
  readerEl.hidden = false;
  heroEl.hidden = true;
  openOtherBtn.hidden = false;
  show(tokens[p.index]?.text ?? '');
  sync();
}

// Una sola vez y en microtarea: el listener del reproductor se registra después, y así la pausa ya está aplicada.
document.addEventListener('visibilitychange', () => queueMicrotask(sync));
window.addEventListener('pagehide', saveProgress);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Vaciarlo deja volver a elegir el mismo archivo (si no, no hay `change`).
  fileInput.value = '';
  if (file) void open(file);
});
for (const btn of [openOtherBtn, $('.drop')]) btn.addEventListener('click', () => fileInput.click());

// Arrastrar un archivo a cualquier parte de la ventana. dragleave salta también al pasar entre hijos: solo cuenta al salir de la ventana.
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  document.body.dataset.drag = '';
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) delete document.body.dataset.drag;
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  delete document.body.dataset.drag;
  const file = e.dataTransfer?.files[0];
  if (file) void open(file);
});

playBtn.addEventListener('click', () => {
  player?.toggle();
  sync();
});

function changeWpm(delta: number) {
  if (player) player.setWpm(player.wpm + delta);
  wpm = player?.wpm ?? Math.min(1000, Math.max(100, wpm + delta));
  sync();
}
$('.slower').addEventListener('click', () => changeWpm(-WPM_STEP));
$('.faster').addEventListener('click', () => changeWpm(WPM_STEP));

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    player?.toggle();
    sync();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    changeWpm(WPM_STEP);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    changeWpm(-WPM_STEP);
  }
});

// El botón enfocado se activa con el keyup del espacio: cancelarlo evita el doble disparo (keydown ya ha alternado).
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') e.preventDefault();
});

Object.assign(window, { __rsvp: { show } });

void openLast();
