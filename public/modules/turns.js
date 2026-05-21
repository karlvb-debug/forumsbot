import { RECENT_MESSAGE_LIMIT, PROMPT_MESSAGE_LIMIT, WORD_LIMITS } from './constants.js';
import { state, saveState } from './state.js';
import { chatCompletion, chatJson, setStatus, setCurrentSpeaker, getLastToolCalls } from './api.js';
import { render, renderTranscript, renderAutoStop, renderDocument, readSettingsFromForm, readAutoStopFromForm, setBusy, getIsGenerating, els, labelForMode } from './render.js';
import { putMessage, getAllChunks } from './db.js';
import { summarizeMemory, recallRelevantChunks, formatCurrentOutcomes, parseOutcomeJson } from './memory.js';
import { cleanStoredMessage, parseAiJson, stringifyMessage, publicMessageContent, trimWords, stringifyList, estimateTokens } from './utils.js';

export let abortController = null;

export async function addMessage(message) {
  const storedMessage = cleanStoredMessage({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...message
  });
  state.messages.push(storedMessage);
  state.messages = state.messages.slice(-RECENT_MESSAGE_LIMIT);
  await putMessage(storedMessage);
  saveState();
  renderTranscript();
  return storedMessage;
}

export function buildTurnQueue() {
  const enabledIds = state.actors.filter((actor) => actor.enabled).map((actor) => actor.id);
  const queue = [...enabledIds];
  if (state.dm.enabled) queue.push("dm");
  state.turnQueue = queue;
  return queue;
}

export function nextParticipant() {
  const enabled = new Set(state.actors.filter((actor) => actor.enabled).map((actor) => actor.id));
  state.turnQueue = state.turnQueue.filter((id) => id === "dm" ? state.dm.enabled : enabled.has(id));
  if (!state.turnQueue.length) buildTurnQueue();
  const id = state.turnQueue.shift();
  if (!id) return null;
  state.turnQueue.push(id);
  if (id === "dm") return { kind: "dm", data: state.dm };
  const actor = state.actors.find((item) => item.id === id);
  return actor ? { kind: "actor", data: actor } : null;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

/** True for transient network errors worth retrying (LM Studio busy/overloaded). */
function isRetryableError(error) {
  if (error.name === "AbortError") return false;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("failed to fetch") ||
         msg.includes("network error") ||
         msg.includes("load failed") ||
         msg.includes("networkerror") ||
         msg.includes("connection refused") ||
         error.name === "TypeError";
}

async function countdownRetry(attempt, maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / 1000);
    setStatus(`LM Studio busy — retrying in ${left}s… (attempt ${attempt}/${MAX_RETRIES})`, "warn");
    await wait(500);
  }
}

export async function runNextTurn(options = {}) {
  readSettingsFromForm();
  if (!state.settings.model) {
    setStatus("Choose or type a model first.", "warn");
    return false;
  }
  if (abortController?.signal.aborted) return false;
  const participant = nextParticipant();
  if (!participant) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  setBusy(true);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (abortController?.signal.aborted) break;
    try {
      abortController = new AbortController();
      setCurrentSpeaker(participant.data.name);

      const result = participant.kind === "dm"
        ? await askDirector(participant.data, abortController.signal)
        : await askActor(participant.data, abortController.signal);
      result.toolCalls = getLastToolCalls();
      setCurrentSpeaker("");
      await applyAiResult(participant, result);
      if (state.memory.enabled && options.summarizeCycle !== false) {
        state.memory.turnsSinceSummary += 1;
        const cycleSize = participantCycleCount();
        if (state.memory.turnsSinceSummary >= cycleSize) {
          summarizeMemory("cycle");
        }
      }
      setStatus(`Last turn: ${participant.data.name}`, "ok");
      setBusy(false);
      abortController = null;
      return true;
    } catch (error) {
      lastError = error;
      setCurrentSpeaker("");
      abortController = null;

      if (error.name === "AbortError") {
        setStatus("Generation stopped.", "warn");
        setBusy(false);
        return false;
      }

      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        await countdownRetry(attempt + 1, delayMs);
        continue;
      }

      // Non-retryable or retries exhausted
      const msg = lastError.message || "Generation failed.";
      const label = attempt > 1 ? `${msg} (failed after ${attempt} attempts)` : msg;
      setStatus(label, "error");
      await addMessage({
        type: "system",
        speaker: "System",
        content: label,
        color: "var(--coral)"
      });
      setBusy(false);
      return false;
    }
  }

  // Aborted during retry loop
  setStatus("Generation stopped.", "warn");
  setBusy(false);
  return false;
}

