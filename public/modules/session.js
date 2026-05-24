import { PRESET_VERSION, RECENT_MESSAGE_LIMIT, defaultState } from './constants.js';
import { state, setState, normalizeState, saveState } from './state.js';
import { render, syncFormFromState, els, switchSidebarTab, renderQuickStartPreview } from './render.js';
import { setStatus } from './api.js';
import { clearMessages, clearChunks, putMessages, putChunk, countChunks, getRecentMessages, getAllMessages, getAllChunks, putSession, getAllSessions, deleteSession } from './db.js';
import { chatCompletion } from './api.js';
import { colors } from './constants.js';
import {
  cleanStoredMessage,
  normalizeQuickStartConfig,
  normalizeQuickStartActor,
  cleanConfigText,
  stripCodeFence,
  extractBalancedObjects,
  stringifyList,
  sanitizeJsonString
} from './utils.js';

export { cleanStoredMessage };

export function savePreset() {
  const preset = {
    version: PRESET_VERSION,
    settings: state.settings,
    memory: {
      enabled: state.memory.enabled,
      pinnedFacts: state.memory.pinnedFacts,
      sharedSummary: state.memory.sharedSummary,
      openQuestions: state.memory.openQuestions,
      dmState: state.memory.dmState
    },
    scenario: state.scenario,
    dm: state.dm,
    actors: state.actors,
    autoStop: {
      ...state.autoStop,
      roundsRun: 0,
      status: "Auto-stop ready."
    }
  };
  downloadJson(`forum-preset-${slugDate()}.json`, preset);
}

