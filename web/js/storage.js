// storage.js — 本地存储（IndexedDB）。书只存在老人自己的手机里，不上传。
// 浏览器专用，不碰网络。Node 里没有 indexedDB，所以这块不在 Node 测。

const DB_NAME = 'renshengzhishu';
const DB_VERSION = 1;
const STORE = 'books';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveBook(session) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = store(db, 'readwrite').put(session);
    req.onsuccess = () => resolve(session);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBook(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = store(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listBooks() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = store(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBook(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = store(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function exportBookFile(session) {
  // 导出成文件（含授权信息），交给人处理加密与下载。
  const payload = JSON.stringify(session, null, 2);
  return new Blob([payload], { type: 'application/json' });
}

export async function importBookText(text) {
  try {
    const obj = JSON.parse(text);
    if (!obj || !obj.id || !obj.person) throw new Error('bad shape');
    return obj;
  } catch (e) {
    throw new Error('这不是一本《人生之书》的文件');
  }
}
