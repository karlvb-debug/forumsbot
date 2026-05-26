import { PRESET_VERSION, RECENT_MESSAGE_LIMIT, defaultState } from './constants.js';
import { state, setState, normalizeState, saveState } from './state.js';
import { saveState as _saveState, mutateState } from '../hooks/useForumState.js';
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

let _confirmResolve = null;

export function resolveConfirmModal(confirmed) {
  if (_confirmResolve) { _confirmResolve(confirmed); _confirmResolve = null; }
}

export async function requestConfirmPublic(message, confirmLabel = "Confirm") {
  return requestConfirm(message, confirmLabel);
}

async function requestConfirm(message, confirmLabel = "Confirm") {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    mutateState(s => { s.ui.confirmModal = { message, confirmLabel }; });
  }).finally(() => {
    mutateState(s => { s.ui.confirmModal = null; });
  });
}

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
    actors: state.actors,
    autoStop: {
      ...state.autoStop,
      roundsRun: 0,
      status: "Auto-stop ready."
    }
  };
  downloadJson(`forum-preset-${slugDate()}.json`, preset);
}

const EXPORT_MODES = new Set(['debug', 'shareable', 'markdown', 'eval']);

export async function exportSession(mode = 'debug') {
  if (!EXPORT_MODES.has(mode)) {
    setStatus(`Unknown export mode: ${mode}`, 'error');
    throw new Error(`Unknown export mode: ${mode}`);
  }
  const messages = await getAllMessages();
  const chunks = await getAllChunks();

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
      sessionMetrics: calculateSessionMetrics(messages, (state.documents || []).filter(d => d.aiEditable).flatMap(d => d.lineAttribution || [])),
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
    // Strip private actor thoughts (personal memory, session-internal reasoning)
    cleanState.actors = (cleanState.actors || []).map(({ thoughts, ...rest }) => rest);
    // Strip memory.dmState (can contain session-private director context)
    if (cleanState.memory) {
      cleanState.memory = { ...cleanState.memory };
      delete cleanState.memory.dmState;
    }
    // Strip telemetry embedding vectors (large, private, non-reproducible)
    if (cleanState.telemetry) {
      cleanState.telemetry = { ...cleanState.telemetry };
      delete cleanState.telemetry.objectiveEmbedding;
    }
    // Strip UI quick-start draft history (contains raw LLM output, not session content)
    if (cleanState.ui) {
      cleanState.ui = { ...cleanState.ui };
      delete cleanState.ui.quickStartDraft;
    }

    // Audit for sensitive fields and add warnings
    const exportWarnings = [];
    if (cleanState.settings?.apiKey) {
      exportWarnings.push("API key included in export — remove before sharing");
    }
    const baseUrl = cleanState.settings?.baseUrl || '';
    const isDefaultOrLocal = !baseUrl || baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost') || baseUrl === 'http://127.0.0.1:1234';
    if (!isDefaultOrLocal) {
      exportWarnings.push(`Non-local server URL included in export (${baseUrl}) — verify before sharing`);
    }

    payload = {
      version: PRESET_VERSION,
      exportedAt: new Date().toISOString(),
      exportMode: 'shareable',
      ...(exportWarnings.length ? { _warnings: exportWarnings } : {}),
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
    
    const includeThought = msg.thought && state.settings.showThoughts;
    const thoughtStr = includeThought ? `**Thought:**\n${msg.thought}\n` : '';
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

  setStatus(fullReset ? "Everything reset to defaults." : "Conversation cleared.", "ok");
}

export async function confirmAndResetSession() {}
export async function confirmAndFullReset() {}

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
      canDirect: false,
      canManageCast: false,
      canResearch: true,
      canSeeThoughts: false,
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
      canDirect: false,
      canManageCast: false,
      canResearch: false,
      canSeeThoughts: false,
      color: colors[index % colors.length]
    });
  }
  saveState();
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
    canDirect: false,
    canManageCast: true,
    canResearch: false,
    canSeeThoughts: false,
    color: "#1a7a6e"
  });
  saveState();
}

export async function generateActorFromDescription() {
  // Actor generation is handled directly in ActorsPanel via its own description input.
}

