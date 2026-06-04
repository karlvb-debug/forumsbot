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

// All enabled documents are visible to every actor. (Per-actor document
// targeting was removed — it defaulted to "all" everywhere and had no use.)
function isDocVisible(entry) {
  return entry.enabled !== false;
}

export async function getKbEntriesForActor() {
  return (state.documents || []).filter(isDocVisible);
}

export async function getKbEntriesForDirector() {
  return (state.documents || []).filter(isDocVisible);
}

// Split documents into editable (aiEditable=true) and reference (aiEditable=false) sets.
export function splitDocuments() {
  const all = (state.documents || []).filter(isDocVisible);
  return {
    editable: all.filter(e => e.aiEditable),
    reference: all.filter(e => !e.aiEditable),
  };
}

export function actorCanReadDocument(entry) {
  return isDocVisible(entry);
}

export function resolveDesignatedWriter() {
  const writerId = state.documentWriting?.designatedWriterId || "";
  const writer = (state.actors || []).find(a => a.id === writerId && a.enabled && a.canWriteDocuments);
  if (writer) return writer;
  return (state.actors || []).find(a => a.enabled && a.canWriteDocuments) || null;
}

export function ensureDefaultWriter() {
  let writer = resolveDesignatedWriter();
  if (writer) {
    if (!state.documentWriting) state.documentWriting = {};
    state.documentWriting.designatedWriterId = writer.id;
    return writer;
  }
  writer = {
    id: crypto.randomUUID(),
    name: "Writer",
    role: "Document writer",
    persona: "You synthesize the forum's discussion into clear, useful working documents.",
    goal: "Turn discussion, decisions, and critique into polished document updates.",
    voice: "Clear, structured, concise.",
    thoughts: "",
    relationships: {},
    enabled: true,
    expanded: false,
    temperature: 0.7,
    color: "#4a7fd4",
    canDirect: false,
    canManageCast: false,
    canResearch: false,
    canSeeThoughts: false,
    canInject: false,
    canWriteDocuments: true,
    authority: 50,
    cadence: { unit: "turn", n: 0 },
    actorMode: "participant",
    triggerOn: []
  };
  if (!Array.isArray(state.actors)) state.actors = [];
  state.actors.push(writer);
  if (!state.documentWriting) state.documentWriting = {};
  state.documentWriting.designatedWriterId = writer.id;
  return writer;
}

export function getDocumentsForActor() {
  return (state.documents || []).filter(isDocVisible);
}

// ── Prompt injection ─────────────────────────────────────────────────────────

// Formats KB entries into a prompt section.
// maxSection is in chars (~4 chars per token).
// Default is a conservative fallback used when no model context info is available.
const KB_SECTION_MAX_DEFAULT = 3000;

export function buildDocumentManifestSection(docs) {
  if (!docs || !docs.length) return "";
  const rows = docs.map(doc => {
    const status = doc.aiEditable ? "writable by designated writer" : "read-only";
    const words = doc.wordCount || countWords(doc.content || "");
    return [
      `- ${doc.title || "Untitled"} [id: ${doc.id}]`,
      `  status: ${status}; words: ${words}`,
      doc.purpose ? `  purpose: ${doc.purpose}` : "",
      doc.format ? `  format: ${doc.format}` : "",
      doc.content ? `  excerpt: ${trimWordsLocal(doc.content, 80)}` : ""
    ].filter(Boolean).join("\n");
  });
  return "### Documents\n" + rows.join("\n");
}

function trimWordsLocal(text, limit) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ")}...`;
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
  // Simple even per-document cap: split the budget equally and truncate each
  // document to its share. (Replaced an over-engineered water-fill allocator —
  // for the handful of docs in play, an even cap is indistinguishable and clear.)
  const perDoc = Math.max(200, Math.floor(maxSection / entries.length));
  const parts = entries.map(e => {
    const full = e.content || "";
    const content = full.slice(0, perDoc);
    const suffix = full.length > perDoc ? "\n…[truncated]" : "";
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
    purpose: "",
    format: "",
    writerId: "",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    aiEditable: false,
    versions: [],
    maxVersions: 20,
    ...overrides
  };
}

export function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