export async function runRound(options = {}) {
  readSettingsFromForm();
  const count = state.actors.filter((actor) => actor.enabled).length + (state.dm.enabled ? 1 : 0);
  if (!count) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  const startIndex = state.messages.length;
  let completedTurns = 0;
  for (let index = 0; index < count; index += 1) {
    if (abortController?.signal.aborted) break;
    const ok = await runNextTurn({ summarizeCycle: false });
    if (!ok) break;
    completedTurns += 1;
  }
  const roundMessages = state.messages.slice(startIndex);
  if (roundMessages.length && state.memory.enabled) {
    state.memory.turnsSinceSummary = 0;
    summarizeMemory("round", roundMessages);
  }
  if (roundMessages.length) {
    const shouldStop = await evaluateAutoStopAfterRound(roundMessages, options);
    if (shouldStop) return false;
  }
  return completedTurns === count;
}

export function participantCycleCount() {
  return Math.max(1, state.actors.filter((actor) => actor.enabled).length + (state.dm.enabled ? 1 : 0));
}

export async function runAutoLoop() {
  const starting = !state.autoRunning;
  state.autoRunning = starting;
  if (starting) {
    state.autoStop.roundsRun = 0;
    setAutoStopStatus("Auto running.");
  } else {
    setAutoStopStatus("Auto paused.");
  }
  render();
  while (state.autoRunning) {
    const ok = await runRound({ fromAuto: true });
    if (!ok) {
      state.autoRunning = false;
      break;
    }
    await wait(450);
  }
  render();
}

export function stopGeneration() {
  state.autoRunning = false;
  abortController?.abort();
  setAutoStopStatus("Auto paused.");
  render();
}

export async function evaluateAutoStopAfterRound(roundMessages, options = {}) {
  readAutoStopFromForm();
  if (!state.autoStop.enabled) {
    saveState();
    return false;
  }

  state.autoStop.roundsRun += 1;

  if (state.autoStop.stopOnAllSkip && roundMessages.length && roundMessages.every((message) => message.type === "skip")) {
    return promptStopOrContinue("Everyone skipped this round. The forum may be out of useful things to add.", options);
  }

  if (state.autoStop.maxRoundsEnabled && state.autoStop.roundsRun >= state.autoStop.maxRounds) {
    return promptStopOrContinue(`Reached the ${state.autoStop.maxRounds}-round limit.`, options);
  }

  if (state.autoStop.goalCheckEnabled && state.autoStop.goal.trim()) {
    const verdict = await judgeGoal(roundMessages);
    if (verdict.achieved) {
      const confidence = Number.isFinite(verdict.confidence) ? ` (${Math.round(verdict.confidence * 100)}% confidence)` : "";
      return promptStopOrContinue(`Goal looks achieved${confidence}: ${verdict.reason || "The group appears to have satisfied the goal."}`, {
        ...options,
        suggestedGoal: verdict.nextGoalSuggestion
      });
    }
    setAutoStopStatus(`Goal not complete yet: ${verdict.reason || "Needs more discussion."}`);
  } else {
    setAutoStopStatus(`Round ${state.autoStop.roundsRun} complete. Auto-stop is watching for skips and limits.`);
  }

  saveState();
  renderAutoStop();
  return false;
}