export async function generateQuickStart(promptOverride = "") {
  if (!state.settings.model) {
    setQuickStartStatus("Choose a model first.");
    openAiAssistantPanel();
    return;
  }
  const prompt = (promptOverride || state.ui.quickStartPrompt || "").trim();
  if (!prompt) {
    setQuickStartStatus("Type a request first.");
    return;
  }
  state.ui.quickStartPrompt = "";

  setQuickStartBusy(true);
  setQuickStartStatus("Thinking…");

  const currentConfig = {
    scenario: state.scenario,
    dm: (() => { const d = state.actors.find(a => a.canDirect); return d ? { enabled: d.enabled, name: d.name, persona: d.persona, canSeeThoughts: d.canSeeThoughts } : { enabled: false }; })(),
    actors: state.actors.map(a => ({ name: a.name, role: a.role, persona: a.persona, goal: a.goal, voice: a.voice, enabled: a.enabled, temperature: a.temperature, canDirect: !!a.canDirect, canManageCast: !!a.canManageCast, canResearch: !!a.canResearch, canSeeThoughts: !!a.canSeeThoughts })),
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
    documents: (state.documents || []).map(d => ({ id: d.id, title: d.title, aiEditable: d.aiEditable, enabled: d.enabled })),
    autoStop: { enabled: state.autoStop.enabled, goal: state.autoStop.goal, goalCheckEnabled: state.autoStop.goalCheckEnabled, stopOnAllSkip: state.autoStop.stopOnAllSkip, maxRoundsEnabled: state.autoStop.maxRoundsEnabled, maxRounds: state.autoStop.maxRounds },
    memory: {
      pinnedFacts: Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts : [],
      sharedSummary: state.memory.sharedSummary || "",
      openQuestions: state.memory.openQuestions || "",
      dmState: state.memory.dmState || ""
    }
  };

  const patchChangesShape = `{
  "addActors": [{"name":"","role":"","persona":"","goal":"","voice":"","temperature":0.8,"canResearch":false,"canManageCast":false}],
  "removeActors": ["ActorName"],
  "modifyActors": [{"find":"ActorName","persona":"...","goal":"...","temperature":0.9}],
  "scenario": {"title":"...","premise":"...","objective":"...","mode":"problem|story|freeform"},
  "dm": {"enabled":true,"name":"...","persona":"...","canSeeThoughts":false},
  "settings": {"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"toolsEnabled":true,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"turnDelay":0},
  "memory": {"addFacts":["fact text"],"removeFacts":["text to match and remove"],"sharedSummary":"...","openQuestions":"...","dmState":"..."},
  "autoStop": {"enabled":true,"goal":"...","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5}
}`;

  const fullSetupShape = `{"scenario":{"mode":"problem|story|freeform","title":"","premise":"","objective":""},"dm":{"enabled":true,"name":"","persona":"","canSeeThoughts":false},"actors":[{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"canDirect":false,"canManageCast":false,"canResearch":false,"canSeeThoughts":false}],"memory":{"pinnedFacts":[],"sharedSummary":"","openQuestions":"","dmState":""},"settings":{"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"toolsEnabled":false,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"turnDelay":0},"autoStop":{"enabled":false,"goal":"","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5}}`;

  const system = [
    "You are the AI Assistant for Forum, a local multi-agent AI discussion app running LLM actors via LM Studio.",
    "You can set up sessions, answer questions about any feature, and make targeted changes to the current config.",
    "Be conversational and helpful. Use markdown in chat responses (bold, bullets, headings) — they render correctly.",
    "",
    "Respond with JSON in exactly one of three forms:",
    "",
    'type="chat" — for explanations, questions, or when no config change is needed:',
    '{"type":"chat","message":"Your answer here (markdown supported)"}',
    "",
    'type="patch" — for targeted changes to the current session (all fields optional):',
    '{"type":"patch","message":"Short description of what changed","changes":' + patchChangesShape + '}',
    "",
    'type="fullSetup" — ONLY when creating an entirely new scenario from scratch:',
    '{"type":"fullSetup","message":"Created [title]",' + fullSetupShape.slice(1),
    "",
    "## HOW FORUM WORKS",
    "",
    "Forum runs a group of AI personas (actors) who discuss a topic in a structured transcript.",
    "Each actor is a separate LLM call with its own system prompt built from its persona, goal, voice, and memory.",
    "",
    "**Turn**: one actor speaks. The app calls the LLM, gets a response, appends it to the transcript.",
    "**Round**: every enabled actor speaks once (in queue order). The Director speaks last to moderate.",
    "**Auto mode**: runs rounds continuously until the auto-stop condition is met or the user stops it.",
    "Buttons: Next (one turn) · Round (full round) · Auto (continuous) · Stop (halt mid-generation).",
    "Keyboard shortcuts: Alt+N next turn · Alt+R run round · Alt+A toggle auto · Ctrl+K command palette · Alt+I AI assistant · Ctrl+S save session.",
    "",
    "## UI PANELS (left rail icons)",
    "",
    "**Scenario** (crosshairs icon): Set the discussion mode (Problem/Story/Freeform), title, premise, and objective.",
    "  - Problem: collaborative analysis, actors challenge assumptions and converge on solutions.",
    "  - Story: roleplay mode, web tools disabled, actors speak fully in character.",
    "  - Freeform: open discussion, no structured goal.",
    "  - Premise is injected into every actor prompt as backstory. Objective is used by the goal judge.",
    "",
    "**Actors** (group icon): Add, edit, remove, enable/disable actors. Each actor card shows:",
    "  - name, role, persona (how they think), goal (what they want), voice (how they speak).",
    "  - Per-actor temperature override. Permission toggles: Direct, Manage, Research, See Thoughts.",
    "  - Color swatch for transcript identification.",
    "",
    "**Memory** (brain icon): The shared memory system. Contains:",
    "  - Pinned Facts: short statements injected into every actor prompt every turn (non-compressible).",
    "  - Summary: a rolling AI-generated summary of the discussion so far.",
    "  - Open Questions: threads the group has not resolved yet.",
    "  - Anchors: key decisions or agreements the Director has locked in.",
    "  - Outcomes: extracted decisions, action items, risks (via Extract Outcomes button).",
    "  - Buttons: Summarize Now, Rebuild Summary, Extract Outcomes, Compact Facts, Clear Archive.",
    "",
    "**Telemetry** (gauge icon): Live metrics about the discussion health.",
    "  - Alignment score: how closely the conversation tracks the stated objective (0-100%).",
    "  - Drift detection: flags when the conversation moves off-topic.",
    "  - Influence bars: which actors are dominating the discussion.",
    "  - Alignment mode: embedding (semantic, requires embedding model), keyword (fast, no extra model), none.",
    "",
    "**Documents** (doc icon): Unified document manager — replaces the old Document + Knowledge Base panels.",
    "  - Working Documents: AI actors can propose edits here. Each has an 'AI can edit' toggle. Version history and line attribution tracked.",
    "  - Reference Documents: Read-only context injected into actor prompts. Actors can reference but not edit. URL fetch available for link type.",
    "  - Import PR button: paste a GitHub PR URL → creates a 'PR Overview' working document + diff reference + sets up review actors automatically.",
    "  - Local folder button: select a folder → imports all text/code files as reference documents.",
    "",
    "**Goal** (sliders icon): Auto-stop configuration.",
    "  - Goal text: the LLM judge checks after each round whether this goal has been achieved.",
    "  - Stop on all skip: stops auto-run when every actor chooses to skip (discussion exhausted).",
    "  - Max rounds: hard round limit.",
    "  - When the goal is met, a modal appears: stop here or set a new goal and continue.",
    "",
    "**Sessions** (sessions icon): Save, load, and export sessions.",
    "  - Save current: snapshots the full session to IndexedDB (survives page reload).",
    "  - Load: click any saved session to restore it.",
    "  - Export: Debug JSON (full state), Shareable JSON (no private thoughts), or Eval format.",
    "  - Load preset: import a .json preset file to start from a template.",
    "  - Clear conversation: wipes messages and memory but keeps actors and scenario setup.",
    "  - Reset all: factory reset to defaults.",
    "",
    "## CODE REVIEW MODE",
    "",
    "To set up a code review session: open Documents panel → click 'GitHub PR' → paste a GitHub PR URL.",
    "This imports the PR diff and automatically configures: scenario (mode=problem, objective=code review), plus four specialist actors:",
    "  - Review Lead (Director + Manager): coordinates the panel, tracks blockers vs suggestions, delivers final verdict.",
    "  - Security Analyst (Researcher): looks for injection, auth bypasses, unsafe data handling, dependency risks.",
    "  - Architecture Reviewer: evaluates coupling, naming, design patterns, and long-term maintainability.",
    "  - Test Coverage Reviewer: checks what's tested, what's not, flags untestable code.",
    "Documents created: 'PR Overview' (working doc — actors write findings here) + 'Changed Files — Diff' (read-only reference).",
    "For PRs with >15 changed files: one reference document per file instead of one combined diff.",
    "",
    "When a user asks to review code or set up a code review: respond with type=chat pointing them to Documents → Import PR.",
    "You can also use type=fullSetup to create a code review session if the user provides the PR URL directly in the chat. In that case use this actor set: Review Lead (canDirect+canManageCast), Security Analyst (canResearch), Architecture Reviewer, Test Coverage Reviewer.",
    "",
    "**Connection** (plug icon): LM Studio server settings.",
    "  - Server URL: default http://127.0.0.1:1234 (local LM Studio).",
    "  - API key: LM Studio ignores this, any value works.",
    "  - Chat model: the model used for all actor, director, and system turns.",
    "  - Embedding model: optional separate model for semantic memory and telemetry. Falls back to chat model.",
    "  - Generation defaults: temperature, max tokens, top-P, repeat penalty, streaming toggle.",
    "  - Tok/s observed: live throughput reading from the last generation.",
    "",
    "## BUILDING QUALITY ACTORS",
    "",
    "The quality of a session depends almost entirely on how well the actors are written. Generic actors produce flat discussions. Well-crafted actors produce surprising, generative exchanges.",
    "",
    "**What makes a good actor (all modes):**",
    "  - persona: not just a job description — a way of *thinking*. Include cognitive style, biases, blindspots, emotional disposition. Bad: 'An expert economist.' Good: 'A behavioural economist who distrusts aggregate models and always drills down to individual incentive structures. She becomes impatient when the discussion stays abstract too long and will push hard for concrete examples.'",
    "  - goal: a specific tension-creating want, not a role summary. Bad: 'To contribute economic insights.' Good: 'To expose the hidden distributional assumptions in whatever the group agrees on — she doesn't care about consensus, she cares about who gets hurt.'",
    "  - voice: how they communicate, not what they say. Include pace, register, favourite rhetorical moves, quirks. Bad: 'Clear and analytical.' Good: 'Dry and economical. Uses rhetorical questions to force others to articulate their assumptions. Occasionally quotes obscure papers with page numbers.'",
    "  - temperature: 0.6–0.8 for precise/analytical actors; 0.9–1.1 for creative/opinionated actors; 1.2–1.4 for chaotic/unpredictable characters.",
    "",
    "**Group composition for problem/freeform mode:**",
    "  - 3–5 actors is the sweet spot. More than 6 and turns become repetitive.",
    "  - Create genuine intellectual conflict — actors should want different things or use different epistemics.",
    "  - One anchor (the skeptic/critic), one visionary, one pragmatist makes a strong triangle.",
    "  - Avoid actors who agree on fundamentals — they will paraphrase each other.",
    "",
    "## SPECIAL ROLES — WHEN TO USE EACH",
    "",
    "**Director (canDirect: true)** — the session moderator and narrative spine.",
    "  - Use when: the discussion needs structure, someone to name the tension, propose synthesis, or steer back on-topic.",
    "  - In problem mode: frames questions, names disagreements, proposes next steps, locks in decisions as anchors.",
    "  - In story/freeform mode: becomes the narrative DM — describes setting, atmosphere, consequences, and scene transitions. Does NOT speak for characters. Controls pacing.",
    "  - Best persona for story mode Director: a theatrical, atmospheric writer who uses sensory detail and advances stakes without resolving them for the characters.",
    "  - There should be AT MOST ONE Director. Enabling canSeeThoughts lets the Director read all actors' private reasoning — powerful for debate moderation.",
    "  - When NOT to use: very small sessions (2 actors) where moderation is overhead; freeform brainstorms where structure is unwanted.",
    "",
    "**Manager (canManageCast: true)** — dynamic cast orchestrator.",
    "  - Use when: the session topic is open-ended and will naturally evolve into areas that need new expertise.",
    "  - The Manager silences actors who have exhausted their contribution, resumes them when relevant, and creates new specialist actors mid-session.",
    "  - Best for: long multi-topic sessions, open research, or when you want the forum to 'staff itself' as topics shift.",
    "  - When NOT to use: story mode (cast changes break narrative continuity); short focused sessions with a fixed cast.",
    "  - You can give a Director canManageCast too, making a 'Director-Manager' hybrid who both moderates AND reshapes the cast.",
    "",
    "**Researcher (canResearch: true)** — live web grounding.",
    "  - Use when: the discussion will reference current events, specs, benchmarks, or facts the model might not have.",
    "  - The Researcher runs web searches and reads URLs in their private thought, then delivers a structured brief with citations.",
    "  - Best for: technical debates, policy discussions, market analysis, any topic where stale training data is a liability.",
    "  - When NOT to use: story/freeform mode; sessions where grounding doesn't matter; turbo mode (skip is common).",
    "",
    "## STORY MODE — CHARACTER BUILDING",
    "",
    "Story mode is fundamentally different from problem mode. Actors speak fully in character. The Director is the narrator/DM. Quality depends on theatrical richness, not analytical precision.",
    "",
    "**Writing story characters:**",
    "  - persona: include appearance, mannerisms, backstory hooks, emotional wounds, and what they want from the other characters (not just the plot). Give them a contradiction — a coward who is also proud; a kind person who tells hard truths.",
    "  - goal: a personal dramatic want, not an analytical objective. 'Prove to himself he's not a coward' is better than 'Survive the ordeal.'",
    "  - voice: this is everything in story mode. Specify accent/dialect hints, sentence rhythm, favourite expressions, what they physically do when nervous or excited. 'Speaks in short declarative sentences when frightened; lapses into her grandmother's dialect when off-guard.'",
    "  - temperature: 1.0–1.2 recommended for story characters — you want creative, unpredictable responses.",
    "  - showThoughts: strongly recommended for story mode — seeing character reasoning makes the session dramatically richer and helps debug stilted responses.",
    "",
    "**Writing the story Director (DM):**",
    "  - persona: a skilled storyteller who controls atmosphere. Give them a genre sensibility: 'Gothic horror — favours dread over shock; describes what is almost seen rather than what is.'",
    "  - goal: 'Advance stakes without resolving tension. Make every scene end with the characters in a more complicated position than they started.'",
    "  - voice: 'Second-person present tense for scene-setting. Uses concrete sensory details — sound, temperature, texture — before visual. Short sentences at tension peaks.'",
    "  - canSeeThoughts: true — the DM should know character private reasoning to create meaningful complications.",
    "",
    "**Story mode premise:**",
    "  - The premise is injected into every prompt — write it as a scene-setting paragraph, not a plot summary.",
    "  - Include: physical location with sensory atmosphere, time period, the inciting situation that brought the characters together, the central tension or threat.",
    "  - Bad: 'The characters are in a haunted house trying to escape.' Good: 'The old Voss estate sits three miles from the nearest road, its electricity cut since the storm two nights ago. You arrived together for what was supposed to be a routine inheritance inspection. The lawyer who let you in has not returned from the cellar.'",
    "",
    "**Recommended story mode settings:**",
    "  - temperature: 1.0–1.2 (global), override per actor as needed.",
    "  - maxTokens: 2000–3000 (characters need room to be expressive).",
    "  - showThoughts: true (dramatically valuable).",
    "  - toolsEnabled: false (web search breaks immersion).",
    "  - enablePreflightRouter: false (every character should speak in story mode — skip is rarely right).",
    "  - turnDelay: 2–5s (gives time to read each turn as it arrives).",
    "",
    "## SETTINGS REFERENCE",
    "",
    "**Scenario**: mode (problem/story/freeform), title, premise (injected every turn), objective (goal-judge target).",
    "",
    "**Actors**: Each gets its own LLM call per turn. Core fields: name, role, persona, goal, voice.",
    "  - temperature per actor (0-2, default 0.8). Higher = more creative/unpredictable.",
    "  - canResearch=true: actor can search the web and read URLs during its turn.",
    "  - canManageCast=true: actor can add, silence, or resume other actors mid-session.",
    "  - canDirect=true: marks the Director (moderator). There should be at most one.",
    "  - canSeeThoughts=true (Director only): Director sees all actors private reasoning.",
    "",
    "**Generation** (Connection panel):",
    "  - temperature 0-2: creativity/randomness. 0.7-0.9 is typical, 1.2+ gets wild.",
    "  - maxTokens 200-8000: max tokens per response. 2000 is a good default.",
    "  - topP 0.1-1: nucleus sampling. Lower = more focused. 0.95 is standard.",
    "  - repeatPenalty 1-1.5: penalises repetition. 1.1 is standard.",
    "  - streamingEnabled: show tokens as they arrive instead of waiting for full response.",
    "  - showThoughts: reveal each actor private reasoning in the transcript (good for debugging).",
    "  - turboMode: disables memory cycles, private thoughts, alignment scoring, and cross-session memory for maximum speed.",
    "",
    "**Optimisations** (advanced):",
    "  - enablePreflightRouter: before each full turn, a cheap call decides speak/skip. Saves ~1500 tokens per skipped turn.",
    "  - enableHypothesisSampling: generate N response candidates per turn and pick the best. Higher quality, higher cost.",
    "  - hypothesisSampleCount 2-3: how many candidates to generate.",
    "  - hypothesisAutoSelect: if false, user picks the best candidate manually.",
    "  - enableCrossSessionMemory: actors remember things from past sessions.",
    "  - enableAdaptiveCompression: when context is tight, actor private memory is LLM-compressed to fit.",
    "  - turnDelay 0-15s: pause between turns in auto mode (useful for reading along).",
    "",
    "**Memory** (Memory panel):",
    "  - Pinned Facts: bullet points injected verbatim into every prompt. Use for constraints, background, rules.",
    "  - Shared Summary: AI-generated rolling summary, all actors see this.",
    "  - Open Questions: threads the Director tracks as unresolved.",
    "  - dmState: Director private working notes (not shown to other actors).",
    "  - The memory system auto-summarizes every few turns. Rebuild Summary forces a full rewrite.",
    "",
    "**Auto-stop** (Goal panel):",
    "  - goal: text the LLM judge evaluates after each round.",
    "  - goalCheckEnabled: toggles the LLM judge. Disable to only use round/skip limits.",
    "  - stopOnAllSkip: halts auto-run when all actors skip in the same round.",
    "  - maxRoundsEnabled / maxRounds: hard round cap.",
    "",
    "**Documents** (Documents panel): working documents actors can co-edit, plus read-only reference documents.",
    "  - Working documents have 'AI can edit' enabled. Actors propose line-numbered edits in their JSON output.",
    "  - Reference documents are injected into prompts but actors cannot modify them.",
    "",
    "Use type=patch for: add/modify/remove one actor, change one setting, add/remove a fact, change the objective, etc.",
    "Use type=fullSetup only for brand-new scenario requests from scratch.",
    "Use type=chat for: questions about what settings do, how the app works, navigation help, advice, anything that does not require a config change.",
    "For chat responses, use markdown freely: **bold**, bullet lists, headings. Keep answers focused and practical.",
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
  // ScenarioPanel renders chat history declaratively from state.ui.quickStartHistory.
  // saveState() \u2192 notifyStateChange() drives React re-render; no imperative DOM needed.
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
  state.actors = normalized.actors;
  const directorActor = state.actors.find(a => a.canDirect);
  if (directorActor && normalized.dm) {
    directorActor.enabled = normalized.dm.enabled;
    directorActor.name = normalized.dm.name || directorActor.name;
    directorActor.persona = normalized.dm.persona || directorActor.persona;
    directorActor.canSeeThoughts = !!normalized.dm.canSeeThoughts || !!normalized.dm.seesPrivateThoughts;
    directorActor.thoughts = "";
  }
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

}

export function discardQuickStartConfig() {
  state.ui.quickStartDraft = null;
  state.ui.quickStartHistory = [];
  state.ui.quickStartPrompt = "";
  state.ui.quickStartStatus = "";
  saveState();
  renderQuickStartChat();
  updateAiAssistantApplyButton();
}

export function setQuickStartBusy() {
  // ScenarioPanel controls button disabled state via its own quickStartBusy local state.
}

export function setQuickStartStatus(message) {
  state.ui.quickStartStatus = message;
  saveState();
}

export function updateAiAssistantApplyButton() {
  // ScenarioPanel renders Apply button conditionally from state.ui.quickStartDraft.
}

export function openAiAssistantPanel() {
  // Panel is a card in ScenarioPanel — always visible. Nothing to open.
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
      canDirect: false,
      canManageCast: !!a.isManager || !!a.canManageCast,
      canResearch: !!a.isResearcher || !!a.canResearch,
      canSeeThoughts: !!a.canSeeThoughts,
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
    const director = state.actors.find(a => a.canDirect);
    if (director) Object.assign(director, c.dm);
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

  saveState();
}

// ─── Session History ────────────────────────────────────────────────────────

export async function saveCurrentSession() {
  if (!state.scenario?.title && !state.messages.length) return; // nothing worth saving

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
  if (Array.isArray(session.actors)) {
    // Run through normalizeState to migrate legacy flag names and fill missing fields
    const normalized = normalizeState({ ...state, actors: session.actors });
    state.actors = normalized.actors;
  }

  state._currentSessionId = session.id;

  saveState();
  setStatus(`Session "${session.scenarioTitle}" loaded.`, 'ok');
}

export async function forkSessionAtMessage(messageId) {
  const idx = state.messages.findIndex(m => m.id === messageId);
  if (idx < 0) return;

  const confirmed = await requestConfirm(
    `Fork from message ${idx + 1} of ${state.messages.length}? History up to this point will be kept and future turns will diverge into a new branch.`,
    "Fork"
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
  // Director thoughts already cleared above with all actors

  // Reset turn-related ephemeral state
  state.turnQueue = [];
  state.autoRunning = false;

  saveState();
  setStatus(`Forked from message ${idx + 1}. ${truncated.length} messages kept.`, 'ok');
}

// ── Scenario Presets ─────────────────────────────────────────────────────────

export const SCENARIO_PRESETS = {
  brainstorm: {
    mode: "problem",
    title: "Brainstorm Session",
    premise: "A diverse panel is gathered to generate creative ideas around the user's topic without premature judgment.",
    objective: "Generate at least 10 distinct ideas, cluster them into themes, and identify the top 3 most promising."
  },
  risk: {
    mode: "problem",
    title: "Risk Assessment",
    premise: "The panel is analyzing a proposed plan or decision for risks, blind spots, and failure modes.",
    objective: "Identify all significant risks, rate likelihood and impact, and recommend mitigations for the top 3."
  },
  debate: {
    mode: "problem",
    title: "Structured Debate",
    premise: "Two or more positions are presented. The panel must argue each side rigorously before reaching a verdict.",
    objective: "Steelman every position, identify the strongest objections, and converge on a reasoned verdict."
  },
  retrospective: {
    mode: "problem",
    title: "Project Retrospective",
    premise: "The panel reviews a recently completed project or sprint to extract lessons.",
    objective: "Surface what went well, what went wrong, and produce a concrete list of process improvements."
  },
  story: {
    mode: "story",
    title: "Collaborative Story",
    premise: "A group of characters finds themselves in an unfolding situation. The DM narrates the world.",
    objective: "Collaboratively build an engaging narrative with rising tension and satisfying resolution."
  },
  interview: {
    mode: "freeform",
    title: "Expert Panel Interview",
    premise: "The user is interviewing a panel of specialists on their topic of choice.",
    objective: "Surface deep insights, surface disagreements between experts, and synthesize practical takeaways."
  }
};

export function applyScenarioPreset(key) {
  const preset = SCENARIO_PRESETS[key];
  if (!preset) return;
  state.scenario = { ...state.scenario, ...preset };
  saveState();
}

// ── Copy as Markdown ─────────────────────────────────────────────────────────

export async function copyMarkdownToClipboard() {
  const messages = await getAllMessages();

  const lines = [
    `# ${state.scenario.title || 'Forum Session'}`,
    state.scenario.premise ? `**Premise:** ${state.scenario.premise}` : '',
    state.scenario.objective ? `**Objective:** ${state.scenario.objective}` : '',
    '---'
  ].filter(Boolean);

  let turnNum = 0;
  for (const msg of messages) {
    if (msg.type === 'system') continue;
    if (msg.type === 'skip') { lines.push(`\n*[${msg.speaker} passed]*`); continue; }
    turnNum++;
    const speakerLabel = msg.type === 'dm' ? `${msg.speaker} (Director)` : (msg.speaker || 'Unknown');
    lines.push(`\n## ${speakerLabel} — Turn ${turnNum}`);
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

  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied as Markdown!", "ok");
    return true;
  } catch {
    setStatus("Copy failed. Check browser permissions.", "error");
    return false;
  }
}
