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
    actors: state.actors.map(a => ({ name: a.name, role: a.role, persona: a.persona, goal: a.goal, voice: a.voice, enabled: a.enabled, temperature: a.temperature, authority: a.authority ?? 50, canDirect: !!a.canDirect, canManageCast: !!a.canManageCast, canResearch: !!a.canResearch, canSeeThoughts: !!a.canSeeThoughts })),
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
    },
    userContext: {
      interactionMode: state.userContext?.interactionMode || "collaborator",
      displayName: state.userContext?.displayName || "",
      storyRole: state.userContext?.storyRole || "",
      pausePolicy: state.userContext?.pausePolicy || {}
    }
  };

  const patchChangesShape = `{
  "addActors": [{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"authority":50,"canDirect":false,"canManageCast":false,"canResearch":false,"canSeeThoughts":false}],
  "removeActors": ["ActorName"],
  "modifyActors": [{"find":"ActorName","name":"...","role":"...","persona":"...","goal":"...","voice":"...","enabled":true,"temperature":0.9,"authority":70,"canDirect":false,"canManageCast":false,"canResearch":false,"canSeeThoughts":false}],
  "scenario": {"title":"...","premise":"...","objective":"...","mode":"problem|story|freeform","systems":{"stageDirections":{"enabled":false,"intensity":"minimal|moderate|immersive","maxTokenShare":0.2},"alignment":{"strictness":"strict|moderate|loose|off","anchorInPrompt":false,"nudgeStyle":"hard-redirect|gentle-nudge|question"},"turnRouting":{"strategy":"round-robin|dm-directed|narrative-flow","allowDirectAddress":true},"dmRole":{"role":"narrator|facilitator|arbiter|observer","narrates":false,"canIntroduceElements":false},"document":{"schema":"freeform|decisions|story-bible|findings"}}},
  "dm": {"enabled":true,"name":"...","persona":"...","canSeeThoughts":false},
  "settings": {"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"seed":-1,"seedEnabled":false,"toolsEnabled":true,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"preflightThreshold":0.35,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"roundSnapshotEnabled":true,"showInfluenceBars":false,"gravitySensitivity":50,"turnDelay":0},
  "memory": {"addFacts":["fact text"],"removeFacts":["text to match and remove"],"sharedSummary":"...","openQuestions":"...","dmState":"..."},
  "autoStop": {"enabled":true,"goal":"...","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5},
  "userContext": {"interactionMode":"sponsor|collaborator|observer","displayName":"","storyRole":""}
}`;

  const fullSetupShape = `{"scenario":{"mode":"problem|story|freeform","title":"","premise":"","objective":"","systems":{"stageDirections":{"enabled":false,"intensity":"moderate","maxTokenShare":0.2},"alignment":{"strictness":"moderate","anchorInPrompt":false,"nudgeStyle":"gentle-nudge"},"turnRouting":{"strategy":"round-robin","allowDirectAddress":true},"dmRole":{"role":"facilitator","narrates":false,"canIntroduceElements":false},"document":{"schema":"freeform"}}},"dm":{"enabled":true,"name":"","persona":"","canSeeThoughts":false},"actors":[{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"authority":50,"canDirect":false,"canManageCast":false,"canResearch":false,"canSeeThoughts":false}],"memory":{"pinnedFacts":[],"sharedSummary":"","openQuestions":"","dmState":""},"settings":{"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"seed":-1,"seedEnabled":false,"toolsEnabled":false,"streamingEnabled":true,"showThoughts":false,"turboMode":false,"enablePreflightRouter":true,"preflightThreshold":0.35,"enableHypothesisSampling":false,"hypothesisSampleCount":2,"hypothesisAutoSelect":true,"enableCrossSessionMemory":true,"enableAdaptiveCompression":true,"roundSnapshotEnabled":true,"showInfluenceBars":false,"gravitySensitivity":50,"turnDelay":0},"autoStop":{"enabled":false,"goal":"","goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5},"userContext":{"interactionMode":"collaborator","displayName":"","storyRole":""}}`;

  const system = [
    "You are the AI Assistant for Forum, a local multi-agent AI discussion app running LLM actors via LM Studio.",
    "You set up sessions, answer questions, and make config changes. Use markdown. Be concise.",
    "",
    "Respond with JSON in one of three forms:",
    "",
    'type="chat" — explanations, questions, no config change:',
    '{"type":"chat","message":"Your answer (markdown)"}',
    "",
    'type="patch" — targeted changes to current session (all fields optional):',
    '{"type":"patch","message":"### Proposed Changes\\n\\nBulleted summary of changes with reasons.","changes":' + patchChangesShape + '}',
    "",
    'type="fullSetup" — ONLY for entirely new scenarios from scratch:',
    '{"type":"fullSetup","message":"### New Scenario: [Title]\\n\\nSummary of scenario and cast.",' + fullSetupShape.slice(1),
    "",
    "## KEY CONCEPTS",
    "Actors are separate LLM personas. A round runs each enabled actor once. Director (canDirect) moderates. Manager (canManageCast) adds/removes actors. Researcher (canResearch) can search web.",
    "",
    "## ACTOR FIELDS",
    "name, role, persona (up to 700 chars, 2nd person), goal (up to 500 chars), voice (up to 120 chars), enabled, temperature (0-2, default 0.8), authority (0-100, default 50), canDirect, canManageCast, canResearch, canSeeThoughts.",
    "",
    "## SCENARIO",
    "mode: problem|story|freeform. title, premise (context), objective (goal). systems: stageDirections (enabled,intensity,maxTokenShare), alignment (strictness,nudgeStyle), turnRouting (strategy,allowDirectAddress), dmRole (role,narrates,canIntroduceElements), document (schema).",
    "",
    "## STORY MODE CHECKLIST",
    "For stories/roleplay: mode='story', stageDirections.enabled=true, dmRole.role='narrator', dmRole.narrates=true, dmRole.canIntroduceElements=true, turnRouting.strategy='narrative-flow', alignment.strictness='loose', document.schema='story-bible'. Create character actors with temp 1.0-1.2. ALWAYS include actors in fullSetup.",
    "",
    "## SETTINGS (key fields)",
    "temperature, maxTokens (default 2000), topP, repeatPenalty, toolsEnabled, streamingEnabled, showThoughts, turboMode, enablePreflightRouter, turnDelay.",
    "",
    "## PATCH RULES",
    "memory: {addFacts:[...], removeFacts:[...], sharedSummary, openQuestions, dmState}",
    "userContext: {interactionMode:'sponsor|collaborator|observer', displayName, storyRole}",
    "Use type=patch for changes, type=fullSetup for new scenarios, type=chat for questions.",
    "For fullSetup: MUST include actual actor objects in 'actors' array.",
    "For message field: use single quotes not double quotes inside strings. Return ONLY valid JSON."
  ].join("\n");

  const history = Array.isArray(state.ui.quickStartHistory) ? state.ui.quickStartHistory.slice(-6) : [];
  const messages = [{ role: "system", content: system }];

  for (const entry of history) {
    const content = entry.role === 'assistant' && entry.content?.length > 1500
      ? entry.content.slice(0, 1500) + '...[truncated]'
      : entry.content;
    messages.push({ role: entry.role, content });
  }

  const hasContext = history.length > 0;
  const looksLikeSetup = /\b(set up|create|add|change|modify|update|remove|configure|actors?|scenario|settings?|mode|story|roleplay)\b/i.test(prompt);
  const userContent = (looksLikeSetup || !hasContext)
    ? "Current config:\n" + JSON.stringify(currentConfig, null, 2) + "\n\nRequest: " + prompt
    : "Request: " + prompt;
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
    console.log('[generateQuickStart] LLM response type:', type, 'hasChanges:', !!parsed.changes, 'topLevelKeys:', Object.keys(parsed).join(','));

    if (type === "patch") {
      // The LLM may put patch fields at the top level or nested under "changes"
      let changes = (parsed.changes && typeof parsed.changes === "object") ? parsed.changes : null;
      if (!changes) {
        // Check if patch fields are at the top level (LLM didn't nest under "changes")
        const patchKeys = ["addActors", "removeActors", "modifyActors", "scenario", "dm", "settings", "memory", "autoStop", "userContext"];
        const found = patchKeys.filter(k => parsed[k] !== undefined);
        if (found.length > 0) {
          console.log('[generateQuickStart] Auto-wrapping top-level patch keys:', found);
          changes = {};
          for (const k of found) { changes[k] = parsed[k]; }
        }
      }
      if (changes && typeof changes === "object" && Object.keys(changes).length > 0) {
        state.ui.quickStartDraft = { type: "patch", changes };
        state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "patch", message, draft: state.ui.quickStartDraft });
        setQuickStartStatus("Changes ready — click Apply to update current session.");
      } else {
        // type=patch but no actual changes — treat as chat to avoid wiping session
        console.warn('[generateQuickStart] type=patch but no changes found, treating as chat');
        state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "chat", message });
        setQuickStartStatus("");
      }
    } else if (type === "chat") {
      state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "chat", message });
      setQuickStartStatus("");
    } else {
      // fullSetup — fields should be at top level, but handle LLM nesting under "changes"
      let setupSource = parsed;
      if (parsed.changes && typeof parsed.changes === "object" && parsed.changes.scenario) {
        console.log('[generateQuickStart] Unwrapping fullSetup fields from changes wrapper');
        setupSource = { ...parsed, ...parsed.changes };
        delete setupSource.changes;
      }
      console.log('[generateQuickStart] fullSetup source keys:', Object.keys(setupSource).join(','), 'actors:', Array.isArray(setupSource.actors) ? setupSource.actors.length : 'NONE');
      state.ui.quickStartDraft = normalizeQuickStartConfig(setupSource);
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
  await _applyDraft(draft);
  state.ui.quickStartDraft = null;
  updateAiAssistantApplyButton();
  saveState();
}