export async function judgeGoal(roundMessages = [], options = {}) {
  readSettingsFromForm();
  if (!state.autoStop.goal.trim()) {
    setAutoStopStatus("Add a goal before checking.");
    return { achieved: false, confidence: 0, reason: "No goal set.", nextGoalSuggestion: "" };
  }
  if (!state.settings.model) {
    setAutoStopStatus("Choose or type a model before checking the goal.");
    return { achieved: false, confidence: 0, reason: "No model selected.", nextGoalSuggestion: "" };
  }

  const alreadyBusy = getIsGenerating();
  setBusy(true);
  setAutoStopStatus("Checking goal...");

  const chunks = await getAllChunks();
  const archiveText = chunks.slice(-6).map((chunk) => `- ${chunk.text}`).join("\n");
  const system = [
    "You judge whether a multi-actor AI forum has achieved a user-defined goal.",
    "Be conservative: mark achieved only when the transcript contains a concrete answer, decision, deliverable, or next-step plan matching the goal.",
    "Do not require perfect consensus, but do require enough substance that stopping would be reasonable.",
    "Return only valid JSON with this exact shape:",
    "{\"achieved\":false,\"confidence\":0.0,\"reason\":\"short reason\",\"nextGoalSuggestion\":\"optional next goal\"}"
  ].join("\n");
  const user = [
    `Goal:\n${state.autoStop.goal}`,
    scenarioBlock(),
    `Pinned facts:\n${state.memory.pinnedFacts || "None."}`,
    `Shared memory summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${state.memory.openQuestions || "None."}`,
    `Known outcomes:\n${formatCurrentOutcomes()}`,
    `Recent transcript:\n${formatTranscript(state.messages.slice(-24), 2200)}`,
    `Latest round:\n${formatTranscript(roundMessages, 900)}`,
    `Recent archive summaries:\n${archiveText || "None."}`
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.1, maxTokens: 500 });
    const parsed = parseOutcomeJson(content);
    const verdict = normalizeGoalVerdict(parsed);
    if (options.manual) {
      if (verdict.achieved) {
        await promptStopOrContinue(`Goal looks achieved: ${verdict.reason || "The group appears to have satisfied the goal."}`, {
          fromAuto: false,
          suggestedGoal: verdict.nextGoalSuggestion
        });
      } else {
        setAutoStopStatus(`Goal not complete yet: ${verdict.reason || "Needs more discussion."}`);
      }
    }
    return verdict;
  } catch (error) {
    const message = error.message || "Goal check failed.";
    setAutoStopStatus(message);
    return { achieved: false, confidence: 0, reason: message, nextGoalSuggestion: "" };
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

export function normalizeGoalVerdict(value) {
  const achievedValue = value?.achieved;
  const achieved = achievedValue === true || String(achievedValue).toLowerCase() === "true" || String(achievedValue).toLowerCase() === "yes";
  const confidence = Math.min(1, Math.max(0, Number(value?.confidence || 0)));
  return {
    achieved,
    confidence,
    reason: trimWords(stringifyList(value?.reason), 80),
    nextGoalSuggestion: trimWords(stringifyList(value?.nextGoalSuggestion), 80)
  };
}

export async function promptStopOrContinue(reason, options = {}) {
  state.autoRunning = false;
  setAutoStopStatus(reason);
  render();

  const shouldStop = window.confirm(`${reason}\n\nOK = stop here.\nCancel = enter a new goal and continue.`);
  if (shouldStop) {
    state.autoStop.roundsRun = 0;
    setAutoStopStatus(`Stopped: ${reason}`);
    saveState();
    render();
    return true;
  }

  const suggested = options.suggestedGoal || "";
  const newGoal = window.prompt("New goal to continue toward:", suggested);
  if (newGoal && newGoal.trim()) {
    state.autoStop.goal = newGoal.trim();
    state.autoStop.roundsRun = 0;
    setAutoStopStatus(options.fromAuto ? "New goal saved. Continuing Auto." : "New goal saved. Press Auto to continue.");
    if (options.fromAuto) state.autoRunning = true;
    saveState();
    render();
    return false;
  }

  state.autoStop.roundsRun = 0;
  setAutoStopStatus("Auto paused. No new goal was set.");
  saveState();
  render();
  return true;
}

export function setAutoStopStatus(message) {
  state.autoStop.status = message;
  if (els.autoStopStatus) els.autoStopStatus.textContent = message;
  saveState();
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function askActor(actor, signal) {
  const isStoryMode = state.scenario.mode === "story" || state.scenario.mode === "freeform";
  const contextLine = isStoryMode
    ? [
        "You are a character in an interactive roleplay/story.",
        "Stay in character at all times.",
        "IMPORTANT: The \"thought\" field is your PRIVATE out-of-character reasoning (strategy, analysis, what you notice). The \"message\" field is ONLY what you say and do IN CHARACTER. Never put analysis or meta-commentary in message.",
        "In your message, you MUST include physical actions wrapped in asterisks alongside your spoken dialogue. Show what your character physically does—gestures, expressions, movements, interactions with objects and the environment.",
        "Example of a good message: *peers through the undergrowth, gripping the strap of his pack* \"I don't like the look of that ravine.\" *takes a cautious step back, scanning the treeline*",
        state.dm.enabled
          ? "The Director (prefixed with [DIRECTOR] in the transcript) narrates the scene, settings, and consequences. Read the Director's narration carefully and react to it. Do not confuse the Director's words with other characters' speech."
          : ""
      ].filter(Boolean).join("\n")
    : "You are one participant in a local AI forum. You can read the public transcript, but not other actors' private thoughts. You can optionally describe actions with asterisks, e.g. *nods in agreement*.";

  const relationships = relationshipBlock(actor);
  const system = [
    `You are ${actor.name}.`,
    actor.role ? `Role: ${actor.role}` : "",
    actor.persona ? `Persona: ${actor.persona}` : "",
    actor.goal ? `Personal goal: ${actor.goal}` : "",
    actor.voice ? `Voice: ${actor.voice}` : "",
    relationships,
    contextLine,
    "Messages labelled [USER] in the transcript are from the human facilitator. Always acknowledge and respond to their instructions directly.",
    "For every turn, think privately first, then either speak or skip.",
    "Skip when you have nothing new to add, when another actor already said your point, or when waiting would help.",
    isStoryMode
      ? "Return only valid JSON: {\"thought\":\"your PRIVATE reasoning (not shown to others)\",\"action\":\"speak or skip\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}"
      : state.document.enabled
        ? "Return only valid JSON: {\"thought\":\"private reasoning\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}."
        : "Return only valid JSON with this exact shape: {\"thought\":\"private reasoning for your memory\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}.",
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.",
    state.document.enabled
      ? [
          "SHARED DOCUMENT: The group is collaborating on a shared document. The current content is shown in your context.",
          "To add content, include a \"documentEdit\" field with your new text. It will be appended to the end automatically.",
          "Example: {\"documentEdit\": \"## Key Findings\\n- Finding one\\n- Finding two\"}",
          "To fix a specific part, use: {\"documentEdit\": \"[REPLACE: old text here] new text here\"}",
          "Write ONLY your actual content in documentEdit — do not write instructions or operation names, just the text itself.",
          "Omit documentEdit entirely if you have no changes to propose."
        ].join("\n")
      : "",
    (!isStoryMode && state.settings.toolsEnabled)
      ? (() => {
          const lastUserMsg = [...state.messages].reverse().find((m) => m.type === "user");
          const userWantsSearch = lastUserMsg && /search|look.?up|research|find out|check|googl|web|online/i.test(lastUserMsg.content || "");
          return [
            userWantsSearch
              ? "IMPORTANT: The user has explicitly asked for a web search. You MUST use [SEARCH: your query] in your thought field before responding. Do not skip the search."
              : "WEB TOOLS: You can search the web or read a page before speaking if you need current facts.",
            "To use a tool, put the tag INSIDE your thought field — the system will execute it and return results before you finalise your message:",
            "{\"thought\":\"I need current data. [SEARCH: best quantization methods for local LLMs 2025]\",\"action\":\"speak\",\"message\":\"\"}",
            "Use [SEARCH: your query] to search the web, or [READ: https://example.com] to read a specific page."
          ].join("\n");
        })()
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "actor", actor });

  return chatJson(system, user, actor.temperature ?? state.settings.temperature, signal);
}

export async function askDirector(dm, signal) {
  const privateThoughts = state.dm.seesPrivateThoughts ? privateThoughtDigest() : "";
  const isStoryMode = state.scenario.mode === "story" || state.scenario.mode === "freeform";
  const modeInstruction = isStoryMode
    ? "You are the narrative DM. Describe the environment, atmosphere, sounds, and consequences of the characters' actions using rich descriptive narration wrapped in asterisks. Frame scene beats, introduce complications, and advance the story. Do NOT speak for the characters—react to what they do and set the stage for their next moves."
    : "Help move the exchange forward. Surface decisions, conflicts, and next questions. Summarize when useful and invite quieter actors in without taking over.";

  const system = [
    `You are ${dm.name}, the DM/director for a local AI forum.`,
    dm.persona ? `Style: ${dm.persona}` : "",
    modeInstruction,
    "Messages labelled [USER] in the transcript are from the human facilitator. Acknowledge and act on their instructions.",
    "Do not dominate the forum. You may skip if the actors are already progressing.",
    "You can describe physical actions, scenery changes, or narrator actions by surrounding them with asterisks, e.g. *the wind howls in the background* or *gestures to the map*.",
    state.document.enabled
      ? "Return only valid JSON: {\"thought\":\"private note\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}."
      : "Return only valid JSON with this exact shape: {\"thought\":\"private director note\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}.",
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.",
    state.document.enabled
      ? [
          "SHARED DOCUMENT: As director, you can edit the shared document via the \"documentEdit\" field.",
          "Write your new content directly — it is appended automatically.",
          "To fix specific text, use: {\"documentEdit\": \"[REPLACE: old text] new text\"}",
          "Write ONLY actual content, not instructions or operation names."
        ].join("\n")
      : "",
    (!isStoryMode && state.settings.toolsEnabled)
      ? (() => {
          const lastUserMsg = [...state.messages].reverse().find((m) => m.type === "user");
          const userWantsSearch = lastUserMsg && /search|look.?up|research|find out|check|googl|web|online/i.test(lastUserMsg.content || "");
          return [
            userWantsSearch
              ? "IMPORTANT: The user has asked for a web search. Use [SEARCH: query] in your thought field."
              : "WEB TOOLS: Use [SEARCH: query] or [READ: url] inside your thought field to look things up.",
            "{\"thought\":\"[SEARCH: latest local LLM benchmarks 2025]\",\"action\":\"speak\",\"message\":\"\"}"
          ].join("\n");
        })()
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "dm", dm, privateThoughts });

  return chatJson(system, user, state.settings.temperature, signal);
}

