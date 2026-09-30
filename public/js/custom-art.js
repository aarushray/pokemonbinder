// Artwork for custom designs in the cart, kept in this browser (IndexedDB holds full-size images,
// which localStorage can't). Each cart line for a custom design stores only the artwork's id;
// the image itself is uploaded to Supabase Storage when the order is placed.
const CustomArt = (() => {
  const DB = 'tcgengrave';
  const STORE = 'custom-art';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const save = (id, blob) => run('readwrite', (s) => s.put(blob, id));
  const get = (id) => run('readonly', (s) => s.get(id));
  const remove = (id) => run('readwrite', (s) => s.delete(id));

  // Deletes artwork no cart on this browser uses any more (removed lines, emptied carts, the cart
  // discarded when someone logs in, ...).
  async function prune(usedIds) {
    const keys = await run('readonly', (s) => s.getAllKeys());
    await Promise.all(keys.filter((k) => !usedIds.has(k)).map(remove));
  }

  return { save, get, remove, prune };
})();
