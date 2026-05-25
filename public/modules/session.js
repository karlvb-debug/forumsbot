import { PRESET_VERSION, RECENT_MESSAGE_LIMIT, defaultState } from './constants.js';
import { state, setState, normalizeState, saveState } from './state.js';
import { render, syncFormFromState, els, switchSidebarTab, renderQuickStartPreview } from './render.js';
import { setStatus } from './api.js';
import { clearMessages, clearChunks, putMessages, putChunk, countChunks, getRecentMessages, getAllMessages, getAllChunks, putSession, getAllSessions, deleteSession } from './db.js';
import { chatCompletion, chatCompletionMessages } from './api.js';
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

export function addManager() {
  state.actors.push({
    id: crypto.randomUUID(),
    name: "Manager",
    role: "Orchestrator",
    persona: "Observe the discussion and the current roster. Create specialized actors when the conversation needs expertise that isn't present. Silence actors who have finished contributing. Resume actors when they become relevant again.",
    goal: "Ensure the right perspectives are in the room at the right time.",
    voice: "Decisive and brief. State what you're doing and why in one sentence.",
    thoughts: "",
    enabled: true,
    isManager: true,
    color: "#1a7a6e"
  });
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
    setQuickStartStatus("Choose a model first.");
    openAiAssistantPanel();
    return;
  }
  const input = document.getElementById("aiAssistantInput");
  const prompt = (input?.value || state.ui.quickStartPrompt || "").trim();
  if (!prompt) {
    setQuickStartStatus("Type a request first.");
    return;
  }
  if (input) input.value = "";

  setQuickStartBusy(true);
  setQuickStartStatus("Thinking…");

  const currentConfig = {
    scenario: state.scenario,
    dm: { enabled: state.dm.enabled, name: state.dm.name, persona: state.dm.persona, seesPrivateThoughts: state.dm.seesPrivateThoughts },
    actors: state.actors.map(a => ({ name: a.name, role: a.role, persona: a.persona, goal: a.goal, voice: a.voice, enabled: a.enabled, temperature: a.temperature, isResearcher: !!a.isResearcher, isManager: !!a.isManager })),
    settings: {
      temperature: state.settings.temperature,
      maxTokens: state.settings.maxTokens ?? 2000,
      topP: state.settings.topP ?? 1.0,
      repeatPenalty: state.settings.repeatPenalty ?? 1.1,
      toolsEnabled: state.settings.toolsEnabled,
      streamingEnabled: state.settings.streamingEnabled !== false,
      showThoughts: state.settings.showThoughts,
      turboMode: !!state.settings.turboMode,
      enablePreflightRouter: state.settings.enablePreflightRouter !== false,
      enableHypothesisSampling: !!state.settings.enableHypothesisSampling,
      hypothesisSampleCount: state.settings.hypothesisSampleCount ?? 2,
      hypothesisAutoSelect: state.settings.hypothesisAutoSelect !== false,
      enableCrossSessionMemory: state.settings.enableCrossSessionMemory !== false,
      enableAdaptiveCompression: state.settings.enableAdaptiveCompression !== false,
      turnDelay: state.settings.turnDelay ?? 0,
    },
    document: { enabled: !!state.document?.enabled, title: state.document?.title || "" },
    autoStop: { enabled: state.autoStop.enabled, goal: state.autoStop.goal, goalCheckEnabled: state.autoStop.goalCheckEnabled, stopOnAllSkip: state.autoStop.stopOnAllSkip, maxRoundsEnabled: state.autoStop.maxRoundsEnabled, maxRounds: state.autoStop.maxRounds },
    memory: {
      pinnedFacts: Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts : [],
      sharedSummary: state.memory.sharedSummary || "",
      openQuestions: state.memory.openQuestions || "",
      dmState: state.memory.dmState || ""
    }
  };

  const patchChangesShape = `{
  "addActors": [{"name":"","role":"","persona":"","goal":"","voice":"","temperature":0.8,"isResearcher":false,"isManager":false}],
  "removeActors": ["ActorName"],
  "modifyActors": [{"find":"ActorName","persona":"...","goal":"...","temperature":0.9}],
  "scenario": {"title":"...","premise":"...","objective":"...","mode":"problem|story|freeform"},
  "dm": {"enabled":true,"name":"...","persona":"...","seesPrivateThoughts":false},
  "settings": {"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"toolsEnabled":true,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"turnDelay":0},
  "memory": {"addFacts":["fact text"],"removeFacts":["text to match and remove"],"sharedSummary":"...","openQuestions":"...","dmState":"..."},
  "autoStop": {"enabled":true,"goal":"...","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5},
  "document": {"enabled":false,"title":"..."}
}`;

  const fullSetupShape = `{"scenario":{"mode":"problem|story|freeform","title":"","premise":"","objective":""},"dm":{"enabled":true,"name":"","persona":"","seesPrivateThoughts":false},"actors":[{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"isResearcher":false,"isManager":false}],"memory":{"pinnedFacts":[],"sharedSummary":"","openQuestions":"","dmState":""},"settings":{"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"toolsEnabled":false,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"turnDelay":0},"document":{"enabled":false,"title":""},"autoStop":{"enabled":false,"goal":"","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5}}`;

  const system = [
    "You are the AI Assistant for Forum, a local multi-agent AI discussion app running LLM actors via LM Studio.",
    "",
    "Respond with JSON in exactly one of three forms:",
    "",
    'type="chat" — for explanations, questions, or when no config change is needed:',
    '{"type":"chat","message":"Your answer here"}',
    "",
    'type="patch" — for targeted changes (applied immediately, all fields optional):',
    '{"type":"patch","message":"Short description","changes":' + patchChangesShape + '}',
    "",
    'type="fullSetup" — ONLY when creating an entirely new scenario from scratch:',
    '{"type":"fullSetup","message":"Created [title]",' + fullSetupShape.slice(1),
    "",
    "SETTINGS REFERENCE:",
    "Scenario: mode (problem/story/freeform), title, premise (backstory in every prompt), objective (goal-judge target).",
    "story mode disables web tools and uses roleplay framing.",
    "",
    "Actors: Each gets its own LLM call per turn. name, role, persona, goal, voice are core.",
    "temperature per actor (0-2, default 0.8). isResearcher=true makes actor fetch live web data.",
    "isManager=true lets actor create/silence/resume other actors mid-session.",
    "",
    "Director (dm): moderates discussion. seesPrivateThoughts=true gives director visibility into all actors' private reasoning.",
    "",
    "Generation: temperature 0-2 (creativity), maxTokens 200-8000 (response length), topP 0.1-1 (nucleus sampling),",
    "repeatPenalty 1-1.5 (repetition reduction). toolsEnabled allows web search. streamingEnabled shows tokens live.",
    "showThoughts reveals private reasoning (good for debugging). turboMode disables memory/thoughts/alignment for speed.",
    "",
    "Optimizations: enablePreflightRouter saves ~1500 tokens/skipped turn via a cheap speak/skip pre-check.",
    "enableHypothesisSampling generates N candidates (hypothesisSampleCount 2-3) and picks the best.",
    "hypothesisAutoSelect=false lets user choose manually. enableCrossSessionMemory persists actor learning.",
    "enableAdaptiveCompression compresses actor memory when context is tight. turnDelay 0-15s pauses between turns in auto mode.",
    "",
    "Memory: pinnedFacts (array, injected into every prompt), sharedSummary (all actors see it), openQuestions (tracked open threads), dmState (director private notes).",
    "Use addFacts/removeFacts in patches for targeted fact management.",
    "",
    "Auto-stop: goal checked by LLM judge after each round. stopOnAllSkip catches exhausted discussions. maxRounds is a hard limit.",
    "",
    "Document: shared document actors can co-edit during the session. enabled/title.",
    "",
    "Use type=patch for: add/modify/remove one actor, change one setting, add/remove a fact, change the objective, etc.",
    "Use type=fullSetup only for brand-new scenario requests from scratch.",
    "Use type=chat for: questions about what settings do, requests for advice, anything that doesn't require a config change.",
    "",
    "Return only valid JSON. No markdown fences. No commentary outside the JSON."
  ].join("\n");

  const history = Array.isArray(state.ui.quickStartHistory) ? state.ui.quickStartHistory : [];
  const messages = [{ role: "system", content: system }];

  for (const entry of history) {
    messages.push({ role: entry.role, content: entry.content });
  }

  const hasContext = history.length > 0;
  const userContent = hasContext
    ? "Current config:\n" + JSON.stringify(currentConfig, null, 2) + "\n\nRequest: " + prompt
    : (state.scenario.title && state.scenario.title !== "Design council" && state.scenario.premise
        ? "Current config:\n" + JSON.stringify(currentConfig, null, 2) + "\n\nRequest: " + prompt
        : prompt);
  messages.push({ role: "user", content: userContent });

  // Add user bubble immediately
  if (!Array.isArray(state.ui.quickStartHistory)) state.ui.quickStartHistory = [];
  state.ui.quickStartHistory.push({ role: "user", content: prompt });
  renderQuickStartChat();

  try {
    const temp = state.ui.quickStartTemperature ?? 0.8;
    const raw = await chatCompletionMessages(messages, { temperature: temp, maxTokens: 3000 });

    let parsed;
    try {
      const cleaned = sanitizeJsonString(stripCodeFence(raw));
      parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== "object") throw new Error("Not an object");
    } catch {
      for (const candidate of extractBalancedObjects(sanitizeJsonString(stripCodeFence(raw)))) {
        try { parsed = JSON.parse(candidate); if (parsed && typeof parsed === "object") break; } catch {}
      }
      if (!parsed) throw new Error("The model did not return usable JSON.");
    }

    const type = parsed.type || "fullSetup";
    const message = parsed.message || "";

    if (type === "patch" && parsed.changes && typeof parsed.changes === "object") {
      applyAssistantPatch(parsed.changes);
      state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "patch", message });
      setQuickStartStatus("Changes applied.");
    } else if (type === "chat") {
      state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "chat", message });
      setQuickStartStatus("");
    } else {
      // fullSetup
      state.ui.quickStartDraft = normalizeQuickStartConfig(parsed);
      state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "fullSetup", message, draft: state.ui.quickStartDraft });
      setQuickStartStatus("Full setup ready — click Apply to replace current scenario.");
    }

    saveState();
    renderQuickStartChat();
    updateAiAssistantApplyButton();
  } catch (error) {
    state.ui.quickStartHistory.push({ role: "assistant", content: "", type: "error", message: error.message || "Request failed." });
    setQuickStartStatus("Error: " + (error.message || "Request failed."));
    renderQuickStartChat();
  } finally {
    setQuickStartBusy(false);
  }
}