// Token budget: soft ceiling before the response. ~1 token per 4 chars.
// Degrade gracefully: drop chunks → trim dmState → trim summary → reduce transcript.
const PROMPT_TOKEN_BUDGET = 3800;

export async function buildPromptContext({ kind, actor, dm, privateThoughts = "" }) {
  const participant = kind === "actor" ? actor : dm;
  let recentMessages = state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  let recallChunks = state.memory.enabled ? await recallRelevantChunks(kind === "actor" ? actor : null) : [];
  const participantMemory = kind === "actor"
    ? `Your private actor memory:\n${trimWords(actor.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`
    : `Your private director notes:\n${trimWords(dm.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`;

  // Role reminder appended at the bottom ("lost in the middle" mitigation).
  // Small models pay most attention to start and end of prompt.
  const roleReminder = kind === "actor" && (participant.role || participant.goal || participant.voice)
    ? [
        `Reminder — you are ${participant.name}${participant.role ? `, ${participant.role}` : ""}.`,
        participant.goal ? `Your goal: ${participant.goal}` : "",
        participant.voice ? `Your voice: ${participant.voice}` : ""
      ].filter(Boolean).join(" ")
    : "";

  // Build sections and enforce token budget with graceful degradation.
  const buildSections = (chunks, msgs) => [
    scenarioBlock(),
    state.memory.enabled ? memoryBlock(chunks) : "",
    state.document.enabled
      ? `### Shared Document: "${state.document.title}"\n---\n${state.document.content || "(Empty — start drafting.)" }\n---`
      : "",
    participantMemory,
    privateThoughts,
    `### Recent transcript\n${formatTranscript(msgs, WORD_LIMITS.recentTranscript)}`,
    roleReminder,
    kind === "actor" ? "Take your next turn now." : "Take the director turn now."
  ].filter(Boolean).join("\n\n");

  let assembled = buildSections(recallChunks, recentMessages);

  // Stage 1: drop lowest-scored chunks until under budget
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 1) {
    recallChunks = recallChunks.slice(1); // oldest / lowest-scored is first after sort
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 2: trim transcript to 4 messages minimum
  let transcriptLimit = PROMPT_MESSAGE_LIMIT;
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && transcriptLimit > 4) {
    transcriptLimit -= 2;
    recentMessages = state.messages.slice(-transcriptLimit);
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 3: drop all chunks
  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 0) {
    recallChunks = [];
    assembled = buildSections(recallChunks, recentMessages);
  }

  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET) {
    console.warn(`[budget] Prompt still over budget (${estimateTokens(assembled)} tokens) after all degradation steps.`);
  }

  return assembled;
}