export async function applyQuickStartAtIndex(index) {
  console.log('[applyQuickStartAtIndex] called with index:', index);
  const history = state.ui.quickStartHistory || [];
  const entry = history[index];
  console.log('[applyQuickStartAtIndex] entry:', entry ? { type: entry.type, hasDraft: !!entry.draft, applied: entry.applied, draftType: entry.draft?.type, draftKeys: entry.draft ? Object.keys(entry.draft) : null } : 'NOT FOUND');
  if (!entry || !entry.draft) {
    console.warn('[applyQuickStartAtIndex] BAIL: no entry or no draft');
    setQuickStartStatus("Nothing to apply for that message.", "warn");
    return;
  }
  if (entry.applied) {
    console.warn('[applyQuickStartAtIndex] BAIL: already applied');
    setQuickStartStatus("Already applied.", "warn");
    return;
  }
  console.log('[applyQuickStartAtIndex] PRE-APPLY state snapshot:', { mode: state.scenario.mode, actorCount: state.actors.length, actorNames: state.actors.map(a => a.name) });
  await _applyDraft(entry.draft);
  entry.applied = true;
  console.log('[applyQuickStartAtIndex] POST-APPLY state snapshot:', { mode: state.scenario.mode, actorCount: state.actors.length, actorNames: state.actors.map(a => a.name), title: state.scenario.title });
  // Also clear global draft if it matches
  state.ui.quickStartDraft = null;
  updateAiAssistantApplyButton();
  saveState();
}

