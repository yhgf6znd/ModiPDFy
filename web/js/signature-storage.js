const DATABASE_NAME = "modipdfy-signatures";
const STORE_NAME = "signatures";
const DATABASE_VERSION = 1;

function openDatabase() {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("Local signature storage is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local signature storage could not be opened."));
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Local signature storage operation failed."));
    });
  } finally {
    database.close();
  }
}

export async function listStoredSignatures() {
  return (await withStore("readonly", (store) => store.getAll())) ?? [];
}

export function saveStoredSignature(signature) {
  return withStore("readwrite", (store) => store.put(signature));
}

export function deleteStoredSignature(id) {
  return withStore("readwrite", (store) => store.delete(id));
}