export function memoryBlock(recallChunks) {
  const chunkText = recallChunks.length
    ? recallChunks.map((chunk, index) => `${index + 1}. ${trimWords(chunk.text || chunk.summary || "", WORD_LIMITS.chunk)}`).join("\n")
    : "No older archived memory recalled.";
  const deltaText = state.memory.recentDeltas?.length
    ? state.memory.recentDeltas.join("\n")
    : "";
  return [
    "### Long-term memory",
    state.memory.pinnedFacts ? `**Pinned facts:**\n${trimWords(state.memory.pinnedFacts, WORD_LIMITS.sharedSummary)}` : "Pinned facts: none.",
    state.memory.sharedSummary ? `**Shared summary:**\n${trimWords(state.memory.sharedSummary, WORD_LIMITS.sharedSummary)}` : "Shared summary: none yet.",
    deltaText ? `**Recent updates (since last full summary):**\n${deltaText}` : "",
    state.memory.openQuestions ? `**Open questions:**\n${trimWords(state.memory.openQuestions, WORD_LIMITS.openQuestions)}` : "Open questions: none recorded.",
    state.dm.enabled && state.memory.dmState ? `**DM state:**\n${trimWords(state.memory.dmState, WORD_LIMITS.dmState)}` : "",
    `**Relevant archived memory:**\n${chunkText}`
  ].filter(Boolean).join("\n");
}