export async function exportSession() {
  const messages = await getAllMessages();
  const chunks = await getAllChunks();

  // Read export mode from UI (falls back to 'debug' if element absent)
  const modeEl = document.getElementById('exportModeSelect');
  const mode = modeEl ? modeEl.value : 'debug';

  let payload;

  if (mode === 'markdown') {
    const lines = [
      `# ${state.scenario.title || 'Forum Session'}`,
      state.scenario.premise ? `**Premise:** ${state.scenario.premise}` : '',
      state.scenario.objective ? `**Objective:** ${state.scenario.objective}` : '',
      '---'
    ].filter(Boolean);

    let turnNum = 0;
    for (const msg of messages) {
      if (msg.type === 'system') continue;
      if (msg.type === 'skip') {
        lines.push(`\n*[${msg.speaker} passed]*`);
        continue;
      }
      turnNum++;
      const timeStr = msg.createdAt
        ? new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
      const speakerLabel = msg.type === 'dm' ? `${msg.speaker} (Director)` : (msg.speaker || 'Unknown');
      lines.push(`\n## ${speakerLabel} — Turn ${turnNum}${timeStr ? ` *(${timeStr})*` : ''}`);
      if (state.settings.showThoughts && msg.thought) {
        lines.push(`> ${msg.thought.replace(/\n/g, '\n> ')}`);
        lines.push('');
      }
      if (msg.content) lines.push(msg.content);
    }

    if (Array.isArray(state.anchors) && state.anchors.length) {
      lines.push('\n---\n## Anchored Agreements');
      state.anchors.forEach(a => lines.push(`- **[${a.speaker}]** ${a.text}`));
    }
    if (state.outcomes?.finalRecommendation) {
      lines.push('\n---\n## Outcomes');
      lines.push(`**Recommendation:** ${state.outcomes.finalRecommendation}`);
      if (Array.isArray(state.outcomes.actionItems) && state.outcomes.actionItems.length) {
        lines.push('\n**Action Items:**');
        state.outcomes.actionItems.forEach(item => lines.push(`- ${item}`));
      }
    }

    const mdText = lines.join('\n');
    const blob = new Blob([mdText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `forum-session-${slugDate()}.md`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (mode === 'eval') {
    // Eval mode: metrics, settings, scenario, and diagnostics only — no message content
    const { calculateSessionMetrics } = await import('./telemetry.js');
    payload = {
      version: PRESET_VERSION,
      exportedAt: new Date().toISOString(),
      exportMode: 'eval',
      settings: {
        model: state.settings.model,
        mode: state.scenario.mode,
        temperature: state.settings.temperature
      },
      scenario: state.scenario,
      autoStop: {
        goal: state.autoStop.goal,
        roundsRun: state.autoStop.roundsRun
      },
      sessionMetrics: calculateSessionMetrics(messages, state.document.lineAttribution),
      telemetry: {
        currentAlignmentScore: state.telemetry?.currentAlignmentScore,
        alignmentHistory: state.telemetry?.alignmentHistory
      },
      diagnostics: {
        transitions: state.diagnostics?.transitions || [],
        warnings: state.diagnostics?.warnings || [],
        apiCallLogs: state.diagnostics?.apiCallLogs || [],
        parseFailures: state.diagnostics?.parseFailures || []
      }
    };
  } else if (mode === 'shareable') {
    // Shareable mode: transcript + outcomes, but strip traces, thoughts, and API logs
    const cleanMessages = messages.map(m => {
      const cleaned = { ...m };
      delete cleaned.trace;        // remove full prompt snapshots
      delete cleaned.thought;      // remove private thoughts
      delete cleaned.feedbackTag;  // keep rating but not reason tag
      return cleaned;
    });
    const cleanChunks = chunks.map(c => {
      const cleaned = { ...c };
      delete cleaned.vector;       // strip embedding vectors (privacy / size)
      return cleaned;
    });
    const cleanState = { ...state };
    delete cleanState.diagnostics; // strip raw API logs
    payload = {
      version: PRESET_VERSION,
      exportedAt: new Date().toISOString(),
      exportMode: 'shareable',
      ...cleanState,
      messages: cleanMessages,
      chunks: cleanChunks
    };
  } else {
    // Debug mode: full export with everything
    payload = {
      version: PRESET_VERSION,
      exportedAt: new Date().toISOString(),
      exportMode: 'debug',
      ...state,
      messages,
      chunks
    };
  }

  downloadJson(`forum-session-${mode}-${slugDate()}.json`, payload);
}

export async function copySessionToClipboard() {
  const messages = await getAllMessages();
  
  const header = [
    `# Forum Session Digest`,
    `**Title:** ${state.scenario.title || 'Untitled'}`,
    `**Mode:** ${state.scenario.mode || 'problem'}`,
    `**Premise:** ${state.scenario.premise || 'None'}`,
    `**Objective:** ${state.scenario.objective || 'None'}`,
    `---`,
    `## Memory State`,
    `**Pinned Facts:**\n${(Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : state.memory.pinnedFacts) || 'None'}`,
    `**Shared Summary:**\n${state.memory.sharedSummary || 'None'}`,
    `**Open Questions:**\n${(Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : state.memory.openQuestions) || 'None'}`,
    `**DM State:**\n${state.memory.dmState || 'None'}`,
    `---`,
    `## Transcript`
  ].join("\n");

  const formattedMessages = messages.map((msg) => {
    const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const typeLabel = msg.type || 'actor';
    const headerStr = `### ${msg.speaker || 'Unknown'} (${typeLabel}) - ${timeStr}`;
    
    const thoughtStr = msg.thought ? `**Thought:**\n${msg.thought}\n` : '';
    const contentStr = `**Message:**\n${msg.content || ''}`;
    
    return [headerStr, thoughtStr, contentStr].filter(Boolean).join('\n');
  }).join("\n\n");

  const fullText = [header, formattedMessages].join("\n\n");

  try {
    await navigator.clipboard.writeText(fullText);
    setStatus("Session copied to clipboard!", "ok");
  } catch (err) {
    setStatus("Copy failed. Check browser permissions.", "error");
    console.error("Clipboard copy failed:", err);
  }
}

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function slugDate() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export async function resetSession(fullReset = false) {
  try { await clearMessages(); } catch (err) { console.warn("clearMessages failed:", err); }
  try { await clearChunks(); } catch (err) { console.warn("clearChunks failed:", err); }

  if (fullReset) {
    setState(structuredClone(defaultState));
  } else {
    const keepConfig = {
      settings: state.settings,
      scenario: state.scenario,
      dm: { ...state.dm, thoughts: "" },
      actors: state.actors.map((actor) => ({ ...actor, thoughts: "" })),
      memory: {
        ...structuredClone(defaultState.memory),
        enabled: state.memory.enabled,
        migratedLegacyMessages: true
      },
      outcomes: structuredClone(defaultState.outcomes),
      autoStop: {
        ...state.autoStop,
        roundsRun: 0,
        status: "Auto-stop ready."
      }
    };
    setState(normalizeState({ ...structuredClone(defaultState), ...keepConfig, messages: [], turnQueue: [] }));
  }

  saveState();
  syncFormFromState();
  render();
  switchSidebarTab("setup");
  setStatus(fullReset ? "Everything reset to defaults." : "Conversation cleared.", "ok");
}

export async function confirmAndResetSession() {
  const ok = window.confirm("Clear the conversation, actor memories, summaries, and archived memory? Your setup (actors, scenario, settings) will be kept.");
  if (!ok) return;
  await resetSession(false);
}

export async function confirmAndFullReset() {
  const ok = window.confirm("Full factory reset: clear EVERYTHING and restore all defaults? This cannot be undone.");
  if (!ok) return;
  await resetSession(true);
}

export function loadPresetFile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const preset = JSON.parse(String(reader.result || "{}"));
      setState(normalizeState({
        ...state,
        settings: { ...state.settings, ...preset.settings },
        memory: { ...state.memory, ...preset.memory },
        autoStop: { ...state.autoStop, ...preset.autoStop, roundsRun: 0 },
        scenario: { ...state.scenario, ...preset.scenario },
        dm: { ...state.dm, ...preset.dm },
        actors: preset.actors || state.actors
      }));
      if (Array.isArray(preset.messages)) {
        await clearMessages();
        await putMessages(preset.messages.map(cleanStoredMessage));
        state.messages = await getRecentMessages(RECENT_MESSAGE_LIMIT);
      }
      if (Array.isArray(preset.chunks)) {
        await clearChunks();
        for (const chunk of preset.chunks) {
          await putChunk(chunk);
        }
      }
      state.memory.archivedCount = await countChunks();
      saveState();
      syncFormFromState();
      render();
      setStatus("Preset loaded.", "ok");
    } catch {
      setStatus("That preset file could not be read.", "error");
    }
  });
  reader.readAsText(file);
}

