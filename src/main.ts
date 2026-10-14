import { bookToTokens } from './core/bookTokens';
import { pivotIndex } from './core/orp';
import { createPlayer, type Clock, type Player, type Visibility } from './core/player';
import { MESSAGES } from './ingest/errors';
import type { IngestResult } from './ingest/ingest';
import type { IngestMessage } from './ingest/worker';
import './style.css';

const WPM_STEP = 25;
const DEFAULT_WPM = 300;

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

let player: Player | null = null;
let wpm = DEFAULT_WPM;

function show(text: string) {
  const p = pivotIndex(text);
  const pivot = /^./su.exec(text.slice(p))?.[0] ?? '';
  preEl.textContent = text.slice(0, p);
  pivotEl.textContent = pivot;
  postEl.textContent = text.slice(p + pivot.length);
}

function sync() {
  const playing = player?.playing ?? false;
  readerEl.dataset.playing = String(playing);
  playBtn.textContent = playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  wpmEl.textContent = String(player?.wpm ?? wpm);
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

async function open(file: File) {
  player?.pause();
  errorEl.hidden = true;
  loadingEl.hidden = false;
  const result = await extractInWorker(new Uint8Array(await file.arrayBuffer()));
  loadingEl.hidden = true;
  if (!result.ok) {
    showError(result.error.message);
    return;
  }
  const { tokens } = bookToTokens(result.book);
  player = createPlayer({
    tokens,
    clock,
    wpm,
    visibility,
    onWord: (i) => show(tokens[i]?.text ?? ''),
    onBlank: () => show(''),
    onEnd: sync,
  });
  // Registrado después que el del reproductor: cuando corre, la pausa ya está aplicada.
  document.addEventListener('visibilitychange', sync);
  readerEl.hidden = false;
  show(tokens[0]?.text ?? '');
  sync();
}

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
