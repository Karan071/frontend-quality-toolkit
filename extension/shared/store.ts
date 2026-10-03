import type { ScreenshotRecord } from '@ftk/screenshot-engine';

/**
 * Screenshots live in IndexedDB on the extension origin. The service worker
 * writes them and the side panel reads them — large blobs never travel through
 * message passing, and nothing leaves the browser.
 */
const DB_NAME = 'ftk';
const STORE = 'screenshots';
export const MAX_STORED = 40;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function saveScreenshot(record: ScreenshotRecord): Promise<void> {
  await run('readwrite', (s) => s.put(record));
  const all = await listScreenshots();
  const extra = all.slice(MAX_STORED);
  for (const old of extra) await deleteScreenshot(old.id);
}

/** Newest first. */
export async function listScreenshots(): Promise<ScreenshotRecord[]> {
  const all = ((await run<ScreenshotRecord[]>('readonly', (s) => s.getAll())) ?? []) as ScreenshotRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getScreenshot(id: string): Promise<ScreenshotRecord | undefined> {
  return run<ScreenshotRecord>('readonly', (s) => s.get(id));
}

export async function deleteScreenshot(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function clearScreenshots(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}