export function formatTranscript(messages, wordLimit = WORD_LIMITS.recentTranscript) {
  if (!messages.length) return "No public messages yet.";
  const text = messages
    .filter((m) => m.type !== "system") // system notices aren't part of the conversation
    .map((message) => {
      const name = message.speaker || state.actors.find((a) => a.id === message.actorId)?.name || "Forum";
      if (message.type === "user")   return `[USER] ${name}: ${publicMessageContent(message)}`;
      if (message.type === "dm")     return `[DIRECTOR] ${name}: ${publicMessageContent(message)}`;
      if (message.type === "skip")   return `[${name} skipped]`;
      return `${name}: ${publicMessageContent(message)}`;
    }).join("\n");
  return trimWords(text, wordLimit);
}

export async function applyAiResult(participant, result) {
  console.log(`[applyAiResult] ${participant.data.name}:`, {
    action: result.action,
    thoughtLen: result.thought?.length || 0,
    toolCalls: result.toolCalls?.length || 0,
    docEdit: result.documentEdit ? result.documentEdit.length : 0,
    messagePreview: result.message?.slice(0, 80)
  });

  // Apply document edit if present
  const speakerName = participant.kind === "dm" ? state.dm.name : participant.data.name;
  if (result.documentEdit && state.document.enabled) {
    applyDocumentEdit(speakerName, result.documentEdit);
  }
  const docEdited = !!(result.documentEdit && state.document.enabled);

  if (participant.kind === "dm") {
    state.dm.thoughts = appendMemory(state.dm.thoughts, result.thought);
    if (result.action === "skip") {
      return addMessage({ type: "skip", speaker: state.dm.name, content: "Skipped.", thought: result.thought, color: "var(--gold)", toolCalls: result.toolCalls || [], docEdited });
    }
    return addMessage({ type: "dm", speaker: state.dm.name, content: result.message, thought: result.thought, color: "var(--gold)", toolCalls: result.toolCalls || [], docEdited });
  }

  const actor = participant.data;
  actor.thoughts = appendMemory(actor.thoughts, result.thought);
  if (result.action === "skip") {
    return addMessage({ type: "skip", actorId: actor.id, speaker: actor.name, content: "Skipped.", thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited });
  }
  return addMessage({ type: "actor", actorId: actor.id, speaker: actor.name, content: result.message, thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited });
}