export function addActor(isResearcher = false) {
  const index = state.actors.length;
  if (isResearcher) {
    state.actors.push({
      id: crypto.randomUUID(),
      name: "Researcher",
      role: "Research Specialist",
      persona: "You are the Specialized Research Agent. Your job is to analyze the discussion, identify open questions or unverified claims, search the web or read documents/webpages to find facts and data, and compile structured research briefs. You do not express personal opinions or argue; you only report objective facts and source URLs.",
      goal: "Provide up-to-date objective research and answer open questions to ground the discussion.",
      voice: "Objective, fact-driven, structured with clear source citations.",
      thoughts: "",
      enabled: true,
      isResearcher: true,
      color: "#6e4c99"
    });
  } else {
    state.actors.push({
      id: crypto.randomUUID(),
      name: `Actor ${index + 1}`,
      role: "Participant",
      persona: "",
      goal: "",
      voice: "",
      thoughts: "",
      enabled: true,
      color: colors[index % colors.length]
    });
  }
  saveState();
  render();
}

export async function generateActorFromDescription() {
  if (!state.settings.model) {
    setStatus("Choose or type a model first.", "warn");
    return;
  }
  const description = window.prompt("Describe the actor you want (one line):", "");
  if (!description?.trim()) return;

  setStatus("Generating actor…", "ok");
  const system = [
    "You generate a single forum actor configuration from a one-line description.",
    "Return ONLY valid JSON with this exact shape (no markdown, no commentary):",
    '{"name":"","role":"","persona":"","goal":"","voice":""}'
  ].join("\n");
  const user = [
    `Description: ${description.trim()}`,
    `Forum scenario: ${state.scenario.title || "general discussion"}`,
    "Keep each field concise (1-2 sentences). Make name creative and specific to the context."
  ].join("\n");

  try {
    const raw = await chatCompletion(system, user, { temperature: 0.8, maxTokens: 400 });
    const cleaned = sanitizeJsonString(stripCodeFence(raw));
    const parsed = JSON.parse(cleaned);
    if (!parsed?.name) throw new Error("Invalid actor JSON returned.");
    const index = state.actors.length;
    state.actors.push({
      id: crypto.randomUUID(),
      name: String(parsed.name || `Actor ${index + 1}`).slice(0, 50),
      role: String(parsed.role || "Participant").slice(0, 80),
      persona: String(parsed.persona || "").slice(0, 400),
      goal: String(parsed.goal || "").slice(0, 200),
      voice: String(parsed.voice || "").slice(0, 200),
      thoughts: "",
      enabled: true,
      expanded: true,
      color: colors[index % colors.length]
    });
    saveState();
    render();
    setStatus(`Actor "${parsed.name}" created.`, "ok");
  } catch (err) {
    setStatus(`Actor generation failed: ${err.message}`, "error");
  }
}