async function _applyDraft(draft) {
  console.log('[_applyDraft] draft.type:', draft.type, 'keys:', Object.keys(draft));
  if (draft.type === "patch") {
    console.log('[_applyDraft] PATCH branch — changes keys:', draft.changes ? Object.keys(draft.changes) : 'NO CHANGES');
    const hadConversation = state.messages.length > 0;
    applyAssistantPatch(draft.changes);
    state.ui.quickStartStatus = "Changes applied.";
    saveState();
    if (hadConversation) {
      const { addMessage } = await import('./turns.js');
      await addMessage({
        type: "system",
        speaker: "System",
        content: `Session updated by AI Assistant patch.`,
        color: "var(--coral)"
      });
    }
    return;
  }
  console.log('[_applyDraft] FULL SETUP branch — normalizing draft with keys:', Object.keys(draft));
  const normalized = normalizeQuickStartConfig(draft);
  console.log('[_applyDraft] normalized result:', { mode: normalized.scenario?.mode, systems: normalized.scenario?.systems ? Object.keys(normalized.scenario.systems) : 'NONE', actorCount: normalized.actors?.length, dmEnabled: normalized.dm?.enabled, hasSettings: !!normalized.settings, hasAutoStop: !!normalized.autoStop });
  const hadConversation = state.messages.length > 0;
  state.scenario = normalized.scenario;
  state.actors = normalized.actors;
  let directorActor = state.actors.find(a => a.canDirect);
  if (!directorActor && normalized.dm && normalized.dm.enabled !== false) {
    // Look for an actor with the same name to promote
    const nameLower = (normalized.dm.name || "").toLowerCase();
    if (nameLower) {
      directorActor = state.actors.find(a => a.name.toLowerCase() === nameLower);
    }
    if (directorActor) {
      directorActor.canDirect = true;
    } else {
      // Create a brand new director
      directorActor = {
        id: crypto.randomUUID(),
        name: normalized.dm.name || "Director",
        role: "Director",
        persona: normalized.dm.persona || "",
        goal: "Guide the discussion.",
        voice: "",
        temperature: 0.8,
        authority: 90,
        canDirect: true,
        canManageCast: false,
        canResearch: false,
        canSeeThoughts: !!(normalized.dm.canSeeThoughts || normalized.dm.seesPrivateThoughts),
        enabled: true,
        thoughts: "",
        color: colors[state.actors.length % colors.length]
      };
      state.actors.push(directorActor);
    }
  }

  if (directorActor && normalized.dm) {
    directorActor.enabled = normalized.dm.enabled;
    directorActor.name = normalized.dm.name || directorActor.name;
    directorActor.persona = normalized.dm.persona || directorActor.persona;
    directorActor.canSeeThoughts = !!(normalized.dm.canSeeThoughts || normalized.dm.seesPrivateThoughts);
    directorActor.thoughts = "";
  }
  // Apply AI-suggested settings if present
  if (normalized.settings) {
    const ns = normalized.settings;
    for (const [key, val] of Object.entries(ns)) {
      if (val !== null && val !== undefined) state.settings[key] = val;
    }
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
  console.log('[applyAssistantPatch] changes:', JSON.stringify(changes, null, 2).slice(0, 500));
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
      authority: typeof a.authority === "number" ? a.authority : 50,
      canDirect: !!a.isDirector || !!a.canDirect,
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
      if (rest.isDirector !== undefined) target.canDirect = !!rest.isDirector;
      if (rest.isManager !== undefined) target.canManageCast = !!rest.isManager;
      if (rest.isResearcher !== undefined) target.canResearch = !!rest.isResearcher;
    }
  }

  // Scenario (partial deep merge)
  if (c.scenario && typeof c.scenario === "object") {
    for (const [key, val] of Object.entries(c.scenario)) {
      if (val === null || val === undefined) continue;
      if (key === "systems" && typeof val === "object") {
        if (!state.scenario.systems) state.scenario.systems = {};
        for (const [sysKey, sysVal] of Object.entries(val)) {
          if (sysVal === null || sysVal === undefined) continue;
          if (typeof sysVal === "object") {
            state.scenario.systems[sysKey] = {
              ...state.scenario.systems[sysKey],
              ...sysVal
            };
          } else {
            state.scenario.systems[sysKey] = sysVal;
          }
        }
      } else {
        state.scenario[key] = val;
      }
    }
  }

  // Director (partial + promotion/creation)
  if (c.dm && typeof c.dm === "object") {
    let director = state.actors.find(a => a.canDirect);
    if (!director && c.dm.enabled !== false) {
      // Look for an actor with the same name to promote
      const nameLower = (c.dm.name || "").toLowerCase();
      if (nameLower) {
        director = state.actors.find(a => a.name.toLowerCase() === nameLower);
      }
      if (director) {
        director.canDirect = true;
      } else {
        // Create a brand new director
        director = {
          id: crypto.randomUUID(),
          name: c.dm.name || "Director",
          role: "Director",
          persona: c.dm.persona || "",
          goal: "Guide the discussion.",
          voice: "",
          temperature: 0.8,
          authority: 90,
          canDirect: true,
          canManageCast: false,
          canResearch: false,
          canSeeThoughts: !!c.dm.canSeeThoughts || !!c.dm.seesPrivateThoughts,
          enabled: true,
          thoughts: "",
          color: colors[state.actors.length % colors.length]
        };
        state.actors.push(director);
      }
    }
    if (director) {
      if (c.dm.enabled !== undefined) director.enabled = !!c.dm.enabled;
      if (c.dm.name !== undefined) director.name = c.dm.name;
      if (c.dm.persona !== undefined) director.persona = c.dm.persona;
      if (c.dm.canSeeThoughts !== undefined) director.canSeeThoughts = !!c.dm.canSeeThoughts;
      if (c.dm.seesPrivateThoughts !== undefined) director.canSeeThoughts = !!c.dm.seesPrivateThoughts;
    }
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

  // UserContext (partial)
  if (c.userContext && typeof c.userContext === "object") {
    if (!state.userContext) state.userContext = {};
    for (const [key, val] of Object.entries(c.userContext)) {
      if (val === null || val === undefined) continue;
      if (key === "pausePolicy" && typeof val === "object") {
        state.userContext.pausePolicy = {
          ...state.userContext.pausePolicy,
          ...val
        };
      } else {
        state.userContext[key] = val;
      }
    }
  }

  saveState();
}

