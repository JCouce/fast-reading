# Contrato v1 — lector RSVP

Interfaz pública que exigen los tests de aceptación. Los tests importan exactamente estas rutas y nombres. Todo lo demás (estructura interna, UI, estilos) es libre.

Stack: Vite 6 + TypeScript vanilla (strict) + pdfjs-dist 4. Todo en cliente. Tests unitarios en Vitest (entorno `node`), e2e en Playwright (Chromium) contra `npm run build && npm run preview` (puerto 4173).

Requisitos completos: `MUST_HAVES.md` (MH-9 y MH-16 quedan fuera de esta versión).

## Tipos compartidos — `src/core/types.ts`

```ts
export interface Book {
  words: string[];            // palabras en orden de lectura; sin vacíos ni espacios/saltos dentro
  paragraphStarts: number[];  // índices de `words` donde empieza un párrafo, ascendentes; incluye 0
  titles: Title[];            // títulos detectados, en orden
  listItemStarts: number[];   // índices de `words` donde empieza un elemento de lista (la viñeta · • se elimina), ascendentes
  pageCount: number;
}
export interface Title { start: number; end: number; text: string } // [start, end) en `words`; text = words.slice(start,end).join(' ')

export interface TimedToken {
  text: string;               // lo que se pinta (palabra o trozo)
  sentenceEnd?: boolean;      // última palabra de la frase
  sentenceLength?: number;    // nº de palabras de la frase a la que pertenece (para el ×3 de frases > 22)
  paragraphEnd?: boolean;     // última palabra del párrafo
  isTitle?: boolean;          // pertenece a un título
  listItemStart?: boolean;    // primera palabra de un elemento de lista
}
```

## Ingesta

### `src/ingest/validate.ts`
- `isPdf(bytes: Uint8Array): boolean` — true solo si los 5 primeros bytes son `%PDF-`. (MH-1)

### `src/ingest/normalize.ts`
- `normalizeText(s: string): string` — NFC, ligaduras (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) a letras, elimina soft hyphen U+00AD. No aplica NFKC: `n.º`, `1.ª` quedan intactos. (MH-7)

### `src/ingest/dehyphenate.ts`
- `resolveLineBreakHyphen(left: string, right: string): string` — `left` termina en `-` (guion de fin de renglón), `right` es la primera palabra del renglón siguiente. Si `right` contiene a su vez un guion, se mantiene el guion (`'lucha-' + 'huida-inmovilidad'` → `'lucha-huida-inmovilidad'`); si no, se une sin guion (`'des-' + 'integrada,'` → `'desintegrada,'`). La raya `–` (U+2013) nunca es guion de corte. Limitación conocida y aceptada: un compuesto de dos partes cortado justo en su guion (`'teórico-' + 'práctico'`) se une. (MH-4)

### `src/ingest/extract.ts`
- `extractBook(bytes: Uint8Array): Promise<Book>` — extrae con pdf.js. Debe funcionar tanto en Node (Vitest, usando `pdfjs-dist/legacy/build/pdf.mjs`) como dentro del Web Worker de la app. Aplica normalización, guiones de corte, detección de párrafos y de títulos. Lanza errores tipados (ver `IngestErrorCode`). (MH-3, 4, 5, 6, 8)
- Ojo con MH-6 en este libro: los 48 "APLICACIÓN DE LA ESTRATEGIA" del apéndice (págs. 186–213) usan la **misma fuente** que el cuerpo; ahí el título se reconoce por renglón corto, sin puntuación final y aislado entre párrafos. El cambio de fuente es una señal más, no la única.
- Viñetas de lista (`·`, `•`): no salen como palabra; se eliminan y la palabra siguiente se marca en `listItemStarts` (MH-8).
- Raya de inciso al final de renglón (`… hijos –⏎padres, …`): se pega a la primera palabra del renglón siguiente (`–padres,`), como pide MH-11. Ningún token puede ser solo `–`.
- Otros signos sueltos (`=`, `+`, `©`, `@`) son legítimos: no los elimines, solo no metas basura (controles, U+FFFD, uso privado).

