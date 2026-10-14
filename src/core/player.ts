import type { TimedToken } from './types';
import { buildSchedule, wordDuration } from './timing';

export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export interface Visibility { readonly hidden: boolean; onChange(cb: () => void): void }
export interface PlayerOptions {
  tokens: TimedToken[];
  clock: Clock;
  wpm?: number;
  visibility?: Visibility;
  onWord?: (index: number, at: number) => void;
  onBlank?: (at: number) => void;
  onEnd?: () => void;
}
export interface Player {
  readonly index: number;
  readonly playing: boolean;
  readonly wpm: number;
  play(): void; pause(): void; toggle(): void;
  setWpm(wpm: number): void;
  back(): void; forward(): void;
  seek(index: number): void;
  progress(): number;
  remainingMs(): number;
}

const MIN_WPM = 100;
const MAX_WPM = 1000;
const BACK_THRESHOLD = 5;
const RAMP_START = 0.6;
const RAMP_WORDS = 20;
const MIN_FIRST_MS = 200;
const LONG_PAUSE_MS = 3000;

// Fracción de los WPM para el k-ésimo token mostrado desde el play(): 60 % → 100 % lineal en RAMP_WORDS tokens.
const rampFactor = (k: number) => (k >= RAMP_WORDS ? 1 : RAMP_START + ((1 - RAMP_START) * k) / RAMP_WORDS);

const clampWpm = (wpm: number) => Math.min(MAX_WPM, Math.max(MIN_WPM, wpm));

// Mismas reglas de blanco que buildSchedule, para el hueco entre el token i y el i+1.
function blankAfter(tokens: TimedToken[], i: number): boolean {
  const cur = tokens[i];
  const next = tokens[i + 1];
  if (!cur || !next) return false;
  if (cur.sentenceEnd) return true;
  if (cur.isTitle && !next.isTitle) return true;
  if (next.isTitle && !cur.isTitle) return true;
  return next.listItemStart === true;
}

export function createPlayer(opts: PlayerOptions): Player {
  const { tokens, clock } = opts;
  let index = 0;
  let playing = false;
  let wpm = clampWpm(opts.wpm ?? 300);
  let timer: unknown = null;
  // Instante objetivo del siguiente frame: se acumula desde el play() para que el retraso de un tick no se arrastre.
  let target = 0;
  // Tokens mostrados desde el último play(), para la rampa.
  let shown = 0;
  // Instante del último pause(); null si después se ha movido a mano (seek/back/forward).
  let pausedAt: number | null = null;

  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const scheduleAt = (fn: () => void) => {
    timer = clock.setTimeout(() => {
      timer = null;
      fn();
    }, target - clock.now());
  };

  const showWord = () => {
    opts.onWord?.(index, clock.now());
    const duration = wordDuration(tokens[index] ?? { text: '' }, wpm) / rampFactor(shown);
    target += shown === 0 ? Math.max(MIN_FIRST_MS, duration) : duration;
    shown++;
    scheduleAt(afterWord);
  };

  const afterWord = () => {
    if (index >= tokens.length - 1) {
      playing = false;
      opts.onEnd?.();
      return;
    }
    if (blankAfter(tokens, index)) {
      opts.onBlank?.(clock.now());
      target += 60000 / wpm / rampFactor(shown);
      scheduleAt(nextWord);
    } else {
      nextWord();
    }
  };

  const nextWord = () => {
    index++;
    showWord();
  };

  const sentenceStart = (i: number) => {
    let s = i;
    while (s > 0 && !tokens[s - 1]?.sentenceEnd) s--;
    return s;
  };

  const jump = (i: number) => {
    const wasPlaying = playing;
    if (wasPlaying) pause();
    index = Math.min(Math.max(0, i), Math.max(0, tokens.length - 1));
    pausedAt = null;
    if (wasPlaying) play();
  };

  function play() {
    if (playing || tokens.length === 0) return;
    if (pausedAt !== null && clock.now() - pausedAt > LONG_PAUSE_MS) index = sentenceStart(index);
    pausedAt = null;
    playing = true;
    target = clock.now();
    shown = 0;
    showWord();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    pausedAt = clock.now();
    cancel();
  }

  opts.visibility?.onChange(() => {
    if (opts.visibility?.hidden) pause();
  });

  return {
    get index() { return index; },
    get playing() { return playing; },
    get wpm() { return wpm; },
    play,
    pause,
    toggle() { if (playing) pause(); else play(); },
    setWpm(next: number) { wpm = clampWpm(next); },
    back() {
      const start = sentenceStart(index);
      jump(index - start < BACK_THRESHOLD && start > 0 ? sentenceStart(start - 1) : start);
    },
    forward() {
      let i = index;
      while (i < tokens.length - 1 && !tokens[i]?.sentenceEnd) i++;
      if (i < tokens.length - 1) jump(i + 1);
    },
    seek: jump,
    progress() { return tokens.length === 0 ? 0 : index / tokens.length; },
    remainingMs() {
      return buildSchedule(tokens.slice(index), wpm).reduce((sum, f) => sum + f.duration, 0);
    },
  };
}