export function renderQuickStartChat() {
  const container = document.getElementById("aiAssistantChat");
  if (!container) return;
  const history = Array.isArray(state.ui.quickStartHistory) ? state.ui.quickStartHistory : [];
  container.innerHTML = "";
  if (history.length === 0) return;
  for (const entry of history) {
    const div = document.createElement("div");
    div.className = "qs-msg qs-msg--" + entry.role;
    if (entry.role === "user") {
      div.textContent = entry.content;
    } else {
      // AI message: show message text, then type badge
      const msg = entry.message || (entry.type === "error" ? "Error" : "");
      if (msg) {
        const p = document.createElement("div");
        p.className = "qs-msg-text";
        p.textContent = msg;
        div.appendChild(p);
      }
      if (entry.type && entry.type !== "chat" && entry.type !== "error") {
        const badge = document.createElement("span");
        badge.className = "qs-msg-badge qs-msg-badge--" + entry.type;
        badge.textContent = entry.type === "patch" ? "\u2713 Applied" : entry.type === "fullSetup" ? "\u2191 Full setup \u2014 click Apply" : "";
        div.appendChild(badge);
      }
      if (entry.type === "error") {
        div.classList.add("qs-msg--error");
      }
    }
    container.append(div);
  }
  container.scrollTop = container.scrollHeight;
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
  // Apply AI-suggested settings if present
  if (normalized.settings) {
    const ns = normalized.settings;
    if (typeof ns.temperature === "number") state.settings.temperature = ns.temperature;
    if (typeof ns.maxTokens === "number") state.settings.maxTokens = ns.maxTokens;
    if (typeof ns.toolsEnabled === "boolean") state.settings.toolsEnabled = ns.toolsEnabled;
    if (typeof ns.streamingEnabled === "boolean") state.settings.streamingEnabled = ns.streamingEnabled;
    if (typeof ns.showThoughts === "boolean") state.settings.showThoughts = ns.showThoughts;
    if (typeof ns.enableAdaptiveCompression === "boolean") state.settings.enableAdaptiveCompression = ns.enableAdaptiveCompression;
    if (typeof ns.enableCrossSessionMemory === "boolean") state.settings.enableCrossSessionMemory = ns.enableCrossSessionMemory;
  }
  if (normalized.document) {
    if (typeof normalized.document.enabled === "boolean") state.document.enabled = normalized.document.enabled;
    if (normalized.document.title) state.document.title = normalized.document.title;
  }
  if (normalized.autoStop) {
    const nas = normalized.autoStop;
    if (typeof nas.enabled === "boolean") state.autoStop.enabled = nas.enabled;
    if (nas.goal !== undefined) state.autoStop.goal = String(nas.goal);
    if (typeof nas.goalCheckEnabled === "boolean") state.autoStop.goalCheckEnabled = nas.goalCheckEnabled;
    if (typeof nas.stopOnAllSkip === "boolean") state.autoStop.stopOnAllSkip = nas.stopOnAllSkip;
    if (typeof nas.maxRoundsEnabled === "boolean") state.autoStop.maxRoundsEnabled = nas.maxRoundsEnabled;
    if (typeof nas.maxRounds === "number") state.autoStop.maxRounds = nas.maxRounds;
  }
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
  updateAiAssistantApplyButton();
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
  state.ui.quickStartHistory = [];
  state.ui.quickStartPrompt = "";
  const input = document.getElementById("aiAssistantInput");
  if (input) input.value = "";
  if (els.quickStartPrompt) els.quickStartPrompt.value = "";
  state.ui.quickStartStatus = "";
  saveState();
  renderQuickStartChat();
  updateAiAssistantApplyButton();
}

