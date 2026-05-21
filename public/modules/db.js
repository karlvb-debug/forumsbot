import { DB_NAME, DB_VERSION, MESSAGE_STORE, CHUNK_STORE } from './constants.js';
import { state } from './state.js';
import { cleanStoredMessage } from './utils.js';

export let db = null;
export let storageAvailable = false;
export let storageWarning = '';

let fallbackMessages = [];
let fallbackChunks = [];

export async function initializeMemoryStorage() {
  const legacyMessages = state.messages.map(cleanStoredMessage);
  try {
    db = await openMemoryDb();
    storageAvailable = true;
    if (legacyMessages.length && !state.memory.migratedLegacyMessages) {
      await putMessages(legacyMessages);
      state.memory.migratedLegacyMessages = true;
    }
    state.messages = await getRecentMessages(80);
    state.memory.archivedCount = await countChunks();
  } catch (error) {
    storageAvailable = false;
    storageWarning = "IndexedDB unavailable; history will not survive reload.";
    fallbackMessages = legacyMessages;
    state.messages = fallbackMessages.slice(-80);
    console.warn(error);
  }
  if (!state.ui.activeTab) {
    state.ui.activeTab = state.messages.length ? "conversation" : "setup";
  }
  // saveState is called by the caller (main.js) after initializeMemoryStorage
}

export function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn("IndexedDB open timed out (blocked by another tab?). Continuing without DB.");
      reject(new Error("IndexedDB open timed out."));
    }, 4000);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
        const messages = database.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
        messages.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: "id" });
        chunks.createIndex("createdAt", "createdAt");
      }
    });
    request.addEventListener("blocked", () => {
      console.warn("IndexedDB upgrade blocked by another tab. Close other Forum tabs and reload.");
    });
    request.addEventListener("success", () => { clearTimeout(timeout); resolve(request.result); });
    request.addEventListener("error", () => { clearTimeout(timeout); reject(request.error || new Error("IndexedDB failed to open.")); });
  });
}

export function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")));
  });
}

export function idbDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction aborted.")));
    transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")));
  });
}

export async function putMessage(message) {
  if (!storageAvailable || !db) {
    fallbackMessages.push(message);
    return;
  }
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  transaction.objectStore(MESSAGE_STORE).put(message);
  await idbDone(transaction);
}

export async function putMessages(messages) {
  if (!storageAvailable || !db) {
    fallbackMessages.push(...messages);
    return;
  }
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  const store = transaction.objectStore(MESSAGE_STORE);
  messages.forEach((message) => store.put(message));
  await idbDone(transaction);
}

export async function getAllMessages() {
  if (!storageAvailable || !db) return [...fallbackMessages].sort(byCreatedAt);
  const transaction = db.transaction(MESSAGE_STORE, "readonly");
  const messages = await idbRequest(transaction.objectStore(MESSAGE_STORE).getAll());
  return messages.map(cleanStoredMessage).sort(byCreatedAt);
}

export async function getRecentMessages(limit) {
  const messages = await getAllMessages();
  return messages.slice(-limit);
}

export async function clearMessages() {
  fallbackMessages = [];
  if (!storageAvailable || !db) return;
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  transaction.objectStore(MESSAGE_STORE).clear();
  await idbDone(transaction);
}

export async function putChunk(chunk) {
  if (!storageAvailable || !db) {
    fallbackChunks.push(chunk);
    state.memory.archivedCount = fallbackChunks.length;
    return;
  }
  const transaction = db.transaction(CHUNK_STORE, "readwrite");
  transaction.objectStore(CHUNK_STORE).put(chunk);
  await idbDone(transaction);
  state.memory.archivedCount = await countChunks();
}

export async function getAllChunks() {
  if (!storageAvailable || !db) return [...fallbackChunks].sort(byCreatedAt);
  const transaction = db.transaction(CHUNK_STORE, "readonly");
  const chunks = await idbRequest(transaction.objectStore(CHUNK_STORE).getAll());
  return chunks.sort(byCreatedAt);
}

export async function countChunks() {
  if (!storageAvailable || !db) return fallbackChunks.length;
  const transaction = db.transaction(CHUNK_STORE, "readonly");
  return idbRequest(transaction.objectStore(CHUNK_STORE).count());
}

export async function clearChunks() {
  fallbackChunks = [];
  state.memory.archivedCount = 0;
  if (!storageAvailable || !db) return;
  const transaction = db.transaction(CHUNK_STORE, "readwrite");
  transaction.objectStore(CHUNK_STORE).clear();
  await idbDone(transaction);
}

export function byCreatedAt(left, right) {
  return new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
}
