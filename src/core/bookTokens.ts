import type { Book, TimedToken } from './types';
import { sentenceEnds, splitLong } from './tokenize';

export interface BookTokens {
  tokens: TimedToken[];
  wordOf: number[]; // índice en `book.words` de cada token
}

export function bookToTokens(book: Book): BookTokens {
  const { words } = book;
  const ends = sentenceEnds(words);
  const paragraphStarts = new Set(book.paragraphStarts);
  const listStarts = new Set(book.listItemStarts);
  const inTitle = new Array<boolean>(words.length).fill(false);
  for (const t of book.titles) for (let i = t.start; i < t.end; i++) inTitle[i] = true;
  // Un título o el final de párrafo también cierran frase aunque no lleven punto.
  for (let i = 0; i < words.length; i++) {
    if (paragraphStarts.has(i + 1) || i === words.length - 1) ends[i] = true;
    if (inTitle[i] && !inTitle[i + 1]) ends[i] = true;
  }

  const sentenceLength = new Array<number>(words.length).fill(0);
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    if (!ends[i]) continue;
    sentenceLength.fill(i - start + 1, start, i + 1);
    start = i + 1;
  }

  const tokens: TimedToken[] = [];
  const wordOf: number[] = [];
  words.forEach((word, i) => {
    const parts = splitLong(word);
    parts.forEach((text, p) => {
      const last = p === parts.length - 1;
      const t: TimedToken = { text, sentenceLength: sentenceLength[i] };
      if (last && ends[i]) t.sentenceEnd = true;
      if (last && (paragraphStarts.has(i + 1) || i === words.length - 1)) t.paragraphEnd = true;
      if (inTitle[i]) t.isTitle = true;
      if (p === 0 && listStarts.has(i)) t.listItemStart = true;
      tokens.push(t);
      wordOf.push(i);
    });
  });
  return { tokens, wordOf };
}
