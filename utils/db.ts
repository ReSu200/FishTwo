// 文件夹句柄持久化（IndexedDB），用于「记住最近打开的文件夹」及历史记录

const DB_NAME = 'fishtwo';
const DB_VERSION = 1;
const STORE = 'handles';
const LAST_DIR_KEY = 'lastDir';
const HISTORY_KEY = 'dirHistory';
const MAX_HISTORY = 5;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function readKey<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function writeKeys(entries: Record<string, unknown>): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const [k, v] of Object.entries(entries)) store.put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function deleteKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const key of keys) store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** 读取最近文件夹历史（最近的在前，最多 5 个） */
export async function loadDirHistory(): Promise<FileSystemDirectoryHandle[]> {
  const list = await readKey<FileSystemDirectoryHandle[]>(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

/** 读取最近打开的文件夹句柄（优先历史第一条，其次旧版单条记录） */
export async function loadLastDir(): Promise<FileSystemDirectoryHandle | undefined> {
  const history = await loadDirHistory();
  if (history.length > 0) return history[0];
  return readKey<FileSystemDirectoryHandle>(LAST_DIR_KEY);
}

/** 保存文件夹：加入历史（去重、最近置顶，最多 5 个），并设为最近打开 */
export async function saveLastDir(handle: FileSystemDirectoryHandle): Promise<void> {
  const history = await loadDirHistory();
  const rest: FileSystemDirectoryHandle[] = [];
  for (const h of history) {
    let same = false;
    try {
      same = await handle.isSameEntry(h);
    } catch {
      same = h.name === handle.name;
    }
    if (!same) rest.push(h);
  }
  const next = [handle, ...rest].slice(0, MAX_HISTORY);
  await writeKeys({ [LAST_DIR_KEY]: handle, [HISTORY_KEY]: next });
}

/** 清除全部最近文件夹记录（F9） */
export async function clearDirHistory(): Promise<void> {
  await deleteKeys([LAST_DIR_KEY, HISTORY_KEY]);
}

/** 从历史中移除单个文件夹（F8 的「移除记录」） */
export async function removeDirFromHistory(handle: FileSystemDirectoryHandle): Promise<void> {
  const history = await loadDirHistory();
  const rest: FileSystemDirectoryHandle[] = [];
  let removed = false;
  for (const h of history) {
    let same = false;
    try {
      same = await handle.isSameEntry(h);
    } catch {
      same = h.name === handle.name;
    }
    if (same) removed = true;
    else rest.push(h);
  }

  const last = await readKey<FileSystemDirectoryHandle>(LAST_DIR_KEY);
  let lastSame = false;
  if (last) {
    try {
      lastSame = await handle.isSameEntry(last);
    } catch {
      lastSame = last.name === handle.name;
    }
  }
  if (!removed && !lastSame) return;

  if (rest.length > 0) await writeKeys({ [HISTORY_KEY]: rest });
  else await deleteKeys([HISTORY_KEY]);
  if (lastSame) await deleteKeys([LAST_DIR_KEY]);
}
