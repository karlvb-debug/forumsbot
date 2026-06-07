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
      state.scenario.task ? `**Task:** ${state.scenario.task}` : '',
      state.scenario.doneWhen ? `**Done When:** ${state.scenario.doneWhen}` : '',
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
        temperature: state.settings.temperature
      },
      scenario: scenarioWithoutMode(state.scenario),
      autoStop: {
        roundsRun: state.autoStop.roundsRun
      },
      sessionMetrics: calculateSessionMetrics(messages),
      telemetry: {},
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
    // Strip UI quick-start draft history (contains raw LLM output, not session content)
    if (cleanState.ui) {
      cleanState.ui = { ...cleanState.ui };
      delete cleanState.ui.quickStartDraft;
    }

    // Audit for sensitive fields and add warnings
    const exportWarnings = [];
    if (cleanState.settings) {
      cleanState.settings = { ...cleanState.settings };
      if (cleanState.settings.apiKey) {
        exportWarnings.push("API key was stripped from this export.");
        delete cleanState.settings.apiKey;
      }
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

function scenarioWithoutMode(scenario = {}) {
  const { mode: _legacyMode, ...cleanScenario } = scenario || {};
  return cleanScenario;
}

export async function resetSession(fullReset = false) {
  try { await clearMessages(); } catch (err) { console.warn("clearMessages failed:", err); }
  try { await clearChunks(); } catch (err) { console.warn("clearChunks failed:", err); }

  if (fullReset) {
    setState(structuredClone(defaultState));
  } else {
    const keepConfig = {
      settings: state.settings,
      scenario: scenarioWithoutMode(state.scenario),
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
        scenario: { ...scenarioWithoutMode(state.scenario), ...scenarioWithoutMode(preset.scenario || {}) },
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




export async function generateQuickStart(promptOverride = "") {
  if (!state.settings.model) {
    setQuickStartStatus("Choose a model first.");

    return;
  }
  const prompt = (promptOverride || state.ui.quickStartPrompt || "").trim();
  if (!prompt) {
    setQuickStartStatus("Type a request first.");
    return;
  }
  state.ui.quickStartPrompt = "";


  setQuickStartStatus("Thinking…");

  const currentConfig = {
    scenario: scenarioWithoutMode(state.scenario),
    dm: (() => { const d = state.actors.find(a => a.canDirect); return d ? { enabled: d.enabled, name: d.name, persona: d.persona, canSeeThoughts: d.canSeeThoughts } : { enabled: false }; })(),
    actors: state.actors.map(a => ({ name: a.name, role: a.role, persona: a.persona, goal: a.goal, voice: a.voice, enabled: a.enabled, temperature: a.temperature, authority: a.authority ?? 50, canDirect: !!a.canDirect, canManageCast: !!a.canManageCast, canResearch: !!a.canResearch, canWriteDocuments: !!a.canWriteDocuments, canSeeThoughts: !!a.canSeeThoughts, canInject: !!a.canInject, canPause: !!a.canPause, canAnchor: !!a.canAnchor, canPinFacts: !!a.canPinFacts, canSuggestSpeaker: !!a.canSuggestSpeaker, canUpdateStyle: !!a.canUpdateStyle, directorMode: a.directorMode })),
    settings: {
      temperature: state.settings.temperature,
      maxTokens: state.settings.maxTokens ?? 2000,
      topP: state.settings.topP ?? 1.0,
      repeatPenalty: state.settings.repeatPenalty ?? 1.1,
      toolsEnabled: !!state.settings.toolsEnabled,
      globalStyleEnabled: state.settings.globalStyleEnabled !== false,
      globalStylePrompt: state.settings.globalStylePrompt || "",
      streamingEnabled: state.settings.streamingEnabled !== false,
      showThoughts: state.settings.showThoughts,
      turboMode: !!state.settings.turboMode,

      enableCrossSessionMemory: !!state.settings.enableCrossSessionMemory,
      turnDelay: state.settings.turnDelay ?? 0,
    },
    documentWriting: { ...(state.documentWriting || {}) },
    documents: (state.documents || []).map(d => ({ id: d.id, title: d.title, aiEditable: d.aiEditable, enabled: d.enabled, purpose: d.purpose, format: d.format, writerId: d.writerId })),
    autoStop: { enabled: state.autoStop.enabled, goalCheckEnabled: state.autoStop.goalCheckEnabled, stopOnAllSkip: state.autoStop.stopOnAllSkip, maxRoundsEnabled: state.autoStop.maxRoundsEnabled, maxRounds: state.autoStop.maxRounds },
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
  "addActors": [{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"authority":50,"canDirect":false,"canManageCast":false,"canResearch":false,"canWriteDocuments":false,"canSeeThoughts":false,"canInject":false,"canPause":true,"canAnchor":true,"canPinFacts":true,"canSuggestSpeaker":true,"canUpdateStyle":true,"directorMode":"facilitator|narrator|arbiter|observer"}],
  "removeActors": ["ActorName"],
  "modifyActors": [{"find":"ActorName","name":"...","role":"...","persona":"...","goal":"...","voice":"...","enabled":true,"temperature":0.9,"authority":70,"canDirect":false,"canManageCast":false,"canResearch":false,"canWriteDocuments":false,"canSeeThoughts":false,"canInject":false,"canPause":true,"canAnchor":true,"canPinFacts":true,"canSuggestSpeaker":true,"canUpdateStyle":true,"directorMode":"facilitator|narrator|arbiter|observer"}],
  "scenario": {"title":"...","premise":"...","task":"...","doneWhen":"...","systems":{"stageDirections":{"enabled":false,"intensity":"minimal|moderate|immersive","maxTokenShare":0.2},"alignment":{"strictness":"strict|moderate|loose|off"},"turnRouting":{"strategy":"sequential|agentic","allowDirectAddress":true},"dmRole":{"role":"narrator|facilitator|arbiter|observer","narrates":false,"canIntroduceElements":false}}},
  "settings": {"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"seed":-1,"seedEnabled":false,"toolsEnabled":false,"globalStyleEnabled":true,"globalStylePrompt":"Use plain everyday language unless the user, scenario, or actor voice asks for a different style.","streamingEnabled":true,"showThoughts":false,"turboMode":false,"enableCrossSessionMemory":false,"turnDelay":0},
  "memory": {"addFacts":["fact text"],"removeFacts":["text to match and remove"],"sharedSummary":"...","openQuestions":"...","dmState":"..."},
  "autoStop": {"enabled":true,"goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5},
  "userContext": {"interactionMode":"sponsor|collaborator|observer","displayName":"","storyRole":""}
}`;

  const fullSetupShape = `{"scenario":{"title":"","premise":"","task":"","doneWhen":"","systems":{"stageDirections":{"enabled":false,"intensity":"moderate","maxTokenShare":0.2},"alignment":{"strictness":"moderate"},"turnRouting":{"strategy":"sequential","allowDirectAddress":true},"dmRole":{"role":"facilitator","narrates":false,"canIntroduceElements":false}}},"actors":[{"name":"","role":"","persona":"","goal":"","voice":"","enabled":true,"temperature":0.8,"authority":50,"canDirect":false,"canManageCast":false,"canResearch":false,"canWriteDocuments":false,"canSeeThoughts":false,"canInject":false,"canPause":true,"canAnchor":true,"canPinFacts":true,"canSuggestSpeaker":true,"canUpdateStyle":true,"directorMode":"facilitator|narrator|arbiter|observer"}],"memory":{"pinnedFacts":[],"sharedSummary":"","openQuestions":"","dmState":""},"settings":{"temperature":0.8,"maxTokens":2000,"topP":0.95,"repeatPenalty":1.1,"seed":-1,"seedEnabled":false,"toolsEnabled":false,"globalStyleEnabled":true,"globalStylePrompt":"Use plain everyday language unless the user, scenario, or actor voice asks for a different style.","streamingEnabled":true,"showThoughts":false,"turboMode":false,"enableCrossSessionMemory":false,"turnDelay":0},"autoStop":{"enabled":false,"goalCheckEnabled":true,"stopOnAllSkip":true,"maxRoundsEnabled":false,"maxRounds":5},"userContext":{"interactionMode":"collaborator","displayName":"","storyRole":""}}`;

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
    "",
    "## KEY CONCEPTS",
    "Forum runs multiple LLM 'actors' in rounds. Each round fires every enabled actor once. Actors see a shared transcript but not each other's private thoughts.",
    "Special actor roles: Director (canDirect) — moderates, can inject private guidance into other actors, manages flow. Manager (canManageCast) — adds/removes/silences actors dynamically based on discussion needs. Researcher (canResearch) — has live web search and page reading tools. Writer (canWriteDocuments) — handles explicit document-writing tasks.",
    "",
    "## CORE CONTEXT (scenario fields)",
    "title: Session name shown in UI.",
    "premise: Background context injected into every prompt. Use for setting, constraints, background info.",
    "task: What the group should accomplish. Injected into every actor prompt. Guides the conversation direction. The alignment system measures drift against this.",
    "doneWhen: Concrete completion criteria. Enables the auto-stop judge. When set, the system periodically checks if these criteria are met and stops automatically. Leave blank for open-ended conversations.",
    "",
    "## ACTOR FIELDS",
    "name: Display name in transcript.",
    "role: One-line job title (e.g. 'Risk Analyst', 'Village Elder').",
    "persona: Up to 700 chars, 2nd person. Personality, expertise, behavioral constraints.",
    "goal: The actor's personal responsibility — what they focus on (e.g. 'Identify risks', 'Keep discussion flowing'). NOT the session goal. Labelled 'Responsibility' in prompts.",
    "voice: Up to 120 chars. Writing style/tone (e.g. 'Dry and precise', 'Speaks in riddles'). When set, REPLACES the global style for this actor — saves tokens and avoids conflicting instructions. Leave blank to inherit global style.",
    "temperature: 0-2, default 0.8. Higher = more creative/varied. Use 0.6-0.7 for analytical roles, 1.0-1.2 for creative/roleplay characters.",
    "authority: 0-100, default 50. How much weight other actors give this actor's claims. 80+ = domain expert (others defer), 20- = junior voice (others may challenge). Neutral band is 36-64.",
    "canDirect: Allows this actor to act as Director/DM. directorMode sets their style: 'facilitator' (guides discussion), 'narrator' (narrates scenes), 'arbiter' (settles disputes), 'observer' (speaks only when addressed).",
    "canManageCast: Allows this actor to create, enable, or disable other actors dynamically based on discussion needs.",
    "canResearch: Allows this actor to use live web search ([SEARCH: query]) and page reading ([READ: url]) tools. Requires toolsEnabled=true in settings.",
    "canWriteDocuments: Allows this actor to edit shared documents.",
    "canSeeThoughts: Allows this actor to read other actors' private thoughts / reasoning.",
    "canInject: Allows this actor to inject private prompt guidance or whispers into other actors' next turns.",
    "canSuggestSpeaker: Allows this actor to recommend who should take the next turn.",
    "canAnchor: Allows this actor to propose settled group agreements to pin as context.",
    "canPinFacts: Allows this actor to propose undisputed facts to add to the pinned list.",
    "canPause: Allows this actor to issue pause requests to ask the user for feedback mid-round.",
    "canUpdateStyle: Allows this actor to update the global conversation style rules.",
    "enabled: Whether the actor participates. Silenced actors stay in the roster but skip turns.",
    "",
    "## SCENARIO SYSTEMS",
    "stageDirections: Enables roleplay/narrative mode. enabled=true activates it. intensity ('minimal|moderate|immersive') controls how much environmental description actors add. maxTokenShare (0-1) caps how much of each response can be stage direction.",
    "alignment: Controls topic drift enforcement via periodic task reminders. strictness ('strict|moderate|loose|off') — strict: reminder every 3 turns, moderate: every 5, loose: every 8, off: no reminders.",
    "turnRouting: strategy='sequential' rotates through actors in order. strategy='agentic' uses an LLM call to pick who speaks next based on conversation context. allowDirectAddress lets actors nominate the next speaker.",
    "dmRole: role sets the Director's mode. narrates=true enables scene narration. canIntroduceElements=true lets the Director add world elements.",
    "",
    "## SETTINGS (key fields)",
    "temperature: Global default (actors can override individually).",
    "maxTokens: Max response length (default 2000).",
    "toolsEnabled: Enables web search/read tools for Researchers.",
    "globalStyleEnabled + globalStylePrompt: Baseline writing style for all actors WITHOUT a voice field. Actors with voice ignore global style entirely.",
    "streamingEnabled: Show responses as they generate.",
    "showThoughts: Enable private reasoning (increases quality but uses more tokens).",
    "turboMode: Disables private thoughts for faster responses.",
    "turnDelay: Milliseconds to wait between actor turns (0 = instant).",
    "",
    "## AUTO-STOP",
    "enabled: Whether auto-stop is active.",
    "goalCheckEnabled: Run the completion judge after each round (requires doneWhen to be set).",
    "stopOnAllSkip: Stop if every actor skips in the same round.",
    "maxRoundsEnabled + maxRounds: Stop after N rounds.",
    "",
    "## ROLEPLAY CHECKLIST",
    "For stories/roleplay: set stageDirections.enabled=true, dmRole.role='narrator', dmRole.narrates=true, dmRole.canIntroduceElements=true, turnRouting.strategy='agentic', alignment.strictness='loose'. Create character actors with temp 1.0-1.2. ALWAYS include actors in fullSetup.",
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
  const looksLikeSetup = /\b(set up|create|add|change|modify|update|remove|configure|actors?|scenario|settings?|story|roleplay)\b/i.test(prompt);
  const userContent = (looksLikeSetup || !hasContext)
    ? "Current config:\n" + JSON.stringify(currentConfig, null, 2) + "\n\nRequest: " + prompt
    : "Request: " + prompt;
  messages.push({ role: "user", content: userContent });

  // Add user bubble immediately
  if (!Array.isArray(state.ui.quickStartHistory)) state.ui.quickStartHistory = [];
  state.ui.quickStartHistory.push({ role: "user", content: prompt });


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
    console.debug('[generateQuickStart] LLM response type:', type, 'hasChanges:', !!parsed.changes, 'topLevelKeys:', Object.keys(parsed).join(','));

    if (type === "patch") {
      // The LLM may put patch fields at the top level or nested under "changes"
      let changes = (parsed.changes && typeof parsed.changes === "object") ? parsed.changes : null;
      if (!changes) {
        // Check if patch fields are at the top level (LLM didn't nest under "changes")
        const patchKeys = ["addActors", "removeActors", "modifyActors", "scenario", "dm", "settings", "memory", "autoStop", "userContext"];
        const found = patchKeys.filter(k => parsed[k] !== undefined);
        if (found.length > 0) {
          console.debug('[generateQuickStart] Auto-wrapping top-level patch keys:', found);
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
        console.debug('[generateQuickStart] Unwrapping fullSetup fields from changes wrapper');
        setupSource = { ...parsed, ...parsed.changes };
        delete setupSource.changes;
      }
      console.debug('[generateQuickStart] fullSetup source keys:', Object.keys(setupSource).join(','), 'actors:', Array.isArray(setupSource.actors) ? setupSource.actors.length : 'NONE');
      state.ui.quickStartDraft = normalizeQuickStartConfig(setupSource);
      state.ui.quickStartHistory.push({ role: "assistant", content: raw, type: "fullSetup", message, draft: state.ui.quickStartDraft });
      setQuickStartStatus("Full setup ready — click Apply to replace current scenario.");
    }

    saveState();

  } catch (error) {
    state.ui.quickStartHistory.push({ role: "assistant", content: "", type: "error", message: error.message || "Request failed." });
    setQuickStartStatus("Error: " + (error.message || "Request failed."));

  } finally {

  }
}



export { normalizeQuickStartConfig, normalizeQuickStartActor, cleanConfigText };


export async function applyQuickStartAtIndex(index) {
  console.debug('[applyQuickStartAtIndex] called with index:', index);
  const history = state.ui.quickStartHistory || [];
  const entry = history[index];
  console.debug('[applyQuickStartAtIndex] entry:', entry ? { type: entry.type, hasDraft: !!entry.draft, applied: entry.applied, draftType: entry.draft?.type, draftKeys: entry.draft ? Object.keys(entry.draft) : null } : 'NOT FOUND');
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
  console.debug('[applyQuickStartAtIndex] PRE-APPLY state snapshot:', { actorCount: state.actors.length, actorNames: state.actors.map(a => a.name) });
  await _applyDraft(entry.draft);
  entry.applied = true;
  console.debug('[applyQuickStartAtIndex] POST-APPLY state snapshot:', { actorCount: state.actors.length, actorNames: state.actors.map(a => a.name), title: state.scenario.title });
  // Also clear global draft if it matches
  state.ui.quickStartDraft = null;

  saveState();
}

async function _applyDraft(draft) {
  console.debug('[_applyDraft] draft.type:', draft.type, 'keys:', Object.keys(draft));
  if (draft.type === "patch") {
    console.debug('[_applyDraft] PATCH branch — changes keys:', draft.changes ? Object.keys(draft.changes) : 'NO CHANGES');
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
  console.debug('[_applyDraft] FULL SETUP branch — normalizing draft with keys:', Object.keys(draft));
  const normalized = normalizeQuickStartConfig(draft);
  console.debug('[_applyDraft] normalized result:', { systems: normalized.scenario?.systems ? Object.keys(normalized.scenario.systems) : 'NONE', actorCount: normalized.actors?.length, dmEnabled: normalized.dm?.enabled, hasSettings: !!normalized.settings, hasAutoStop: !!normalized.autoStop });
  const hadConversation = state.messages.length > 0;
  state.scenario = normalized.scenario;
  state.actors = normalized.actors;
  let directorActor = state.actors.find(a => a.canDirect);
  const scenarioDirectorMode = normalized.scenario?.systems?.dmRole?.role || 'facilitator';
  if (!directorActor && normalized.dm && normalized.dm.enabled !== false) {
    // Look for an actor with the same name to promote
    const nameLower = (normalized.dm.name || "").toLowerCase();
    if (nameLower) {
      directorActor = state.actors.find(a => a.name.toLowerCase() === nameLower);
    }
    if (directorActor) {
      directorActor.canDirect = true;
      if (!directorActor.directorMode) directorActor.directorMode = scenarioDirectorMode;
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
        canInject: true,
        canWriteDocuments: false,
        canPause: true,
        canAnchor: true,
        canPinFacts: true,
        canSuggestSpeaker: true,
        canUpdateStyle: true,
        directorMode: scenarioDirectorMode,
        enabled: true,
        thoughts: "",
        color: colors[state.actors.length % colors.length]
      };
      state.actors.push(directorActor);
    }
  } else if (directorActor && !directorActor.directorMode) {
    directorActor.directorMode = scenarioDirectorMode;
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

}




export function setQuickStartStatus(message) {
  state.ui.quickStartStatus = message;
  saveState();
}





function normalizeAssistantActorPermissions(source = {}) {
  const out = { ...source };
  if (source.isDirector !== undefined) out.canDirect = !!source.isDirector;
  if (source.isManager !== undefined) out.canManageCast = !!source.isManager;
  if (source.isResearcher !== undefined) out.canResearch = !!source.isResearcher;
  if (source.isWriter !== undefined) out.canWriteDocuments = !!source.isWriter;
  delete out.isDirector;
  delete out.isManager;
  delete out.isResearcher;
  delete out.isWriter;
  return out;
}

export function applyAssistantPatch(changes) {
  console.debug('[applyAssistantPatch] changes:', JSON.stringify(changes, null, 2).slice(0, 500));
  const c = changes;

  // Actors — add
  for (const rawActor of (c.addActors || [])) {
    const a = normalizeAssistantActorPermissions(rawActor);
    const canDirect = !!a.canDirect;
    const actor = {
      id: crypto.randomUUID(),
      name: a.name || "New Actor",
      role: a.role || "Participant",
      persona: a.persona || "",
      goal: a.goal || "",
      voice: a.voice || "",
      temperature: typeof a.temperature === "number" ? a.temperature : 0.8,
      authority: typeof a.authority === "number" ? a.authority : 50,
      canDirect,
      canManageCast: !!a.canManageCast,
      canResearch: !!a.canResearch,
      canWriteDocuments: !!a.canWriteDocuments,
      canSeeThoughts: !!a.canSeeThoughts,
      directorMode: a.directorMode || (canDirect ? state.scenario?.systems?.dmRole?.role || 'facilitator' : undefined),
      enabled: true,
      thoughts: "",
      color: colors[state.actors.length % colors.length]
    };
    state.actors.push(actor);
    if (actor.canWriteDocuments && !state.documentWriting?.designatedWriterId) {
      if (!state.documentWriting) state.documentWriting = {};
      state.documentWriting.designatedWriterId = actor.id;
    }
  }

  // Actors — remove
  for (const name of (c.removeActors || [])) {
    const lower = name.toLowerCase();
    state.actors = state.actors.filter(a => a.name.toLowerCase() !== lower);
  }

  // Actors — modify
  for (const rawMod of (c.modifyActors || [])) {
    const mod = normalizeAssistantActorPermissions(rawMod);
    const target = state.actors.find(a => a.name.toLowerCase() === (mod.find || "").toLowerCase());
    if (target) {
      const { find: _find, ...rest } = mod;
      Object.assign(target, rest);
      if (target.canWriteDocuments && !state.documentWriting?.designatedWriterId) {
        if (!state.documentWriting) state.documentWriting = {};
        state.documentWriting.designatedWriterId = target.id;
      }
    }
  }

  // Scenario (partial deep merge)
  if (c.scenario && typeof c.scenario === "object") {
    for (const [key, val] of Object.entries(c.scenario)) {
      if (val === null || val === undefined) continue;
      if (key === "mode") continue;
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
        const role = val.dmRole?.role;
        if (role) {
          const director = state.actors.find(a => a.canDirect);
          if (director) director.directorMode = role;
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
        if (!director.directorMode) director.directorMode = state.scenario?.systems?.dmRole?.role || 'facilitator';
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
          canInject: true,
          canWriteDocuments: false,
          canPause: true,
          canAnchor: true,
          canPinFacts: true,
          canSuggestSpeaker: true,
          canUpdateStyle: true,
          directorMode: state.scenario?.systems?.dmRole?.role || 'facilitator',
          enabled: true,
          thoughts: "",
          color: colors[state.actors.length % colors.length]
        };
        state.actors.push(director);
      }
    }
    if (director) {
      if (!director.directorMode) director.directorMode = state.scenario?.systems?.dmRole?.role || 'facilitator';
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

// Serializes concurrent saves: auto-loop fires saveCurrentSession every round,
// and a manual save can overlap. Two simultaneous reads of getAllSessions() would
// both see the pre-prune list and race to delete the same old entries.
let _savingSession = false;

export async function saveCurrentSession() {
  if (!state.scenario?.title && !state.messages.length) return; // nothing worth saving
  if (_savingSession) return; // in-flight save will include current state
  _savingSession = true;

  try {
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
      scenario: scenarioWithoutMode(state.scenario),
      memory: { ...state.memory },
      actors: state.actors.map(a => ({ ...a })),
      documentWriting: { ...(state.documentWriting || {}) },
      documents: (state.documents || []).map(d => ({ ...d })),
      documentTasks: (state.documentTasks || []).map(t => ({ ...t })),
      pendingDocumentEdits: (state.pendingDocumentEdits || []).map(p => ({ ...p })),
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
  } finally {
    _savingSession = false;
  }
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

  // Restore document-related fields saved by saveCurrentSession
  if (session.documentWriting) {
    state.documentWriting = { ...(state.documentWriting || {}), ...session.documentWriting };
  }
  if (Array.isArray(session.documents)) {
    state.documents = session.documents;
    // Sync restored documents to IndexedDB so knowledge lookups find them
    const { putKbEntry } = await import('./knowledge.js');
    for (const doc of state.documents) {
      await putKbEntry(doc);
    }
  }
  if (Array.isArray(session.documentTasks)) {
    state.documentTasks = session.documentTasks;
  }
  if (Array.isArray(session.pendingDocumentEdits)) {
    state.pendingDocumentEdits = session.pendingDocumentEdits;
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



// ── Copy as Markdown ─────────────────────────────────────────────────────────

export async function copyMarkdownToClipboard() {
  const messages = await getAllMessages();

  const lines = [
    `# ${state.scenario.title || 'Forum Session'}`,
    state.scenario.premise ? `**Premise:** ${state.scenario.premise}` : '',
    state.scenario.task ? `**Task:** ${state.scenario.task}` : '',
    state.scenario.doneWhen ? `**Done When:** ${state.scenario.doneWhen}` : '',
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
    canWriteDocuments: !!tpl.canWriteDocuments,
    canSeeThoughts: !!tpl.canSeeThoughts,
    authority: tpl.authority ?? 50,
    cadence: tpl.cadence ?? null,
    actorMode: tpl.actorMode || 'participant',
    triggerOn: Array.isArray(tpl.triggerOn) ? [...tpl.triggerOn] : [],
    temperature: tpl.temperature ?? 0.8,
    color: tpl.color || palette[index % palette.length],
  };
  if (tpl.maxTokens != null) a.maxTokens = tpl.maxTokens;
  return a;
}

function mergeScenario(target, src) {
  const { mode: _legacyMode, ...cleanSrc } = src || {};
  const sys = cleanSrc.systems || {};
  const cur = target.systems || {};
  return {
    ...target,
    ...cleanSrc,
    systems: {
      ...cur,
      ...sys,
      stageDirections: { ...cur.stageDirections, ...(sys.stageDirections || {}) },
      alignment:       { ...cur.alignment,       ...(sys.alignment       || {}) },
      turnRouting:     { ...cur.turnRouting,     ...(sys.turnRouting     || {}) },
      dmRole:          { ...cur.dmRole,          ...(sys.dmRole          || {}) },
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

  // Blueprints declare their director's behavioral mode via systems.dmRole.role.
  // Map that onto the director actor's directorMode field so turns.js reads it
  // from the actor (the new source of truth) rather than the scenario systems.
  const bpDirectorMode = bp.scenario?.systems?.dmRole?.role;
  if (bpDirectorMode) {
    const director = actors.find(a => a.canDirect);
    if (director) director.directorMode = bpDirectorMode;
  }

  const designatedWriter = actors.find(a => a.canWriteDocuments);
  const normalized = normalizeState({
    ...state,
    scenario: mergeScenario(state.scenario, bp.scenario || {}),
    actors,
    documentWriting: { ...(state.documentWriting || {}), designatedWriterId: designatedWriter?.id || "" },
    autoStop: { ...state.autoStop, ...(bp.autoStop || {}), roundsRun: 0 },
  });
  setState(normalized);
  state.turnQueue = [];

  // Seed any working documents the blueprint declares. They are writable by the
  // designated writer through review-first Writer tasks and visible to all.
  if (Array.isArray(bp.documents) && bp.documents.length) {
    const { newDocument, putKbEntry, countWords } = await import('./knowledge.js');
    for (const spec of bp.documents) {
      const doc = newDocument({
        title: spec.title || 'Working Document',
        content: spec.content || '',
        purpose: spec.purpose || '',
        format: spec.format || '',
        writerId: designatedWriter?.id || '',
        aiEditable: true,
        enabled: true,
        wordCount: countWords(spec.content || ''),
      });
      await putKbEntry(doc);
    }
  }

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
    scenario: scenarioWithoutMode(state.scenario),
    actors: (state.actors || []).map(a => ({ ...a })),
    documentWriting: { ...(state.documentWriting || {}) },
    documents: (state.documents || []).map(d => ({ ...d })),
    autoStop: { ...state.autoStop },
    settings: {
      temperature: state.settings?.temperature,
      maxTokens: state.settings?.maxTokens,
      topP: state.settings?.topP,
      repeatPenalty: state.settings?.repeatPenalty,
      toolsEnabled: !!state.settings?.toolsEnabled,
      globalStyleEnabled: state.settings?.globalStyleEnabled !== false,
      globalStylePrompt: state.settings?.globalStylePrompt || "",
      streamingEnabled: state.settings?.streamingEnabled !== false,
      showThoughts: !!state.settings?.showThoughts,
      turboMode: !!state.settings?.turboMode,

      enableCrossSessionMemory: !!state.settings?.enableCrossSessionMemory,

      turnDelay: state.settings?.turnDelay,
      seed: state.settings?.seed,
      seedEnabled: !!state.settings?.seedEnabled,
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
    scenario: { ...scenarioWithoutMode(state.scenario), ...scenarioWithoutMode(config.scenario || {}) },
    actors: Array.isArray(config.actors) && config.actors.length ? config.actors : state.actors,
    documentWriting: { ...(state.documentWriting || {}), ...(config.documentWriting || {}) },
    documents: Array.isArray(config.documents) ? config.documents : state.documents,
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
