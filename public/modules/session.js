import { PRESET_VERSION, RECENT_MESSAGE_LIMIT, defaultState } from './constants.js';
import { state, setState, normalizeState, saveState } from './state.js';
import { render, syncFormFromState, els, switchTab, renderQuickStartPreview } from './render.js';
import { setStatus } from './api.js';
import { clearMessages, clearChunks, putMessages, putChunk, countChunks, getRecentMessages, getAllMessages, getAllChunks } from './db.js';
import { chatCompletion } from './api.js';
import { colors } from './constants.js';
import {
  cleanStoredMessage,
  normalizeQuickStartConfig,
  normalizeQuickStartActor,
  cleanConfigText,
  stripCodeFence,
  extractBalancedObjects,
  stringifyList
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
  downloadJson(`forum-session-${slugDate()}.json`, {
    version: PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    ...state,
    messages,
    chunks
  });
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
    `**Pinned Facts:**\n${state.memory.pinnedFacts || 'None'}`,
    `**Shared Summary:**\n${state.memory.sharedSummary || 'None'}`,
    `**Open Questions:**\n${state.memory.openQuestions || 'None'}`,
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
  switchTab(fullReset ? "setup" : "conversation");
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
      setStatus("Preset loaded.", "ok");
    } catch {
      setStatus("That preset file could not be read.", "error");
    }
  });
  reader.readAsText(file);
}

export function addActor() {
  const index = state.actors.length;
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
  saveState();
  render();
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
    "The JSON must have this shape:",
    "{\"scenario\":{\"mode\":\"problem|story|freeform\",\"title\":\"\",\"premise\":\"\",\"objective\":\"\"},\"dm\":{\"enabled\":true,\"name\":\"\",\"persona\":\"\",\"seesPrivateThoughts\":false},\"actors\":[{\"name\":\"\",\"role\":\"\",\"persona\":\"\",\"goal\":\"\",\"voice\":\"\",\"thoughts\":\"\",\"enabled\":true}],\"memory\":{\"pinnedFacts\":\"\",\"sharedSummary\":\"\",\"openQuestions\":\"\",\"dmState\":\"\"}}"
  ].join("\n");
  const user = [
    `User request:\n${state.ui.quickStartPrompt}`,
    "Generate 3-5 actors unless the request clearly needs a different count.",
    "Use mode problem for collaborative problem solving, story for scenes/roleplay, and freeform for open-ended discussion."
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.5, maxTokens: 1800 });
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
  const cleaned = stripCodeFence(content);
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
  switchTab("conversation");
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
