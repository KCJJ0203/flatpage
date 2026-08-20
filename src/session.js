/**
 * Crash insurance for the document currently being scanned.
 *
 * This is NOT a document library. It holds exactly one in-progress document,
 * and export wipes it. It exists because on iOS the camera can push Safari out
 * of memory, reloading the page underneath the user — see Risk 1 in the spec.
 */

const DB_NAME = 'flatpage';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = run(store);
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Every failure path here is swallowed deliberately. Persistence is a safety
 * net: if private browsing or a storage quota denies it, scanning must carry on
 * regardless rather than dying on a feature the user never asked for.
 */
export async function saveSession(pages) {
  let db;
  try {
    db = await openDb();
    try {
      await transact(db, 'readwrite', (store) => store.put({ savedAt: Date.now(), pages }, KEY));
    } finally {
      if (db) db.close();
    }
  } catch (err) {
    console.warn('session save failed, continuing without it:', err);
  }
}

export async function loadSession() {
  let db;
  try {
    db = await openDb();
    try {
      const record = await transact(db, 'readonly', (store) => store.get(KEY));
      return record?.pages ?? [];
    } finally {
      if (db) db.close();
    }
  } catch (err) {
    console.warn('session load failed:', err);
    return [];
  }
}

export async function clearSession() {
  let db;
  try {
    db = await openDb();
    try {
      await transact(db, 'readwrite', (store) => store.delete(KEY));
    } finally {
      if (db) db.close();
    }
  } catch (err) {
    console.warn('session clear failed:', err);
  }
}
