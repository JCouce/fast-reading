import type { Book } from '../core/types';
import { isPdf } from './validate';

export type IngestErrorCode = 'NOT_PDF' | 'NO_TEXT' | 'ENCRYPTED' | 'CORRUPT' | 'WORKER_CRASH' | 'TIMEOUT';
export type IngestResult =
  | { ok: true; book: Book }
  | { ok: false; error: { code: IngestErrorCode; message: string } };
export type Extractor = (bytes: Uint8Array) => Promise<Book>;

const MESSAGES: Record<IngestErrorCode, string> = {
  NOT_PDF: 'El archivo no es un PDF.',
  NO_TEXT: 'El PDF no tiene texto que se pueda extraer.',
  ENCRYPTED: 'El PDF está cifrado o protegido con contraseña.',
  CORRUPT: 'El PDF está dañado y no se puede leer.',
  WORKER_CRASH: 'Algo ha fallado al procesar el PDF.',
  TIMEOUT: 'El PDF está tardando demasiado en procesarse.',
};

const DEFAULT_TIMEOUT_MS = 60000;

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'IngestError';
  }
}

const fail = (code: IngestErrorCode, message: string = MESSAGES[code]): IngestResult => ({
  ok: false,
  error: { code, message },
});

export async function ingest(
  bytes: Uint8Array,
  opts: { extractor?: Extractor; timeoutMs?: number } = {},
): Promise<IngestResult> {
  if (!isPdf(bytes)) return fail('NOT_PDF');

  // Sin extractBook (MH-3) aún no hay extractor por defecto
  const extractor = opts.extractor;
  if (!extractor) return fail('WORKER_CRASH', 'No hay ningún extractor de PDF disponible.');

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
