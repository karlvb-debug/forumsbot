import { state } from './state.js';
import { db, storageAvailable, idbRequest, idbDone } from './db.js';
import { KB_STORE } from './constants.js';

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function getAllKbEntries() {
  if (!storageAvailable || !db) return state.knowledgeBase || [];
  const tx = db.transaction(KB_STORE, "readonly");
  const result = await idbRequest(tx.objectStore(KB_STORE).getAll());
  return result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function putKbEntry(entry) {
  if (!storageAvailable || !db) {
    if (!state.knowledgeBase) state.knowledgeBase = [];
    state.knowledgeBase = state.knowledgeBase.filter(e => e.id !== entry.id);
    state.knowledgeBase.push(entry);
    return;
  }
  const tx = db.transaction(KB_STORE, "readwrite");
  tx.objectStore(KB_STORE).put(entry);
  await idbDone(tx);
}

export async function deleteKbEntry(id) {
  if (!storageAvailable || !db) {
    state.knowledgeBase = (state.knowledgeBase || []).filter(e => e.id !== id);
    return;
  }
  const tx = db.transaction(KB_STORE, "readwrite");
  tx.objectStore(KB_STORE).delete(id);
  await idbDone(tx);
}

// ── Query helpers ────────────────────────────────────────────────────────────

export async function getKbEntriesForActor(actorId) {
  const all = await getAllKbEntries();
  return all.filter(e =>
    e.enabled !== false &&
    (e.target === "all" || (Array.isArray(e.target) && e.target.includes(actorId)))
  );
}

export async function getKbEntriesForDirector() {
  const all = await getAllKbEntries();
  return all.filter(e => e.enabled !== false && e.target === "all");
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
  const res = await fetch("/api/tools", {
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
  return {
    id: crypto.randomUUID(),
    title: "",
    type: "document",   // "document" | "link"
    content: "",
    url: "",
    target: "all",      // "all" | string[] of actor IDs
    enabled: true,
    createdAt: new Date().toISOString(),
    wordCount: 0,
    ...overrides
  };
}

export function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
