import { ingest, type IngestResult } from './ingest';

// pdf.worker.mjs, al importarse dentro de un worker, se engancha a `self` y manda sus propios mensajes
// ("ready", etc.) al hilo principal: el nuestro va etiquetado para distinguirlo.
export interface IngestMessage { kind: 'ingest-result'; result: IngestResult }

self.onmessage = async (e: MessageEvent<unknown>) => {
  if (!(e.data instanceof Uint8Array)) return;
  const msg: IngestMessage = { kind: 'ingest-result', result: await ingest(e.data) };
  self.postMessage(msg);
};
