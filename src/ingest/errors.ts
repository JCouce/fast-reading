export type IngestErrorCode = 'NOT_PDF' | 'NO_TEXT' | 'ENCRYPTED' | 'CORRUPT' | 'WORKER_CRASH' | 'TIMEOUT';

export const MESSAGES: Record<IngestErrorCode, string> = {
  NOT_PDF: 'El archivo no es un PDF.',
  NO_TEXT: 'El PDF no tiene texto que se pueda extraer.',
  ENCRYPTED: 'El PDF está cifrado o protegido con contraseña.',
  CORRUPT: 'El PDF está dañado y no se puede leer.',
  WORKER_CRASH: 'Algo ha fallado al procesar el PDF.',
  TIMEOUT: 'El PDF está tardando demasiado en procesarse.',
};

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'IngestError';
  }
}