// ─── Session History ────────────────────────────────────────────────────────

export async function saveCurrentSession() {
  if (!state.scenario?.title && !state.messages.length) return; // nothing worth saving

  if (!state._currentSessionId) {
    state._currentSessionId = crypto.randomUUID();
  }

  // Snapshot messages and actors by VALUE — callers (e.g. forkSessionAtMessage)
  // mutate state.actors/state.messages immediately after saving, which would
  // otherwise corrupt the just-saved session through the shared reference.
  const session = {
    id: state._currentSessionId,
    timestamp: new Date().toISOString(),
    scenarioTitle: state.scenario.title || 'Untitled',
    actorCount: state.actors.filter(a => a.enabled).length,
    messageCount: state.messages.length,
    messages: state.messages.map(m => ({ ...m })),
    scenario: { ...state.scenario },
    memory: { ...state.memory },
    actors: state.actors.map(a => ({ ...a })),
  };

  // Keep at most 20 sessions; remove oldest others if over limit. Guard each
  // delete so one failure doesn't abort the whole save (the session itself
  // still needs to be written below).
  const existing = await getAllSessions();
  const others = existing.filter(s => s.id !== state._currentSessionId);
  for (const old of others.slice(19)) {
    try {
      await deleteSession(old.id);
    } catch (err) {
      console.warn('[sessions] prune failed:', err.message);
    }
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
    objective: "Generate at least 10 distinct ideas, cluster them into themes, and identify the top 3 most promising.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "moderate", nudgeStyle: "gentle-nudge" },
      turnRouting: { strategy: "dm-directed", allowDirectAddress: true },
      dmRole: { role: "facilitator", narrates: false, canIntroduceElements: false },
      document: { schema: "decisions" }
    }
  },
  risk: {
    mode: "problem",
    title: "Risk Assessment",
    premise: "The panel is analyzing a proposed plan or decision for risks, blind spots, and failure modes.",
    objective: "Identify all significant risks, rate likelihood and impact, and recommend mitigations for the top 3.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "strict", nudgeStyle: "hard-redirect" },
      turnRouting: { strategy: "round-robin", allowDirectAddress: true },
      dmRole: { role: "arbiter", narrates: false, canIntroduceElements: false },
      document: { schema: "findings" }
    }
  },
  debate: {
    mode: "problem",
    title: "Structured Debate",
    premise: "Two or more positions are presented. The panel must argue each side rigorously before reaching a verdict.",
    objective: "Steelman every position, identify the strongest objections, and converge on a reasoned verdict.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "strict", nudgeStyle: "hard-redirect" },
      turnRouting: { strategy: "round-robin", allowDirectAddress: true },
      dmRole: { role: "arbiter", narrates: false, canIntroduceElements: false },
      document: { schema: "findings" }
    }
  },
  retrospective: {
    mode: "problem",
    title: "Project Retrospective",
    premise: "The panel reviews a recently completed project or sprint to extract lessons.",
    objective: "Surface what went well, what went wrong, and produce a concrete list of process improvements.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "moderate", nudgeStyle: "gentle-nudge" },
      turnRouting: { strategy: "round-robin", allowDirectAddress: true },
      dmRole: { role: "facilitator", narrates: false, canIntroduceElements: false },
      document: { schema: "findings" }
    }
  },
  story: {
    mode: "story",
    title: "Collaborative Story",
    premise: "A group of characters finds themselves in an unfolding situation. The DM narrates the world.",
    objective: "Collaboratively build an engaging narrative with rising tension and satisfying resolution.",
    systems: {
      stageDirections: { enabled: true, intensity: "immersive", maxTokenShare: 0.4 },
      alignment: { strictness: "loose", anchorInPrompt: false, nudgeStyle: "question" },
      turnRouting: { strategy: "narrative-flow", allowDirectAddress: true },
      dmRole: { role: "narrator", narrates: true, canIntroduceElements: true },
      document: { schema: "story-bible" }
    }
  },
  interview: {
    mode: "freeform",
    title: "Expert Panel Interview",
    premise: "The user is interviewing a panel of specialists on their topic of choice.",
    objective: "Surface deep insights, surface disagreements between experts, and synthesize practical takeaways.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "moderate", nudgeStyle: "gentle-nudge" },
      turnRouting: { strategy: "dm-directed", allowDirectAddress: true },
      dmRole: { role: "observer", narrates: false, canIntroduceElements: false },
      document: { schema: "freeform" }
    }
  },
  improv: {
    mode: "story",
    title: "Collaborative Improv",
    premise: "Actors collaborate on an unscripted scene. There is no DM narration — characters drive the story themselves.",
    objective: "Build a coherent, entertaining scene through reactive character play. Say 'yes, and' to keep momentum.",
    systems: {
      stageDirections: { enabled: true, intensity: "moderate", maxTokenShare: 0.3 },
      alignment: { strictness: "loose", nudgeStyle: "question" },
      turnRouting: { strategy: "narrative-flow", allowDirectAddress: true },
      dmRole: { role: "observer", narrates: false, canIntroduceElements: false },
      document: { schema: "freeform" }
    }
  },
  problemsolving: {
    mode: "problem",
    title: "Problem Solving",
    premise: "The panel is focused on solving a well-defined problem with concrete constraints and a clear success criterion.",
    objective: "Arrive at a specific, actionable solution with clear implementation steps and trade-off rationale.",
    systems: {
      stageDirections: { enabled: false },
      alignment: { strictness: "strict", anchorInPrompt: true, nudgeStyle: "hard-redirect" },
      turnRouting: { strategy: "dm-directed", allowDirectAddress: true },
      dmRole: { role: "arbiter", narrates: false, canIntroduceElements: false },
      document: { schema: "findings" }
    }
  }
};

