import { state } from './state.js';
import { db, storageAvailable, idbRequest, idbDone } from './db.js';
import { KB_STORE } from './constants.js';
import { normalizeDocumentEntry } from './state.js';

// ── CRUD ────────────────────────────────────────────────────────────────────

// Sync KB_STORE → state.documents on load. Called once from DocumentsPanel on mount.
export async function syncIdbToDocuments() {
  if (!storageAvailable || !db) return;
  try {
    const tx = db.transaction(KB_STORE, "readonly");
    const idbEntries = await idbRequest(tx.objectStore(KB_STORE).getAll());
    if (!state.documents) state.documents = [];
    const existingIds = new Set(state.documents.map(d => d.id));
    for (const idbEntry of idbEntries) {
      if (!existingIds.has(idbEntry.id)) {
        state.documents.push(normalizeDocumentEntry(idbEntry));
        existingIds.add(idbEntry.id);
      }
    }
  } catch (err) {
    console.warn('[knowledge] syncIdbToDocuments failed:', err.message);
  }
}

export async function getAllKbEntries() {
  return (state.documents || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function putKbEntry(entry) {
  if (!state.documents) state.documents = [];
  // Persist the SAME normalized shape we hold in memory, so a reload via
  // syncIdbToDocuments doesn't surface a different shape than was just saved.
  const normalized = normalizeDocumentEntry(entry);
  const idx = state.documents.findIndex(e => e.id === normalized.id);
  if (idx >= 0) {
    state.documents[idx] = normalized;
  } else {
    state.documents.push(normalized);
  }
  if (storageAvailable && db) {
    try {
      const tx = db.transaction(KB_STORE, "readwrite");
      tx.objectStore(KB_STORE).put(normalized);
      await idbDone(tx);
    } catch (err) {
      console.warn('[knowledge] putKbEntry failed:', err.message);
    }
  }
}

export async function deleteKbEntry(id) {
  state.documents = (state.documents || []).filter(e => e.id !== id);
  if (storageAvailable && db) {
    try {
      const tx = db.transaction(KB_STORE, "readwrite");
      tx.objectStore(KB_STORE).delete(id);
      await idbDone(tx);
    } catch (err) {
      console.warn('[knowledge] deleteKbEntry failed:', err.message);
    }
  }
}

// ── Query helpers ────────────────────────────────────────────────────────────

function matchesActor(entry, actorId) {
  return entry.enabled !== false &&
    (entry.target === "all" || (Array.isArray(entry.target) && entry.target.includes(actorId)));
}

export async function getKbEntriesForActor(actorId) {
  return (state.documents || []).filter(e => matchesActor(e, actorId));
}

export async function getKbEntriesForDirector() {
  return (state.documents || []).filter(e => e.enabled !== false && e.target === "all");
}

// Split documents into editable (aiEditable=true) and reference (aiEditable=false) sets
// filtered to what the given actorId can see.
export function splitDocuments(actorId) {
  const all = (state.documents || []).filter(e => matchesActor(e, actorId));
  return {
    editable: all.filter(e => e.aiEditable),
    reference: all.filter(e => !e.aiEditable),
  };
}

export function getDocumentsForActor(actorId) {
  return (state.documents || []).filter(e => matchesActor(e, actorId));
}

// ── Prompt injection ─────────────────────────────────────────────────────────

// Formats KB entries into a prompt section.
// maxSection is in chars (~4 chars per token).
// Default is a conservative fallback used when no model context info is available.
const KB_SECTION_MAX_DEFAULT = 3000;

// Water-fill allocation: give each entry what it actually needs, redistribute
// leftover space to entries that need more. A 500-char entry doesn't consume
// space reserved for a 60K-char entry.
function allocateChars(needs, budget) {
  const alloc = needs.map(() => 0);
  let pending = needs.map((_, i) => i);
  let rem = budget;
  while (pending.length > 0 && rem > 0) {
    const share = Math.floor(rem / pending.length);
    if (share === 0) break;
    const next = [];
    for (const i of pending) {
      if (needs[i] <= share) {
        alloc[i] = needs[i];
        rem -= needs[i];
      } else {
        next.push(i);
      }
    }
    if (next.length === pending.length) {
      // No entry fits fully in its share — distribute remaining evenly
      const even = Math.floor(rem / next.length);
      for (const i of next) alloc[i] = even;
      break;
    }
    pending = next;
  }
  return alloc;
}

// Builds a line-numbered editable document block for actor prompts.
// Each document shows full content with 1-based line numbers.
export function buildEditableDocSection(docs) {
  if (!docs || !docs.length) return "";
  const parts = docs.map(doc => {
    const lines = (doc.content || "").split("\n");
    const numbered = lines.map((l, i) => `${String(i + 1).padStart(3)} | ${l}`).join("\n");
    return `#### ${doc.title || "Untitled"}  [id: ${doc.id}]\n${numbered || "(Empty document — start drafting.)"}`;
  });
  const editInstructions = [
    `To edit: add "documentEdits": [{"documentId":"<id>","op":"append|replace|full","content":"...","startLine":N,"endLine":M}]`,
    `For "replace": startLine/endLine refer to the numbers shown above. For "append": content is added after existing text. For "full": replaces entire content.`,
    `Omit documentEdits entirely if you have no changes.`
  ].join("\n");
  return "### Working Documents\n\n" + parts.join("\n\n") + "\n\n" + editInstructions;
}

// Builds a read-only reference section (25% budget, water-fill allocation).
export function buildReferenceSection(docs, { maxSection = KB_SECTION_MAX_DEFAULT } = {}) {
  if (!docs || !docs.length) return "";
  const labeled = docs.map(e => ({ ...e, title: `${e.title || "Untitled"} [read-only]` }));
  const raw = buildKbSection(labeled, { maxSection });
  return raw.replace("## Knowledge Base", "## Reference Documents");
}

export function buildKbSection(entries, { maxSection = KB_SECTION_MAX_DEFAULT } = {}) {
  if (!entries || !entries.length) return "";
  // Estimate overhead: header + separators + titles
  const overhead = 18 + Math.max(0, entries.length - 1) * 8
    + entries.reduce((s, e) => s + (e.title || "Untitled").length + 5, 0);
  const contentBudget = Math.max(100, maxSection - overhead);
  const needs = entries.map(e => (e.content || "").length);
  const allocs = allocateChars(needs, contentBudget);

  const parts = entries.map((e, i) => {
    const cap = allocs[i];
    const content = (e.content || "").slice(0, cap);
    const suffix = needs[i] > cap ? "\n…[truncated]" : "";
    return `### ${e.title || "Untitled"}\n${content}${suffix}`;
  });
  return "## Knowledge Base\n" + parts.join("\n\n---\n\n");
}

// ── URL fetch ────────────────────────────────────────────────────────────────

// Calls the server-side web_read proxy (same one used by Researcher actors).
export async function fetchUrlContent(url) {
  const res = await fetch("/api/tool-execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "web_read", args: { url } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text || "";
}

// ── Entry factory ────────────────────────────────────────────────────────────

export function newKbEntry(overrides = {}) {
  return newDocument({ aiEditable: false, ...overrides });
}

export function newDocument(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    type: "document",
    content: "",
    url: "",
    target: "all",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    aiEditable: false,
    versions: [],
    maxVersions: 20,
    lineAttribution: [],
    showAttribution: false,
    ...overrides
  };
}

export function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
