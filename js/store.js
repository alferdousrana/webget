// Browser-only storage. No server database:
//  - task list (metadata)  -> localStorage
//  - downloaded bytes      -> IndexedDB, in ~4 MB blobs, so a paused download
//                             survives a page reload and can resume from where it stopped.

const DB_NAME = 'wdm-files';
const STORE = 'chunks';
const TASKS_KEY = 'wdm.tasks.v1';

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const key = (id, i) => `${id}:${String(i).padStart(6, '0')}`;
const range = (id) => IDBKeyRange.bound(`${id}:`, `${id}:\uffff`);

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(s, (r) => { result = r; })).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

export const putChunk = (id, index, blob) => tx('readwrite', (s) => { s.put(blob, key(id, index)); });

export const deleteChunks = (id) => tx('readwrite', (s) => { s.delete(range(id)); });

export function getChunks(id) {
  return tx('readonly', (s, done) => {
    const req = s.getAll(range(id));
    req.onsuccess = () => done(req.result || []);
  });
}

export async function getFile(task) {
  const chunks = await getChunks(task.id);
  return new Blob(chunks, { type: task.mime || 'application/octet-stream' });
}

export async function storedBytes(id) {
  const chunks = await getChunks(id);
  return { count: chunks.length, bytes: chunks.reduce((n, b) => n + b.size, 0) };
}

export async function clearAllChunks() {
  return tx('readwrite', (s) => { s.clear(); });
}

export function loadTasks() {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); }
  catch { return []; }
}

export function saveTasks(tasks) {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch {}
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
