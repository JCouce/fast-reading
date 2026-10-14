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
