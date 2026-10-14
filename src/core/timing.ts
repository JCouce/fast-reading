import type { TimedToken } from './types';

const MAX_MULTIPLIER = 4;
const LONG_SENTENCE = 22;

function alnumLength(word: string): number {
  return word.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

function numberDigits(word: string): number {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(core)) return 0;
  return core.replace(/[.,]/g, '').length;
}

export function durationMultiplier(t: TimedToken): number {
  const candidates = [1];
  const len = alnumLength(t.text);
  if (len >= 10 && len <= 13) candidates.push(1.5);
  else if (len >= 6 && len <= 9) candidates.push(1.2);

  if (t.text.endsWith(',')) candidates.push(1.8);
  if (t.text.endsWith(';') || t.text.endsWith(':')) candidates.push(2);
  if (t.sentenceEnd) candidates.push((t.sentenceLength ?? 0) > LONG_SENTENCE ? 3 : 2.2);
  if (t.paragraphEnd) candidates.push(3);
  if (t.isTitle) candidates.push(3);

  const digits = numberDigits(t.text);
  if (digits > 0) candidates.push(1.5 + 0.1 * digits);

  return Math.min(MAX_MULTIPLIER, Math.max(...candidates));
}

export function wordDuration(t: TimedToken, wpm: number): number {
  return (60000 / wpm) * durationMultiplier(t);
}

export type Frame = { kind: 'word'; index: number; duration: number } | { kind: 'blank'; duration: number };

export function buildSchedule(tokens: TimedToken[], wpm: number): Frame[] {
  const frames: Frame[] = [];
  const blankDuration = 60000 / wpm;
  // Dos motivos de blanco seguidos (fin de frase + título, fin de título + viñeta…) dan un solo blanco.
  const blank = () => {
    if (frames.at(-1)?.kind !== 'blank') frames.push({ kind: 'blank', duration: blankDuration });
  };

  tokens.forEach((t, index) => {
    const prevTitle = tokens[index - 1]?.isTitle === true;
    if ((t.isTitle && !prevTitle) || t.listItemStart) blank();
    frames.push({ kind: 'word', index, duration: wordDuration(t, wpm) });
    const nextTitle = tokens[index + 1]?.isTitle === true;
    if (t.sentenceEnd || (t.isTitle && !nextTitle)) blank();
  });
  return frames;
}