function applyDocumentEdit(author, editText) {
  // Guard: reject bare operation keywords with no content
  const bareKeyword = /^(append|replace|full|edit|update|insert|add|write|none|n\/a|null|undefined|\{\}|\[\])$/i;
  if (bareKeyword.test(editText.trim())) {
    console.warn(`[document] ${author} sent bare keyword "${editText.trim()}", ignoring.`);
    return;
  }

  const prev = state.document.content;
  let newContent = prev;
  let opLabel = "append";

  // [FULL] — explicit full replacement
  if (/^\[FULL\]/i.test(editText)) {
    newContent = editText.replace(/^\[FULL\]\s*/i, "").trim();
    opLabel = "full replace";
  }
  // [REPLACE: old text] new text — surgical find-and-replace
  else if (/^\[REPLACE:/i.test(editText)) {
    const match = editText.match(/^\[REPLACE:\s*([\s\S]*?)\]\s*([\s\S]*)$/i);
    if (match) {
      const findText = match[1].trim();
      const replaceText = match[2].trim();
      if (prev.includes(findText)) {
        newContent = prev.replace(findText, replaceText);
        opLabel = "replace";
      } else {
        // Fuzzy: try case-insensitive match
        const idx = prev.toLowerCase().indexOf(findText.toLowerCase());
        if (idx !== -1) {
          newContent = prev.slice(0, idx) + replaceText + prev.slice(idx + findText.length);
          opLabel = "replace (fuzzy)";
        } else {
          // Can't find target — append instead
          newContent = prev + (prev ? "\n\n" : "") + replaceText;
          opLabel = "replace→append (not found)";
        }
      }
    }
  }
  // Default: APPEND to the end
  else {
    const cleaned = editText.replace(/^\[APPEND\]\s*/i, "").trim();
    if (cleaned) {
      newContent = prev + (prev ? "\n\n" : "") + cleaned;
    }
  }

  if (newContent === prev) return;

  state.document.versions.push({
    author,
    content: prev,
    timestamp: new Date().toISOString()
  });
  if (state.document.versions.length > (state.document.maxVersions || 20)) {
    state.document.versions = state.document.versions.slice(-(state.document.maxVersions || 20));
  }
  state.document.content = newContent;
  saveState();
  renderDocument();
  console.log(`[document] ${author} ${opLabel} (${newContent.length} chars, ${state.document.versions.length} versions)`);
}

export function appendMemory(existing, thought) {
  if (!thought) return existing || "";
  const entries = [existing, `[${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}] ${thought}`]
    .filter(Boolean)
    .join("\n");
  return entries.split("\n").slice(-14).join("\n");
}

export function scenarioBlock() {
  return [
    `Mode: ${labelForMode(state.scenario.mode)}`,
    `Title: ${state.scenario.title || "Untitled forum"}`,
    state.scenario.premise ? `Premise: ${state.scenario.premise}` : "",
    state.scenario.objective ? `Objective: ${state.scenario.objective}` : ""
  ].filter(Boolean).join("\n");
}

export function publicTranscript() {
  return formatTranscript(state.messages.slice(-PROMPT_MESSAGE_LIMIT), WORD_LIMITS.recentTranscript);
}

export function privateThoughtDigest() {
  const actorNotes = state.actors
    .filter((actor) => actor.enabled && actor.thoughts)
    .map((actor) => `${actor.name}: ${actor.thoughts}`)
    .join("\n\n");
  return actorNotes ? `Private actor thoughts:\n${actorNotes}` : "";
}

/**
 * Format an actor's relationship ledger as a compact prompt block.
 * Only included when the actor has at least one relationship recorded.
 */
export function relationshipBlock(actor) {
  const entries = Object.entries(actor.relationships || {});
  if (!entries.length) return "";
  const lines = entries.map(([name, note]) => `- ${name}: ${note}`).join("\n");
  return `Your current read on the other participants:\n${lines}`;
}
