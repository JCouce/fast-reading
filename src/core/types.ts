export interface Book {
  words: string[];
  paragraphStarts: number[];
  titles: Title[];
  listItemStarts: number[];
  pageCount: number;
}

export interface Title { start: number; end: number; text: string }

export interface TimedToken {
  text: string;
  sentenceEnd?: boolean;
  sentenceLength?: number;
  paragraphEnd?: boolean;
  isTitle?: boolean;
  listItemStart?: boolean;
}