export function setQuickStartBusy(value) {
  const sendBtn = document.getElementById("aiAssistantSendBtn");
  const applyBtn = document.getElementById("aiAssistantApplyBtn");
  if (sendBtn) sendBtn.disabled = value;
  if (applyBtn) applyBtn.disabled = value;
  // Legacy sidebar elements (may not exist)
  if (els.generateQuickStart) els.generateQuickStart.disabled = value;
  if (els.applyQuickStart) els.applyQuickStart.disabled = value || !state.ui.quickStartDraft;
  if (els.discardQuickStart) els.discardQuickStart.disabled = value || !state.ui.quickStartDraft;
}

export function setQuickStartStatus(message) {
  state.ui.quickStartStatus = message;
  const el = document.getElementById("aiAssistantStatus");
  if (el) el.textContent = message;
  if (els.quickStartStatus) els.quickStartStatus.textContent = message;
  saveState();
}

export function updateAiAssistantApplyButton() {
  const btn = document.getElementById("aiAssistantApplyBtn");
  if (btn) btn.style.display = state.ui.quickStartDraft ? "" : "none";
}

export function openAiAssistantPanel() {
  const panel = document.getElementById("aiAssistantPanel");
  if (panel) panel.hidden = false;
}

export function applyAssistantPatch(changes) {
  const c = changes;

  // Actors — add
  for (const a of (c.addActors || [])) {
    state.actors.push({
      id: crypto.randomUUID(),
      name: a.name || "New Actor",
      role: a.role || "Participant",
      persona: a.persona || "",
      goal: a.goal || "",
      voice: a.voice || "",
      temperature: typeof a.temperature === "number" ? a.temperature : 0.8,
      isResearcher: !!a.isResearcher,
      isManager: !!a.isManager,
      enabled: true,
      thoughts: "",
      color: colors[state.actors.length % colors.length]
    });
  }

  // Actors — remove
  for (const name of (c.removeActors || [])) {
    const lower = name.toLowerCase();
    state.actors = state.actors.filter(a => a.name.toLowerCase() !== lower);
  }

  // Actors — modify
  for (const mod of (c.modifyActors || [])) {
    const target = state.actors.find(a => a.name.toLowerCase() === (mod.find || "").toLowerCase());
    if (target) {
      const { find: _find, ...rest } = mod;
      Object.assign(target, rest);
    }
  }

  // Scenario (partial)
  if (c.scenario && typeof c.scenario === "object") {
    Object.assign(state.scenario, c.scenario);
  }

  // Director (partial)
  if (c.dm && typeof c.dm === "object") {
    Object.assign(state.dm, c.dm);
  }

  // Settings (partial)
  if (c.settings && typeof c.settings === "object") {
    for (const [key, val] of Object.entries(c.settings)) {
      if (val !== null && val !== undefined) state.settings[key] = val;
    }
  }

  // Memory
  if (c.memory && typeof c.memory === "object") {
    const mem = c.memory;
    if (mem.addFacts) {
      const existing = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts : [];
      state.memory.pinnedFacts = [...existing, ...mem.addFacts].filter(Boolean);
    }
    if (mem.removeFacts) {
      const toRemove = mem.removeFacts.map(s => s.toLowerCase());
      const existing = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts : [];
      state.memory.pinnedFacts = existing.filter(f => !toRemove.some(r => f.toLowerCase().includes(r)));
    }
    if (mem.sharedSummary !== undefined && mem.sharedSummary !== null) state.memory.sharedSummary = mem.sharedSummary;
    if (mem.openQuestions !== undefined && mem.openQuestions !== null) state.memory.openQuestions = mem.openQuestions;
    if (mem.dmState !== undefined && mem.dmState !== null) state.memory.dmState = mem.dmState;
  }

  // Auto-stop (partial)
  if (c.autoStop && typeof c.autoStop === "object") {
    Object.assign(state.autoStop, c.autoStop);
  }

  // Document (partial)
  if (c.document && typeof c.document === "object") {
    Object.assign(state.document, c.document);
  }

  saveState();
  syncFormFromState();
  render();
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
