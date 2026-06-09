import { state, saveState, logTransition } from './state.js';
import { chatStructured, setStatus } from './api.js';
import { showToast } from './uiStore.js';
import { WORD_LIMITS } from './constants.js';
import { trimWords } from './utils.js';
import { buildDocumentWriterPromptLine, buildDocumentWriterSchema } from './schemas.js';
import { actorCanReadDocument, countWords, ensureDefaultWriter, putKbEntry, resolveDesignatedWriter } from './knowledge.js';
import { hideBackgroundActivity, showBackgroundActivity, updateBackgroundActivity } from './streamingStore.js';

function nowIso() {
  return new Date().toISOString();
}

export function hashDocumentContent(content) {
  const text = String(content || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function lineNumbered(content) {
  const lines = String(content || "").split("\n");
  return lines.map((line, i) => `${String(i + 1).padStart(3)} | ${line}`).join("\n");
}

function recentTranscript() {
  return (state.messages || [])
    .filter(m => ['user', 'actor', 'dm', 'system'].includes(m.type))
    .slice(-12)
    .map(m => `[${m.speaker || m.type}] ${trimWords(m.content || m.text || '', 160)}`)
    .join("\n");
}

function selectionText(doc, selection) {
  if (!selection) return "";
  const lines = String(doc.content || "").split("\n");
  const start = Math.max(1, Number(selection.startLine) || 1);
  const end = Math.max(start, Number(selection.endLine) || start);
  return lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(3)} | ${line}`).join("\n");
}

export function resolveWritableDocument(docId) {
  return (state.documents || []).find(d => d.id === docId && d.enabled !== false && d.aiEditable);
}

export function resolveTaskWriter(doc) {
  const docWriter = doc?.writerId
    ? (state.actors || []).find(a => a.id === doc.writerId && a.enabled && a.canWriteDocuments)
    : null;
  return docWriter || resolveDesignatedWriter();
}

export function createDocumentTask({ documentId, instruction, actorId = "", selection = null }) {
  const doc = resolveWritableDocument(documentId);
  if (!doc) throw new Error("Choose a writable, available document first.");
  const writer = actorId
    ? (state.actors || []).find(a => a.id === actorId && a.enabled && a.canWriteDocuments)
    : resolveTaskWriter(doc);
  if (!writer) throw new Error("Choose or create an active document writer first.");
  if (!actorCanReadDocument(doc, writer.id)) throw new Error(`${writer.name} cannot read this document.`);
  const task = {
    id: crypto.randomUUID(),
    documentId,
    actorId: writer.id,
    instruction: String(instruction || "").trim() || "Update this document from the recent discussion.",
    selection,
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    error: ""
  };
  if (!Array.isArray(state.documentTasks)) state.documentTasks = [];
  state.documentTasks.push(task);
  saveState();
  return task;
}

export function ensureWriterForDocuments() {
  const writer = ensureDefaultWriter();
  saveState();
  return writer;
}

export function applyEditsToContent(content, edits, documentId) {
  let next = String(content || "");
  for (const edit of Array.isArray(edits) ? edits : []) {
    if (edit.documentId !== documentId) continue;
    if (edit.op === "full") {
      next = String(edit.content || "");
    } else if (edit.op === "append") {
      next = next + (next ? "\n\n" : "") + String(edit.content || "");
    } else if (edit.op === "replace") {
      const lines = next.split("\n");
      const s = Math.max(0, (Number(edit.startLine) || 1) - 1);
      const e = Math.min(lines.length - 1, (Number(edit.endLine) || s + 1) - 1);
      next = [...lines.slice(0, s), String(edit.content || ""), ...lines.slice(e + 1)].join("\n");
    }
  }
  return next;
}

function sanitizeDocumentEdits(edits, documentId) {
  return (Array.isArray(edits) ? edits : [])
    .filter(edit => edit && edit.documentId === documentId && ['append', 'replace', 'full'].includes(edit.op))
    .map(edit => ({
      documentId,
      op: edit.op,
      content: String(edit.content || ""),
      ...(edit.op === "replace" ? {
        startLine: Math.max(1, Number(edit.startLine) || 1),
        endLine: Math.max(1, Number(edit.endLine) || Number(edit.startLine) || 1),
      } : {})
    }))
    .filter(edit => edit.content.trim().length > 0);
}

export async function runDocumentTask(taskId, signal = null) {
  const task = (state.documentTasks || []).find(t => t.id === taskId);
  if (!task) throw new Error("Document task not found.");
  const doc = resolveWritableDocument(task.documentId);
  if (!doc) throw new Error("The target document is no longer writable.");
  const writer = (state.actors || []).find(a => a.id === task.actorId && a.enabled && a.canWriteDocuments);
  if (!writer) throw new Error("The assigned writer is not active.");
  if (!actorCanReadDocument(doc, writer.id)) throw new Error(`${writer.name} cannot read this document.`);

  task.status = "running";
  task.updatedAt = nowIso();
  task.error = "";
  saveState();
  setStatus(`${writer.name} is drafting document changes...`, "pending");
  const activityId = showBackgroundActivity(`${writer.name} is drafting`, `Preparing proposed edits for ${doc.title || "Untitled document"}.`, writer.color || 'var(--accent)');

  const system = [
    `You are ${writer.name}, the designated document writer for this forum.`,
    writer.role ? `Role: ${writer.role}` : "",
    writer.persona ? `Persona: ${writer.persona}` : "",
    writer.goal ? `Goal: ${writer.goal}` : "",
    writer.voice ? `Writing voice: ${writer.voice}` : "",
    state.settings?.globalStyleEnabled === false || !String(state.settings?.globalStylePrompt || "").trim()
      ? ""
      : `GLOBAL STYLE: ${String(state.settings.globalStylePrompt).trim()}`,
    "You are not taking a normal conversation turn. Your only job is to propose document edits for the user's review.",
    "Use the discussion as source material, but write coherent document prose in your assigned voice.",
    "Do not invent settled decisions that are not supported by the transcript.",
    buildDocumentWriterPromptLine()
  ].filter(Boolean).join("\n");

  const selected = selectionText(doc, task.selection);
  const user = [
    `Scenario: ${state.scenario?.title || "Untitled forum"}`,
    state.scenario?.task ? `Task: ${state.scenario.task}` : "",
    `Task: ${task.instruction}`,
    "",
    `Target document: ${doc.title || "Untitled"} [id: ${doc.id}]`,
    doc.purpose ? `Purpose: ${doc.purpose}` : "",
    doc.format ? `Format: ${doc.format}` : "",
    selected ? `Selected lines to focus on:\n${selected}` : "",
    "",
    `Full target document with line numbers:\n${lineNumbered(doc.content || "") || "(empty document)"}`,
    "",
    `Recent transcript:\n${recentTranscript() || "No transcript yet."}`,
  ].filter(Boolean).join("\n");

  try {
    updateBackgroundActivity(activityId, { detail: 'Reading the transcript and target document.' });
    const result = await chatStructured(system, user, buildDocumentWriterSchema(), {
      temperature: writer.temperature ?? state.settings.temperature,
      maxTokens: writer.maxTokens || state.settings.maxTokens,
      signal,
      tier: 'reason'
    });
    const edits = sanitizeDocumentEdits(result.documentEdits, doc.id);
    if (!edits.length) throw new Error("Writer returned no applicable document edits.");
    updateBackgroundActivity(activityId, { detail: 'Building a preview for review.' });
    const previewContent = applyEditsToContent(doc.content || "", edits, doc.id);
    const proposal = {
      id: crypto.randomUUID(),
      taskId: task.id,
      documentId: doc.id,
      actorId: writer.id,
      writerName: writer.name,
      summary: String(result.summary || "Proposed document update.").slice(0, 240),
      edits,
      previewContent,
      baseHash: hashDocumentContent(doc.content || ""),
      status: "pending",
      createdAt: nowIso(),
      resolvedAt: ""
    };
    if (!Array.isArray(state.pendingDocumentEdits)) state.pendingDocumentEdits = [];
    state.pendingDocumentEdits.unshift(proposal);
    task.status = "proposed";
    task.updatedAt = nowIso();
    saveState();
    logTransition("document_proposal_created", { documentId: doc.id, writer: writer.name, edits: edits.length });
    setStatus(`${writer.name} proposed document changes.`, "ok");
    return proposal;
  } catch (err) {
    task.status = "failed";
    task.error = err?.message || "Document writing failed.";
    task.updatedAt = nowIso();
    saveState();
    setStatus(task.error, "error");
    throw err;
  } finally {
    hideBackgroundActivity(activityId);
  }
}

export async function createAndRunDocumentTask(options, signal = null) {
  const task = createDocumentTask(options);
  return runDocumentTask(task.id, signal);
}

async function commitEditsToDoc(doc, nextContent, writerName) {
  const prev = doc.content || "";
  doc.versions = [...(doc.versions || []), { author: writerName, content: prev, timestamp: nowIso() }].slice(-(doc.maxVersions || 20));
  doc.content = nextContent;
  doc.updatedAt = nowIso();
  doc.wordCount = countWords(nextContent);
  await putKbEntry(doc);
}

export async function acceptDocumentProposal(proposalId) {
  const proposal = (state.pendingDocumentEdits || []).find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return false;
  const doc = resolveWritableDocument(proposal.documentId);
  if (!doc) {
    proposal.status = "conflicted";
    proposal.resolvedAt = nowIso();
    saveState();
    return false;
  }
  if (hashDocumentContent(doc.content || "") !== proposal.baseHash) {
    proposal.status = "conflicted";
    proposal.resolvedAt = nowIso();
    saveState();
    return false;
  }
  await commitEditsToDoc(doc, proposal.previewContent, proposal.writerName);
  proposal.status = "accepted";
  proposal.resolvedAt = nowIso();
  saveState();
  logTransition("document_proposal_accepted", { documentId: doc.id, writer: proposal.writerName });
  return true;
}

export function rejectDocumentProposal(proposalId) {
  const proposal = (state.pendingDocumentEdits || []).find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return false;
  proposal.status = "rejected";
  proposal.resolvedAt = nowIso();
  saveState();
  logTransition("document_proposal_rejected", { documentId: proposal.documentId, writer: proposal.writerName });
  return true;
}

// ── Scribe autonomy ─────────────────────────────────────────────────────────────
// Four modes live on state.documentWriting.scribeMode:
//   manual       — Scribe never self-initiates; only panel / inline-comment fires it.
//   ask          — Scribe judges each turn; posts a yes/no suggestion before drafting.
//   auto_review  — Scribe judges and drafts; user accepts/rejects the proposal.
//   auto_apply   — Scribe judges, drafts, and applies directly (versioned, undoable).
// Across modes the Scribe is told it MAY return an empty edits array to mean
// "nothing worth recording this turn" — that's the gating mechanism.

function pickScribeTargetDoc(writer) {
  const docs = (state.documents || []).filter(d => d.enabled !== false && d.aiEditable);
  if (!docs.length) return null;
  const ownDoc = docs.find(d => d.writerId === writer.id && actorCanReadDocument(d, writer.id));
  if (ownDoc) return ownDoc;
  return docs.find(d => actorCanReadDocument(d, writer.id)) || null;
}

async function judgeAndDraft(writer, doc, signal, { instruction = null } = {}) {
  const lineNumbered = (content) => {
    const lines = String(content || "").split("\n");
    return lines.map((line, i) => `${String(i + 1).padStart(3)} | ${line}`).join("\n");
  };
  const recent = recentTranscript();
  const system = [
    `You are ${writer.name}, the designated document writer for this forum.`,
    writer.role ? `Role: ${writer.role}` : "",
    writer.persona ? `Persona: ${writer.persona}` : "",
    writer.goal ? `Goal: ${writer.goal}` : "",
    writer.voice ? `Writing voice: ${writer.voice}` : "",
    state.settings?.globalStyleEnabled === false || !String(state.settings?.globalStylePrompt || "").trim()
      ? ""
      : `GLOBAL STYLE: ${String(state.settings.globalStylePrompt).trim()}`,
    "You are running an autonomous pass between conversation turns. Your job is to decide whether the discussion has produced anything worth recording in the target document, and if so, draft the edit.",
    "IMPORTANT: It is fine — and often correct — to return an empty documentEdits array. Only write when the recent turns introduced a concrete decision, a new fact, a resolved question, or content the user would clearly want captured. Do NOT record speculation, restatements of earlier content, or your own commentary.",
    "When you do write, produce coherent prose in your assigned voice, not a literal paste of the transcript.",
    buildDocumentWriterPromptLine()
  ].filter(Boolean).join("\n");

  const user = [
    `Scenario: ${state.scenario?.title || "Untitled forum"}`,
    state.scenario?.task ? `Task: ${state.scenario.task}` : "",
    instruction ? `User request: ${instruction}` : "Task: Decide whether the latest turns introduced anything worth capturing in the target document. If yes, propose the edit. If no, return documentEdits: [].",
    "",
    `Target document: ${doc.title || "Untitled"} [id: ${doc.id}]`,
    doc.purpose ? `Purpose: ${doc.purpose}` : "",
    doc.format ? `Format: ${doc.format}` : "",
    "",
    `Full target document with line numbers:\n${lineNumbered(doc.content || "") || "(empty document)"}`,
    "",
    `Recent transcript:\n${recent || "No transcript yet."}`,
  ].filter(Boolean).join("\n");

  const result = await chatStructured(system, user, buildDocumentWriterSchema(), {
    temperature: writer.temperature ?? state.settings.temperature,
    maxTokens: writer.maxTokens || state.settings.maxTokens,
    signal,
    tier: 'reason'
  });
  const edits = sanitizeDocumentEdits(result.documentEdits, doc.id);
  return {
    edits,
    summary: String(result.summary || "").slice(0, 240),
    previewContent: edits.length ? applyEditsToContent(doc.content || "", edits, doc.id) : (doc.content || "")
  };
}

async function postTranscriptNote(payload) {
  try {
    const mod = await import('./turns.js');
    await mod.addMessage(payload);
  } catch (err) {
    console.warn('[scribe] could not post transcript note:', err?.message || err);
  }
}

export async function runScribePass(signal = null, { instruction = null } = {}) {
  const mode = state.documentWriting?.scribeMode || "manual";
  if (mode === "manual" && !instruction) return null;

  const writer = resolveDesignatedWriter();
  if (!writer) return null;
  const doc = pickScribeTargetDoc(writer);
  if (!doc) return null;

  let draft;
  try {
    draft = await judgeAndDraft(writer, doc, signal, { instruction });
  } catch (err) {
    if (err?.name === "AbortError") return null;
    console.warn('[scribe] judgeAndDraft failed:', err?.message || err);
    return null;
  }
  if (!draft.edits.length) return null;

  const effectiveMode = instruction ? "auto_apply" : mode;

  if (effectiveMode === "ask") {
    const suggestion = {
      id: crypto.randomUUID(),
      documentId: doc.id,
      actorId: writer.id,
      writerName: writer.name,
      writerColor: writer.color || "var(--accent)",
      summary: draft.summary || `Capture an update in ${doc.title || "the document"}.`,
      edits: draft.edits,
      previewContent: draft.previewContent,
      baseHash: hashDocumentContent(doc.content || ""),
      status: "pending",
      createdAt: nowIso()
    };
    if (!Array.isArray(state.pendingScribeSuggestions)) state.pendingScribeSuggestions = [];
    state.pendingScribeSuggestions.unshift(suggestion);
    saveState();
    logTransition("scribe_suggestion_offered", { documentId: doc.id, writer: writer.name });
    // Notify regardless of which panel is open — the suggestion UI only lives in
    // the Doc Editor, so without this the user would miss it while watching the chat.
    showToast(`${writer.name} suggests updating "${doc.title || 'a document'}" — review in the Doc Editor.`, "info");
    return suggestion;
  }

  if (effectiveMode === "auto_review") {
    const proposal = {
      id: crypto.randomUUID(),
      taskId: null,
      documentId: doc.id,
      actorId: writer.id,
      writerName: writer.name,
      summary: draft.summary || "Proposed document update.",
      edits: draft.edits,
      previewContent: draft.previewContent,
      baseHash: hashDocumentContent(doc.content || ""),
      status: "pending",
      createdAt: nowIso(),
      resolvedAt: ""
    };
    if (!Array.isArray(state.pendingDocumentEdits)) state.pendingDocumentEdits = [];
    state.pendingDocumentEdits.unshift(proposal);
    saveState();
    logTransition("scribe_proposal_created", { documentId: doc.id, writer: writer.name, edits: draft.edits.length });
    return proposal;
  }

  // auto_apply (default + after-ask-accept path)
  await commitEditsToDoc(doc, draft.previewContent, writer.name);
  saveState();
  logTransition("scribe_auto_applied", { documentId: doc.id, writer: writer.name, edits: draft.edits.length });
  await postTranscriptNote({
    type: "system",
    speaker: writer.name,
    color: writer.color || "var(--accent)",
    content: `Updated "${doc.title || "Untitled"}": ${draft.summary || "applied document edits"}.`
  });
  return { applied: true, documentId: doc.id, summary: draft.summary };
}

export async function acceptScribeSuggestion(suggestionId) {
  const suggestion = (state.pendingScribeSuggestions || []).find(s => s.id === suggestionId);
  if (!suggestion || suggestion.status !== "pending") return false;
  const doc = resolveWritableDocument(suggestion.documentId);
  if (!doc) {
    suggestion.status = "conflicted";
    suggestion.resolvedAt = nowIso();
    saveState();
    return false;
  }
  if (hashDocumentContent(doc.content || "") !== suggestion.baseHash) {
    suggestion.status = "conflicted";
    suggestion.resolvedAt = nowIso();
    saveState();
    return false;
  }
  await commitEditsToDoc(doc, suggestion.previewContent, suggestion.writerName);
  suggestion.status = "accepted";
  suggestion.resolvedAt = nowIso();
  saveState();
  logTransition("scribe_suggestion_accepted", { documentId: doc.id, writer: suggestion.writerName });
  return true;
}

export function dismissScribeSuggestion(suggestionId) {
  const suggestion = (state.pendingScribeSuggestions || []).find(s => s.id === suggestionId);
  if (!suggestion || suggestion.status !== "pending") return false;
  suggestion.status = "dismissed";
  suggestion.resolvedAt = nowIso();
  saveState();
  logTransition("scribe_suggestion_dismissed", { documentId: suggestion.documentId });
  return true;
}

const INLINE_SCRIBE_CMD = /\b(scribe|writer)[,!:]?\s+(write|capture|record|update|draft|note|add)\b|\badd\s+(that|this)\s+to\s+(the\s+)?(doc|document|notes?)\b|\bwrite\s+(this|that|it)\s+(up|down)\b|\bupdate\s+(the\s+)?(doc|document)\b/i;

export function detectInlineScribeRequest(text) {
  const str = String(text || "");
  if (!str.trim()) return null;
  if (!INLINE_SCRIBE_CMD.test(str)) return null;
  return str.trim().slice(0, 500);
}

export function cancelDocumentTask(taskId) {
  const task = (state.documentTasks || []).find(t => t.id === taskId);
  if (!task || task.status === 'running') return false;
  task.status = 'cancelled';
  task.updatedAt = nowIso();
  saveState();
  return true;
}

export function dismissDocumentTask(taskId) {
  state.documentTasks = (state.documentTasks || []).filter(t => t.id !== taskId);
  saveState();
}

export async function retryDocumentTask(taskId, signal = null) {
  const task = (state.documentTasks || []).find(t => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = 'pending';
  task.error = '';
  task.updatedAt = nowIso();
  saveState();
  return runDocumentTask(taskId, signal);
}