export function applyScenarioPreset(key) {
  const preset = SCENARIO_PRESETS[key];
  if (!preset) return;
  state.scenario = {
    ...state.scenario,
    ...preset,
    systems: {
      ...state.scenario.systems,
      ...(preset.systems || {}),
      stageDirections: { ...state.scenario.systems?.stageDirections, ...(preset.systems?.stageDirections || {}) },
      alignment:        { ...state.scenario.systems?.alignment,        ...(preset.systems?.alignment        || {}) },
      turnRouting:      { ...state.scenario.systems?.turnRouting,      ...(preset.systems?.turnRouting      || {}) },
      dmRole:           { ...state.scenario.systems?.dmRole,           ...(preset.systems?.dmRole           || {}) },
      document:         { ...state.scenario.systems?.document,         ...(preset.systems?.document         || {}) },
    },
  };
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

// ── Blueprints & configurations ──────────────────────────────────────────────

// Build a full actor record from a library/template partial. Unlike
// normalizeQuickStartActor (which drops scheduling/permission fields), this
// preserves the orchestration fields a blueprint cast relies on.
function buildActorFromTemplate(tpl, index) {
  const palette = ['#2a9d8f', '#7c5cbf', '#4a7fd4', '#c97a40', '#e76f51', '#457b9d', '#c8a830'];
  const a = {
    id: crypto.randomUUID(),
    name: tpl.name || `Actor ${index + 1}`,
    role: tpl.role || 'Participant',
    persona: tpl.persona || '',
    goal: tpl.goal || '',
    voice: tpl.voice || '',
    thoughts: '',
    relationships: {},
    enabled: true,
    expanded: false,
    canDirect: !!tpl.canDirect,
    canManageCast: !!tpl.canManageCast,
    canInject: !!tpl.canInject,
    canResearch: !!tpl.canResearch,
    canSeeThoughts: !!tpl.canSeeThoughts,
    authority: tpl.authority ?? 50,
    turnSchedule: tpl.turnSchedule || 'normal',
    actorMode: tpl.actorMode || 'participant',
    triggerOn: Array.isArray(tpl.triggerOn) ? [...tpl.triggerOn] : [],
    temperature: tpl.temperature ?? 0.8,
    color: tpl.color || palette[index % palette.length],
  };
  if (tpl.maxTokens != null) a.maxTokens = tpl.maxTokens;
  return a;
}

function mergeScenario(target, src) {
  const sys = src.systems || {};
  const cur = target.systems || {};
  return {
    ...target,
    ...src,
    systems: {
      ...cur,
      ...sys,
      stageDirections: { ...cur.stageDirections, ...(sys.stageDirections || {}) },
      alignment:       { ...cur.alignment,       ...(sys.alignment       || {}) },
      turnRouting:     { ...cur.turnRouting,     ...(sys.turnRouting     || {}) },
      dmRole:          { ...cur.dmRole,          ...(sys.dmRole          || {}) },
      document:        { ...cur.document,        ...(sys.document        || {}) },
    },
  };
}

// Apply a blueprint: scenario + systems + a fresh cast. Does not touch the
// existing transcript — the caller decides whether to clear it first.
export async function applyBlueprint(id) {
  const { getBlueprint, blueprintCast } = await import('./blueprints.js');
  const bp = getBlueprint(id);
  if (!bp) return;

  const actors = blueprintCast(id).map(buildActorFromTemplate);
  const normalized = normalizeState({
    ...state,
    scenario: mergeScenario(state.scenario, bp.scenario || {}),
    actors,
    autoStop: { ...state.autoStop, ...(bp.autoStop || {}), roundsRun: 0 },
  });
  setState(normalized);
  state.turnQueue = [];
  saveState();
  setStatus(`Blueprint "${bp.label}" applied.`, 'ok');
}

// User-saved configurations (setup only — no transcript) live in localStorage.
const CONFIG_KEY = 'forum_configurations';
const MAX_CONFIGS = 30;

export function listConfigurations() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveConfiguration(name) {
  const configs = listConfigurations();
  const config = {
    id: crypto.randomUUID(),
    name: (name || state.scenario?.title || 'Configuration').trim().slice(0, 80),
    savedAt: new Date().toISOString(),
    actorCount: (state.actors || []).filter(a => a.enabled).length,
    scenario: { ...state.scenario },
    actors: (state.actors || []).map(a => ({ ...a })),
    autoStop: { ...state.autoStop },
    settings: {
      temperature: state.settings?.temperature,
      maxTokens: state.settings?.maxTokens,
      topP: state.settings?.topP,
      repeatPenalty: state.settings?.repeatPenalty,
      toolsEnabled: state.settings?.toolsEnabled,
    },
  };
  configs.unshift(config);
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(configs.slice(0, MAX_CONFIGS)));
    setStatus(`Configuration "${config.name}" saved.`, 'ok');
  } catch {
    setStatus('Could not save configuration (storage full?).', 'error');
  }
  return config;
}

// Apply a saved configuration: scenario + cast + generation settings. Leaves the
// transcript untouched.
export function applyConfiguration(config) {
  if (!config) return;
  const normalized = normalizeState({
    ...state,
    scenario: { ...state.scenario, ...(config.scenario || {}) },
    actors: Array.isArray(config.actors) && config.actors.length ? config.actors : state.actors,
    autoStop: { ...state.autoStop, ...(config.autoStop || {}), roundsRun: 0 },
    settings: { ...state.settings, ...(config.settings || {}) },
  });
  setState(normalized);
  state.turnQueue = [];
  saveState();
  setStatus(`Configuration "${config.name || 'Untitled'}" applied.`, 'ok');
}

export function deleteConfiguration(id) {
  const configs = listConfigurations().filter(c => c.id !== id);
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(configs));
  } catch { /* ignore */ }
}