### `src/ingest/ingest.ts`
```ts
export type IngestErrorCode = 'NOT_PDF' | 'NO_TEXT' | 'ENCRYPTED' | 'CORRUPT' | 'WORKER_CRASH' | 'TIMEOUT';
export type IngestResult =
  | { ok: true; book: Book }
  | { ok: false; error: { code: IngestErrorCode; message: string } };
export type Extractor = (bytes: Uint8Array) => Promise<Book>;
export function ingest(bytes: Uint8Array, opts?: { extractor?: Extractor; timeoutMs?: number }): Promise<IngestResult>;
```
- Nunca rechaza ni se queda colgada: siempre resuelve con `IngestResult`. `message` no vacío, en español.
- `extractor` por defecto = `extractBook`. Si el extractor rechaza con un error que no es de PDF → `WORKER_CRASH`. Si no resuelve en `timeoutMs` (por defecto 60000) → `TIMEOUT`.
- PDF sin texto extraíble → `NO_TEXT`; cifrado → `ENCRYPTED`; corrupto → `CORRUPT`; cabecera inválida → `NOT_PDF` (sin llamar al extractor). (MH-1, MH-2)

## Tokenización — `src/core/tokenize.ts`

```ts
export interface WordToken { text: string; sentenceEnd: boolean }
export function tokenize(text: string): WordToken[];
export function splitLong(word: string): string[];
```
- `tokenize`: separa por espacios en blanco; marca `sentenceEnd` según las reglas del español de MH-10; pega `¿ ¡ « ( –` a la palabra siguiente aunque haya espacio entre medias, y nunca deja esos signos solos ni al final de una palabra (MH-11).
- `splitLong`: si la palabra tiene 14 o más caracteres alfanuméricos: si contiene `-`, se parte tras cada guion (`'lucha-huida-inmovilidad'` → `['lucha-','huida-','inmovilidad']`); si no, en ⌈len/8⌉ trozos (len = longitud total del string) donde todos menos el último terminan en `-` añadido. La puntuación final queda en el último trozo. Palabras de menos de 14 → `[word]`. (MH-12)

## ORP — `src/core/orp.ts`
- `pivotIndex(word: string): number` — índice **dentro del string** del carácter pivote. La longitud cuenta solo letras y dígitos: 1 → 0ª letra; 2–5 → 1ª; 6–9 → 2ª; 10–13 → 3ª; ≥14 → 4ª (contando sobre las letras/dígitos, ignorando puntuación delante y detrás). Ej.: `pivotIndex('«¿Hoy') === 3`. (MH-18)

## Ritmo — `src/core/timing.ts`
```ts
export function durationMultiplier(t: TimedToken): number;
export function wordDuration(t: TimedToken, wpm: number): number; // (60000 / wpm) * durationMultiplier(t)
export type Frame = { kind: 'word'; index: number; duration: number } | { kind: 'blank'; duration: number };
export function buildSchedule(tokens: TimedToken[], wpm: number): Frame[];
```
- Multiplicador = el **máximo** de los que apliquen, con tope 4 (MH-21): longitud en letras/dígitos 6–9 ×1,2, 10–13 ×1,5; termina en `,` ×1,8; termina en `;` o `:` ×2; `sentenceEnd` ×2,2 (×3 si `sentenceLength > 22`); `paragraphEnd` ×3; `isTitle` ×3; número (la palabra sin puntuación es solo dígitos con `.`/`,` internos) ×(1,5 + 0,1 × nº de dígitos). Si no aplica ninguno, ×1.
- `buildSchedule`: un frame `word` por token (`index` = índice en `tokens`) con `duration = wordDuration`, e inserta un frame `blank` (duración > 0) tras cada token con `sentenceEnd`, antes del primer token de cada título y después del último, y antes de cada token con `listItemStart`. (MH-22)

