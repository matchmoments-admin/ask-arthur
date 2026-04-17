// Per-install ECDSA P-256 identity for request signing.
//
// The private key is generated with extractable:false and stored in IndexedDB.
// Structured clone preserves non-extractable CryptoKey handles across service
// worker restarts, so signing works without the key ever leaving the browser.

const DB_NAME = "askarthur-identity";
const STORE = "keys";
const ITEM_KEY = "ecdsa-p256";

interface StoredKeypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

let inMemory: StoredKeypair | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOrCreateKeypair(): Promise<StoredKeypair> {
  if (inMemory) return inMemory;

  const db = await openDb();

  const existing = await idbGet<{
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
  }>(db, ITEM_KEY);

  if (existing) {
    inMemory = existing;
    return existing;
  }

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );

  // The private half is non-extractable; only the public half is exported.
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  // Strip runtime-only fields so the JWK round-trips cleanly server-side.
  delete publicKeyJwk.ext;
  delete publicKeyJwk.key_ops;

  const record: StoredKeypair = {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyJwk,
  };
  await idbPut(db, ITEM_KEY, record);
  inMemory = record;
  return record;
}

export async function resetKeypairForTesting(): Promise<void> {
  inMemory = null;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(ITEM_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