export async function generateQuickStart() {
  if (!state.settings.model) {
    setQuickStartStatus("Choose or type a model first.", "warn");
    return;
  }
  if (!state.ui.quickStartPrompt) {
    setQuickStartStatus("Describe the forum you want first.", "warn");
    return;
  }

  setQuickStartBusy(true);
  setQuickStartStatus("Generating setup...", "pending");
  const system = [
    "You create complete configurations for a local multi-actor AI forum.",
    "Return only valid JSON. Do not include markdown or commentary.",
    "Use concise but vivid actors. Keep local-model context limits in mind.",
    "Choose creative, context-specific, and diverse names for the actors. Avoid generic name lists (like Anya, Ben, Chloe, Dave or Alice, Bob, Charlie) unless they match the scenario's theme.",
    "The JSON must have this shape:",
    "{\"scenario\":{\"mode\":\"problem|story|freeform\",\"title\":\"\",\"premise\":\"\",\"objective\":\"\"},\"dm\":{\"enabled\":true,\"name\":\"\",\"persona\":\"\",\"seesPrivateThoughts\":false},\"actors\":[{\"name\":\"\",\"role\":\"\",\"persona\":\"\",\"goal\":\"\",\"voice\":\"\",\"thoughts\":\"\",\"enabled\":true}],\"memory\":{\"pinnedFacts\":\"\",\"sharedSummary\":\"\",\"openQuestions\":\"\",\"dmState\":\"\"}}"
  ].join("\n");
  const user = [
    `User request:\n${state.ui.quickStartPrompt}`,
    "Generate 3-5 actors unless the request clearly needs a different count.",
    "Use mode problem for collaborative problem solving, story for scenes/roleplay, and freeform for open-ended discussion."
  ].join("\n\n");

  try {
    const temp = state.ui.quickStartTemperature ?? 0.8;
    const content = await chatCompletion(system, user, { temperature: temp, maxTokens: 1800 });
    state.ui.quickStartDraft = normalizeQuickStartConfig(parseQuickStartConfig(content));
    state.ui.quickStartStatus = "Generated setup ready for review.";
    saveState();
    renderQuickStartPreview();
  } catch (error) {
    state.ui.quickStartDraft = null;
    setQuickStartStatus(error.message || "Quick Start generation failed.", "error");
    renderQuickStartPreview();
  } finally {
    setQuickStartBusy(false);
  }
}

export function parseQuickStartConfig(content) {
  const cleaned = sanitizeJsonString(stripCodeFence(content));
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    for (const candidate of extractBalancedObjects(cleaned)) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Try the next object-shaped response.
      }
    }
  }
  throw new Error("The model did not return usable setup JSON.");
}

export { normalizeQuickStartConfig, normalizeQuickStartActor, cleanConfigText };

export async function applyQuickStartConfig() {
  const draft = state.ui.quickStartDraft;
  if (!draft) {
    setQuickStartStatus("Generate a setup first.", "warn");
    return;
  }
  const normalized = normalizeQuickStartConfig(draft);
  const hadConversation = state.messages.length > 0;
  state.scenario = normalized.scenario;
  state.dm = {
    ...state.dm,
    enabled: normalized.dm.enabled,
    name: normalized.dm.name,
    persona: normalized.dm.persona,
    seesPrivateThoughts: normalized.dm.seesPrivateThoughts,
    thoughts: ""
  };
  state.actors = normalized.actors;
  state.memory = {
    ...state.memory,
    pinnedFacts: normalized.memory.pinnedFacts,
    sharedSummary: normalized.memory.sharedSummary,
    openQuestions: normalized.memory.openQuestions,
    dmState: normalized.memory.dmState,
    pendingPinnedFacts: [],
    turnsSinceSummary: 0,
    lastSummaryMessageId: ""
  };
  state.turnQueue = [];
  state.ui.quickStartDraft = null;
  state.ui.quickStartStatus = "Setup applied.";
  saveState();
  syncFormFromState();
  render();
  if (hadConversation) {
    // addMessage is in turns.js — import lazily to avoid circular dep
    const { addMessage } = await import('./turns.js');
    await addMessage({
      type: "system",
      speaker: "System",
      content: `Setup changed by AI Quick Start: ${state.scenario.title}.`,
      color: "var(--coral)"
    });
  }
  switchSidebarTab("setup");
}

