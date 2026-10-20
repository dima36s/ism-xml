/* ИСМ XML — хранилище документов в браузере пользователя (IndexedDB).
   Документы и общий реестр никуда не отправляются. Если IndexedDB недоступна
   (приватный режим, запрет сайта), данные живут только до закрытия вкладки. */
(() => {
  'use strict';
  const DB = 'ism-xml';
  const VER = 1;
  let dbp = null;
  let memory = null; // запасной вариант без IndexedDB

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, VER); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) {
      if (!memory) memory = { docs: new Map(), meta: new Map() };
      return fn(null, memory[store]);
    }
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let out;
      Promise.resolve(fn(os, null)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const wrap = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

  const store = {
    async available() { return !!(await open()); },
    async allDocs() {
      return tx('docs', 'readonly', (os, mem) => (mem ? Array.from(mem.values()) : wrap(os.getAll())))
        .then((list) => (list || []).sort((a, b) => (a.order ?? a.addedAt) - (b.order ?? b.addedAt)));
    },
    async putDoc(doc) { return tx('docs', 'readwrite', (os, mem) => (mem ? mem.set(doc.key, doc) : wrap(os.put(doc)))); },
    async deleteDoc(key) { return tx('docs', 'readwrite', (os, mem) => (mem ? mem.delete(key) : wrap(os.delete(key)))); },
    async getMeta(key, fallback) {
      const v = await tx('meta', 'readonly', (os, mem) => (mem ? mem.get(key) : wrap(os.get(key))));
      return v ? v.value : fallback;
    },
    async setMeta(key, value) { return tx('meta', 'readwrite', (os, mem) => (mem ? mem.set(key, { key, value }) : wrap(os.put({ key, value })))); },
  };

  window.ISM = window.ISM || {};
  window.ISM.store = store;
})();
