import type { Book } from '../core/types';

export interface Progress { index: number; wpm: number }
export interface Store {
  readonly mode: 'idb' | 'memory';
  readonly warning: string | null;
  saveBook(key: string, book: Book): Promise<void>;
  loadBook(key: string): Promise<Book | null>;
  saveProgress(key: string, p: Progress): Promise<void>;
  loadProgress(key: string): Promise<Progress | null>;
  setLastBook(key: string): Promise<void>;
  getLastBook(): Promise<string | null>;
}

const DB_NAME = 'fast-reading';
const DB_VERSION = 1;
const BOOKS = 'books';
const PROGRESS = 'progress';
const META = 'meta';
const LAST_BOOK = 'lastBook';
type StoreName = typeof BOOKS | typeof PROGRESS | typeof META;

const WARN_UNAVAILABLE =
  'No se puede guardar en este navegador: el libro y el progreso se perderán al cerrar la pestaña.';
const WARN_QUOTA =
  'No queda espacio para guardar: a partir de ahora el libro y el progreso solo se conservan hasta cerrar la pestaña.';
const WARN_FAILED =
  'Falló el guardado local: a partir de ahora el libro y el progreso solo se conservan hasta cerrar la pestaña.';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [BOOKS, PROGRESS, META]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function idbGet<T>(db: IDBDatabase, store: StoreName, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

// Resuelve al completar la transacción: la cuota puede saltar en el commit, no solo en put().
function idbPut(db: IDBDatabase, store: StoreName, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.objectStore(store).put(value, key);
  });
}

function isQuota(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

class HybridStore implements Store {
  mode: 'idb' | 'memory';
  warning: string | null;
  // Espejo de todo lo escrito/leído en la sesión, para no perderlo al caer a memoria.
  private books = new Map<string, Book>();
  private progress = new Map<string, Progress>();
  private lastBook: string | null = null;

  constructor(private db: IDBDatabase | null, warning: string | null) {
    this.mode = db ? 'idb' : 'memory';
    this.warning = warning;
  }

  private fallBack(err: unknown): void {
    this.mode = 'memory';
    this.warning = isQuota(err) ? WARN_QUOTA : WARN_FAILED;
    try {
      this.db?.close();
    } catch {
      // ya inservible
    }
    this.db = null;
  }

  private async write(store: StoreName, key: string, value: unknown): Promise<void> {
    if (!this.db) return;
    try {
      await idbPut(this.db, store, key, value);
    } catch (err) {
      this.fallBack(err);
    }
  }

  private async read<T>(store: StoreName, key: string): Promise<T | undefined> {
    if (!this.db) return undefined;
    try {
      return await idbGet<T>(this.db, store, key);
    } catch (err) {
      this.fallBack(err);
      return undefined;
    }
  }

  async saveBook(key: string, book: Book): Promise<void> {
    this.books.set(key, book);
    await this.write(BOOKS, key, book);
  }

  async loadBook(key: string): Promise<Book | null> {
    const cached = this.books.get(key);
    if (cached) return cached;
    const book = await this.read<Book>(BOOKS, key);
    if (!book) return null;
    this.books.set(key, book);
    return book;
  }

  async saveProgress(key: string, p: Progress): Promise<void> {
    const copy = { index: p.index, wpm: p.wpm };
    this.progress.set(key, copy);
    await this.write(PROGRESS, key, copy);
  }

  async loadProgress(key: string): Promise<Progress | null> {
    const cached = this.progress.get(key);
    if (cached) return { ...cached };
    const p = await this.read<Progress>(PROGRESS, key);
    if (!p) return null;
    this.progress.set(key, p);
    return { ...p };
  }

  async setLastBook(key: string): Promise<void> {
    this.lastBook = key;
    await this.write(META, LAST_BOOK, key);
  }

  async getLastBook(): Promise<string | null> {
    if (this.lastBook !== null) return this.lastBook;
    const key = await this.read<string>(META, LAST_BOOK);
    if (typeof key !== 'string') return null;
    this.lastBook = key;
    return key;
  }
}

export async function createStore(idb?: IDBFactory | null): Promise<Store> {
  const factory = idb === undefined ? (globalThis.indexedDB ?? null) : idb;
  if (!factory) return new HybridStore(null, WARN_UNAVAILABLE);
  try {
    return new HybridStore(await openDb(factory), null);
  } catch {
    return new HybridStore(null, WARN_UNAVAILABLE);
  }
}