export function discardQuickStartConfig() {
  state.ui.quickStartDraft = null;
  state.ui.quickStartStatus = "Generated setup discarded.";
  saveState();
  renderQuickStartPreview();
}

export function setQuickStartBusy(value) {
  els.generateQuickStart.disabled = value;
  els.applyQuickStart.disabled = value || !state.ui.quickStartDraft;
  els.discardQuickStart.disabled = value || !state.ui.quickStartDraft;
}

export function setQuickStartStatus(message) {
  state.ui.quickStartStatus = message;
  els.quickStartStatus.textContent = message;
  saveState();
}

// ─── Session History ────────────────────────────────────────────────────────

export async function saveCurrentSession() {
  if (!state.messages.length) return;

  if (!state._currentSessionId) {
    state._currentSessionId = crypto.randomUUID();
  }

  const session = {
    id: state._currentSessionId,
    timestamp: new Date().toISOString(),
    scenarioTitle: state.scenario.title || 'Untitled',
    actorCount: state.actors.filter(a => a.enabled).length,
    messageCount: state.messages.length,
    messages: state.messages,
    scenario: { ...state.scenario },
    memory: { ...state.memory },
    actors: state.actors,
    dm: { ...state.dm }
  };

  // Keep at most 20 sessions; remove oldest others if over limit
  const existing = await getAllSessions();
  const others = existing.filter(s => s.id !== state._currentSessionId);
  for (const old of others.slice(19)) {
    await deleteSession(old.id);
  }

  await putSession(session);
}

export async function loadSession(session) {
  if (!session) return;

  await clearMessages();
  if (Array.isArray(session.messages) && session.messages.length) {
    await putMessages(session.messages.map(cleanStoredMessage));
    state.messages = await getRecentMessages(RECENT_MESSAGE_LIMIT);
  } else {
    state.messages = [];
  }

  if (session.scenario) state.scenario = { ...state.scenario, ...session.scenario };
  if (session.memory) state.memory = { ...state.memory, ...session.memory };
  if (Array.isArray(session.actors)) state.actors = session.actors;
  if (session.dm) state.dm = { ...state.dm, ...session.dm };

  state._currentSessionId = session.id;

  saveState();
  syncFormFromState();
  render();
  setStatus(`Session "${session.scenarioTitle}" loaded.`, 'ok');
}

export async function forkSessionAtMessage(messageId) {
  const idx = state.messages.findIndex(m => m.id === messageId);
  if (idx < 0) return;

  const confirmed = window.confirm(
    `Fork conversation from message ${idx + 1} of ${state.messages.length}?\n\nHistory up to this point will be kept. Future turns will diverge into a new branch.`
  );
  if (!confirmed) return;

  // Save the current session before forking so it can be resumed
  await saveCurrentSession();

  // Truncate messages to include this message and all before it
  const truncated = state.messages.slice(0, idx + 1);

  // Write truncated messages and clear orphaned memory chunks
  await clearMessages();
  await clearChunks();
  await putMessages(truncated.map(cleanStoredMessage));
  state.messages = await getRecentMessages(RECENT_MESSAGE_LIMIT);

  // New session ID for the fork
  state._currentSessionId = crypto.randomUUID();

  // Reset memory state so summarizer starts fresh from the truncated transcript
  state.memory.sharedSummary = "";
  state.memory.openQuestions = [];
  state.memory.recentDeltas = [];
  state.memory.cycleCount = 0;
  state.memory.turnsSinceSummary = 0;
  state.memory.lastSummaryMessageId = "";
  state.memory.isSummarizing = false;

  // Clear private thoughts that reference pre-fork context
  state.actors.forEach(a => { a.thoughts = ""; });
  state.dm.thoughts = "";

  // Reset turn-related ephemeral state
  state.turnQueue = [];
  state.autoRunning = false;

  saveState();
  render();
  setStatus(`Forked from message ${idx + 1}. ${truncated.length} messages kept.`, 'ok');
}