## Reproductor — `src/core/player.ts`
```ts
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export interface Visibility { readonly hidden: boolean; onChange(cb: () => void): void }
export interface PlayerOptions {
  tokens: TimedToken[];
  clock: Clock;
  wpm?: number;                       // por defecto 300
  visibility?: Visibility;
  onWord?: (index: number, at: number) => void; // se llama al mostrar cada token, con clock.now()
  onBlank?: (at: number) => void;
  onEnd?: () => void;
}
export interface Player {
  readonly index: number;            // token actual
  readonly playing: boolean;
  readonly wpm: number;
  play(): void; pause(): void; toggle(): void;
  setWpm(wpm: number): void;          // se aplica desde el siguiente token; clamp 100–1000
  back(): void; forward(): void;      // MH-29
  seek(index: number): void;
  progress(): number;                 // index / tokens.length, en [0, 1]
  remainingMs(): number;              // MH-32
}
export function createPlayer(opts: PlayerOptions): Player;
```
- Sin drift (MH-23): el instante objetivo de cada token se calcula sumando duraciones desde el instante de `play()`, y se programa con `clock.setTimeout(fn, objetivo - clock.now())`.
- Rampa (MH-24): en cada `play()` los WPM efectivos empiezan en el 60 % y suben de forma monótona hasta el 100 % en el token 20 contado desde el play; el primer token dura al menos 200 ms.
- `setWpm` en marcha (MH-25): ni salta ni repite tokens.
- Visibilidad (MH-26): si `visibility.hidden` pasa a true mientras reproduce → `pause()`.
- Fin (MH-27): tras el último token se para (`playing = false`), llama a `onEnd` una vez, `index` queda en el último; no vuelve al principio.
- `back()` (MH-29): si van menos de 5 tokens desde el inicio de la frase actual, va al inicio de la frase anterior; si no, al inicio de la actual. `forward()` va al inicio de la frase siguiente. Las frases se delimitan con `sentenceEnd`.
- Reanudar (MH-30): si `play()` llega más de 3000 ms después del último `pause()`, antes vuelve al inicio de la frase actual.
- `remainingMs()` (MH-32): suma de las duraciones de `buildSchedule(tokens.slice(index), wpm)` (palabras y blancos), sin rampa.

## Persistencia

### `src/persist/cacheKey.ts`
- `export const PARSER_VERSION: string`
- `cacheKey(bytes: Uint8Array, parserVersion?: string): Promise<string>` — SHA-256 hex del contenido + versión (por defecto `PARSER_VERSION`). (MH-13)

### `src/persist/store.ts`
```ts
export interface Progress { index: number; wpm: number }
export interface Store {
  readonly mode: 'idb' | 'memory';
  readonly warning: string | null;    // mensaje para el usuario si se ha caído a memoria
  saveBook(key: string, book: Book): Promise<void>;
  loadBook(key: string): Promise<Book | null>;
  saveProgress(key: string, p: Progress): Promise<void>;
  loadProgress(key: string): Promise<Progress | null>;
  setLastBook(key: string): Promise<void>;
  getLastBook(): Promise<string | null>;
}
export function createStore(idb?: IDBFactory | null): Promise<Store>;
```
- Si `idb` es null/undefined en un entorno sin IndexedDB, o `open` falla → `mode: 'memory'` con `warning`. Si una escritura lanza `QuotaExceededError` → pasa a memoria, conserva lo ya guardado en esa sesión y fija `warning`. Nunca rechaza por fallo de almacenamiento. (MH-17)

## UI (e2e) — selectores `data-testid`

| testid | elemento |
|---|---|
| `file-input` | `<input type="file">` para elegir el PDF |
| `error` | mensaje de error visible (MH-1, MH-2) |
| `progress-bar` | barra de progreso de ingesta |
| `reader` | contenedor del lector; atributo `data-playing="true"|"false"` |
| `word` | palabra actual, con `aria-hidden="true"` |
| `pivot` | `<span>` hijo de `word` con la letra pivote |
| `play` | botón play/pausa (con etiqueta accesible) |
| `wpm` | texto con los WPM actuales (solo el número) |
| `context` | párrafo visible en pausa; `context-current` = la palabra actual resaltada dentro |
| `percent` | % leído |
| `remaining` | tiempo restante |

Hook de pruebas (siempre presente): `window.__rsvp = { show(text: string): void }` pinta `text` en `word` como si fuera el token actual, aplicando ORP.

Teclado (MH-28): Espacio play/pausa; ↑/↓ ±25 WPM en [100, 1000], defecto 300. Con el foco en un botón, Espacio no actúa dos veces.

Caché (MH-14): pdf.js y el worker se cargan bajo demanda (import dinámico); si el libro ya está en caché no se crea ningún `Worker` ni se pide ningún recurso de pdf.js. Al recargar, el último libro se abre solo (MH-15).

Comportamiento que asumen los e2e:
- Al cargar un libro **no** arranca solo: queda en pausa con `word` visible mostrando la primera palabra.
- `window.__rsvp.show(text)` pinta exactamente `text` en `word`, sin añadir caracteres.
- Todo control visible y no deshabilitado puede recibir el foco con teclado.
- Tras recargar con un libro en caché, se reanuda en pausa en la posición guardada y al reproducir salen sus palabras.
- El último libro y su posición se guardan antes de mostrar la primera palabra (o de forma que una recarga inmediata ya los encuentre).
