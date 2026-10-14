import type { Book } from '../core/types';
import { IngestError, MESSAGES, type IngestErrorCode } from './errors';
import { extractBook } from './extract';
import { isPdf } from './validate';

export { IngestError, type IngestErrorCode };
export type IngestResult =
  | { ok: true; book: Book }
  | { ok: false; error: { code: IngestErrorCode; message: string } };
export type Extractor = (bytes: Uint8Array) => Promise<Book>;

const DEFAULT_TIMEOUT_MS = 60000;

const fail = (code: IngestErrorCode, message: string = MESSAGES[code]): IngestResult => ({
  ok: false,
  error: { code, message },
});

export async function ingest(
  bytes: Uint8Array,
  opts: { extractor?: Extractor; timeoutMs?: number } = {},
): Promise<IngestResult> {
  if (!isPdf(bytes)) return fail('NOT_PDF');

  const extractor = opts.extractor ?? extractBook;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IngestResult>((resolve) => {
    timer = setTimeout(() => resolve(fail('TIMEOUT')), timeoutMs);
  });

  const run = (async (): Promise<IngestResult> => {
    try {
      return { ok: true, book: await extractor(bytes) };
    } catch (err) {
      if (err instanceof IngestError) return fail(err.code, err.message.trim() || MESSAGES[err.code]);
      return fail('WORKER_CRASH');
    }
  })();

  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
