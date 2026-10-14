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

app.innerHTML = `
  <header class="bar">
    <label class="file">
      <span>Abrir PDF</span>
      <input type="file" accept="application/pdf,.pdf" data-testid="file-input" aria-label="Elegir un libro en PDF" />
    </label>
  </header>
  <p class="error" data-testid="error" role="alert" hidden></p>
  <p class="loading" role="status" hidden>Procesando el PDF…</p>
  <main class="reader" data-testid="reader" data-playing="false" hidden>
    <div class="word" data-testid="word" aria-hidden="true"><span class="pre"></span><span class="pivot" data-testid="pivot"></span><span class="post"></span></div>
    <div class="controls">
      <button type="button" class="play" data-testid="play" aria-label="Reproducir">▶</button>
      <span class="wpm-box"><span data-testid="wpm">${DEFAULT_WPM}</span> WPM</span>
    </div>
    <p class="context" data-testid="context" hidden></p>
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
}

function sync() {
  const playing = player?.playing ?? false;
  contextEl.hidden = playing || !player;
  if (!playing) renderContext();
  readerEl.dataset.playing = String(playing);
  playBtn.textContent = playing ? '❚❚' : '▶';
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
      if (performance.now() - lastSave >= SAVE_EVERY_MS) saveProgress();
    },
    onBlank: () => show(''),
    onEnd: sync,
  });
  if (progress) p.seek(progress.index);
  player = p;
  readerEl.hidden = false;
  show(tokens[p.index]?.text ?? '');
  sync();
}

// Una sola vez y en microtarea: el listener del reproductor se registra después, y así la pausa ya está aplicada.
document.addEventListener('visibilitychange', () => queueMicrotask(sync));
window.addEventListener('pagehide', saveProgress);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
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
