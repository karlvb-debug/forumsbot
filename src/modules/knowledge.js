import { state } from './state.js';
import { db, storageAvailable, idbRequest, idbDone } from './db.js';
import { KB_STORE } from './constants.js';
import { normalizeDocumentEntry } from './state.js';
import { getEmbedding, getEmbeddingsBatch } from './api.js';
import { cosineSimilarity } from './utils.js';

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
  return (state.documents || []).slice().sort((a, b) => {
    const sa = a.sortOrder ?? new Date(a.createdAt).getTime();
    const sb = b.sortOrder ?? new Date(b.createdAt).getTime();
    return sa - sb;
  });
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

// ── Semantic document retrieval ──────────────────────────────────────────────
// When reference documents exceed the prompt budget, rank their paragraphs by
// embedding similarity to the session's current focus and include the most
// relevant excerpts, instead of blindly truncating every document from the
// top (which made the bottom half of long documents invisible to actors).

/** Split text into ~paragraph chunks of at most maxWords, merging small ones. */
export function splitIntoParagraphs(text, maxWords = 120) {
  const wc = (t) => t.split(/\s+/).filter(Boolean).length;
  const rawParas = String(text || '').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of rawParas) {
    if (wc(p) > maxWords) {
      if (buf) { out.push(buf); buf = ''; }
      const words = p.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += maxWords) {
        out.push(words.slice(i, i + maxWords).join(' '));
      }
      continue;
    }
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (wc(candidate) <= maxWords) { buf = candidate; continue; }
    out.push(buf);
    buf = p;
  }
  if (buf) out.push(buf);
  return out;
}

function contentHash(text) {
  const t = String(text || "");
  let hash = 2166136261;
  for (let i = 0; i < t.length; i++) {
    hash ^= t.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

// Paragraph vectors per doc, invalidated by content hash / model change —
// a document embeds once and stays cached until it is edited.
const _docVectorCache = new Map();
const DOC_VECTOR_CACHE_MAX = 12;

async function getDocParagraphVectors(doc, model) {
  const hash = contentHash(doc.content || '');
  const cached = _docVectorCache.get(doc.id);
  if (cached && cached.hash === hash && cached.model === model) return cached;
  const paragraphs = splitIntoParagraphs(doc.content || '');
  const vectors = await getEmbeddingsBatch(paragraphs);
  if (!Array.isArray(vectors) || vectors.length !== paragraphs.length) {
    throw new Error('Embedding count mismatch for document paragraphs.');
  }
  const entry = { hash, model, paragraphs, vectors };
  _docVectorCache.set(doc.id, entry);
  if (_docVectorCache.size > DOC_VECTOR_CACHE_MAX) {
    _docVectorCache.delete(_docVectorCache.keys().next().value);
  }
  return entry;
}

// Rendered-section cache, keyed per ROUND rather than per turn: within a
// round every actor sees the same byte-identical section (KV-cache prefix
// stability), and the selection re-adapts when the round advances.
let _sectionCache = null;

/**
 * Reference section with embedding-ranked excerpts. Falls back to the even
 * per-doc split whenever everything fits the budget, no embedding model is
 * usable, or any embedding call fails.
 */
export async function buildReferenceSectionSemantic(docs, { maxSection = KB_SECTION_MAX_DEFAULT } = {}) {
  if (!docs || !docs.length) return "";
  const totalChars = docs.reduce((s, d) => s + (d.content || '').length, 0);
  if (totalChars <= maxSection) return buildReferenceSection(docs, { maxSection });

  const model = state.settings?.embeddingModel || state.settings?.model || '';
  if (!model || state.ui?.embeddingProbeResult?.ok === false) {
    return buildReferenceSection(docs, { maxSection });
  }

  const cacheKey = [
    model, state.currentRound || 0, maxSection,
    docs.map(d => `${d.id}:${contentHash(d.content || '')}`).join('|')
  ].join('§');
  if (_sectionCache?.key === cacheKey) return _sectionCache.value;

  try {
    const queryText = [
      state.scenario?.task,
      state.scenario?.premise,
      ...(state.messages || []).slice(-3).map(m => String(m.content || '').slice(0, 300))
    ].filter(Boolean).join('\n') || 'general session context';
    const queryVec = await getEmbedding(queryText);

    const scored = [];
    for (const doc of docs) {
      const { paragraphs, vectors } = await getDocParagraphVectors(doc, model);
      paragraphs.forEach((text, idx) => {
        if (Array.isArray(vectors[idx])) {
          scored.push({ doc, idx, text, score: cosineSimilarity(queryVec, vectors[idx]) });
        }
      });
    }
    scored.sort((a, b) => b.score - a.score);

    let used = 0;
    const picked = [];
    for (const s of scored) {
      if (used + s.text.length > maxSection) continue;
      picked.push(s);
      used += s.text.length;
      if (used >= maxSection * 0.95) break;
    }
    if (!picked.length) return buildReferenceSection(docs, { maxSection });

    // Group selections by document; keep document order, then paragraph order.
    const byDoc = new Map();
    for (const doc of docs) byDoc.set(doc.id, { doc, parts: [] });
    for (const s of picked) byDoc.get(s.doc.id).parts.push(s);
    const sections = [...byDoc.values()]
      .filter(({ parts }) => parts.length)
      .map(({ doc, parts }) => {
        parts.sort((a, b) => a.idx - b.idx);
        return `### ${doc.title || "Untitled"} [read-only] (most relevant excerpts)\n${parts.map(p => p.text).join('\n\n')}`;
      });
    const value = "## Reference Documents\n" + sections.join("\n\n---\n\n");
    _sectionCache = { key: cacheKey, value };
    return value;
  } catch (err) {
    console.warn('[knowledge] semantic doc retrieval failed — using even split:', err?.message || err);
    return buildReferenceSection(docs, { maxSection });
  }
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


export function newDocument(overrides = {}) {
  const now = new Date().toISOString();
  const maxOrder = (state.documents || []).reduce((m, d) => Math.max(m, d.sortOrder ?? 0), 0);
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
    sortOrder: maxOrder + 1,
    ...overrides
  };
}

export function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
