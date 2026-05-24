import { RECENT_MESSAGE_LIMIT, PROMPT_MESSAGE_LIMIT, WORD_LIMITS, ANCHOR_WORD_CAP } from './constants.js';
import { state, saveState, logTransition, logWarning } from './state.js';
import { chatCompletion, chatJson, setStatus, setCurrentSpeaker, getLastToolCalls } from './api.js';
import { render, renderTranscript, renderAutoStop, renderDocument, readSettingsFromForm, readAutoStopFromForm, setBusy, getIsGenerating, els, labelForMode, showStreamingBubble, updateStreamingBubble, removeStreamingBubble } from './render.js';
import { putMessage, getAllChunks, getActorMemory, putActorMemory } from './db.js';
import { summarizeMemory, recallRelevantChunks, formatCurrentOutcomes, parseOutcomeJson, extractOutcomes } from './memory.js';
import { cleanStoredMessage, parseAiJson, stringifyMessage, publicMessageContent, trimWords, stringifyList, estimateTokens, checkDrift } from './utils.js';
import { alignLineAttributions, calculateTurnMetrics, updateSemanticAlignment, calculateToolUsefulness, calculateInfluenceBudget } from './telemetry.js';
import { preflightSkipCheck } from './preflight.js';

export let abortController = null;
let _lastPromptParts = null;

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

      const startTime = Date.now();

      // ── Phase 1: Skip/Speak decision ─────────────────────────────
      // preflightSkipCheck returns {shouldSkip: false} when enablePreflightRouter is off.
      // When router is on and Phase 1 says "speak", set twoPhase=true so askActor()
      // skips the action/skip instruction and focuses Phase 2 purely on content.
      let twoPhase = false;
      if (participant.kind === 'actor') {
        const preflight = await preflightSkipCheck(
          participant.data,
          state.messages,
          state.scenario
        );
        if (preflight.shouldSkip) {
          setCurrentSpeaker('');
          await addMessage({
            type: 'skip',
            speaker: participant.data.name,
            actorId: participant.data.id,
            color: participant.data.color,
            content: '',
            preflightSkipped: true,
            trace: {
              preflightReason: preflight.reason,
              preflightConfidence: preflight.confidence,
              latencyMs: Date.now() - startTime
            }
          });
          setStatus(`${participant.data.name} pre-screened: ${preflight.reason}`, 'ok');
          setBusy(false);
          abortController = null;
          return true;
        }
        // Phase 1 committed to speak — Phase 2 focuses on content only (no skip re-check)
        if (state.settings.enablePreflightRouter) twoPhase = true;
      }

      // Show a streaming bubble so the user sees activity immediately.
      // updateStreamingBubble() fills in message text as tokens arrive.
      const streamingColor = participant.kind === "dm" ? "var(--gold)" : (participant.data.color || "var(--accent)");
      showStreamingBubble(participant.data.name, streamingColor, participant.kind === "dm" ? "dm" : "actor");
      const onStream = (messageText) => updateStreamingBubble(messageText);

      const result = participant.kind === "dm"
        ? await askDirector(participant.data, abortController.signal, onStream)
        : await askActor(participant.data, abortController.signal, onStream, twoPhase);

      // Remove the streaming placeholder; renderTranscript() from addMessage will paint the real card.
      removeStreamingBubble();
      const latencyMs = Date.now() - startTime;

      result.toolCalls = getLastToolCalls();
      setCurrentSpeaker("");

      const completionTokens = result._completionTokens || 0;
      const promptTokens = result._promptTokens || 0;
      const tokenSpeed = latencyMs > 0 ? Number((completionTokens / (latencyMs / 1000)).toFixed(2)) : 0;
      const cost = Number(((promptTokens * 0.00015 + completionTokens * 0.0006) / 1000).toFixed(4));

      result.trace = {
        promptSent: state.settings.includeTraces ? {
          system: result._promptParts?.system || "",
          scenario: result._promptParts?.scenario || "",
          persona: result._promptParts?.persona || "",
          proceduralMemory: result._promptParts?.proceduralMemory || "",
          workMemory: result._promptParts?.workMemory || "",
          recentMessages: result._promptParts?.recentMessages || "",
          toolLogs: result.toolCalls?.length ? JSON.stringify(result.toolCalls, null, 2) : ""
        } : null,
        latencyMs,
        tokenSpeed,
        model: state.settings.model,
        promptTokens,
        completionTokens,
        cost,
        parseFailure: !!result._parseFailure,
        rawCompletion: result._rawCompletion || ""
      };

      // Compute turn metrics for primary result
      const previousMessages = [...state.messages];
      const objective = state.scenario.objective || "";
      const premise = state.scenario.premise || "";
      const messageContent = result.message || "";
      result.metrics = calculateTurnMetrics(messageContent, previousMessages, objective, premise);

      // ── Parallel Hypothesis Sampling ────────────────────────────────
      // Generate N-1 more candidates and select the best by composite score.
      // Only triggers for actor turns where sampling is enabled and the turn
      // is meaningful (action === 'speak', not a skip/document edit).
      if (
        participant.kind === 'actor' &&
        state.settings.enableHypothesisSampling &&
        result.action === 'speak' &&
        result.message
      ) {
        const n = Math.min(3, Math.max(2, state.settings.hypothesisSampleCount ?? 2)) - 1;
        try {
          // Generate N-1 additional candidates in parallel
          const extras = await Promise.all(
            Array.from({ length: n }, () =>
              askActor(participant.data, abortController?.signal).catch(() => null)
            )
          );

          const candidates = [result, ...extras.filter(Boolean)];

          // Score each candidate
          const scored = candidates.map(c => {
            const m = calculateTurnMetrics(c.message || '', previousMessages, objective, premise);
            c.metrics = m;
            // Composite: novelty + premiseAlignment + specificity, weighted
            c._compositeScore = (m.noveltyScore * 0.4) + (m.premiseAlignmentScore * 0.4) + (m.specificityScore * 0.2);
            return c;
          });

          scored.sort((a, b) => b._compositeScore - a._compositeScore);

          if (state.settings.hypothesisAutoSelect) {
            // Auto-pick: use best, store the rest as alternatives
            const best = scored[0];
            best.alternativeCandidates = scored.slice(1).map(c => ({
              message: c.message,
              thought: c.thought,
              metrics: c.metrics,
              compositeScore: c._compositeScore
            }));
            Object.assign(result, best);
          } else {
            // Manual-select: store all as alternatives for user to choose
            result.alternativeCandidates = scored.slice(1).map(c => ({
              message: c.message,
              thought: c.thought,
              metrics: c.metrics,
              compositeScore: c._compositeScore
            }));
            result.hypothesisPendingSelection = true;
          }

          logTransition('hypothesis_sampled', null, null, {
            actor: participant.data.name,
            candidateCount: candidates.length,
            selectedScore: scored[0]._compositeScore
          });
        } catch (err) {
          console.warn('[hypothesis] Sampling failed, using primary result:', err.message);
        }
      }

      await applyAiResult(participant, result);

      // Sprint 6: Tool Usefulness Score — computed after applyAiResult so we have the final message
      if (participant.kind === 'actor' && result.toolCalls?.length && result.message) {
        const usefulnessScore = calculateToolUsefulness(
          result.toolCalls.map(tc => tc.result || tc.content || ''),
          result.message
        );
        if (result.trace) result.trace.toolUsefulnessScore = usefulnessScore;
      }

      // Sprint 6: Distill cross-session actor memory (fire-and-forget)
      if (participant.kind === 'actor' && result.thought && state.settings.enableCrossSessionMemory !== false && !state.settings.turboMode) {
        distillActorMemory(participant.data.name, result.thought).catch(err =>
          console.warn('[cross-session-memory] distill failed:', err.message)
        );
      }

      if (!state.settings.turboMode) await updateSemanticAlignment();
      if (state.memory.enabled && options.summarizeCycle !== false && !state.settings.turboMode) {
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
      removeStreamingBubble();
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
  if (roundMessages.length && state.memory.enabled && !state.settings.turboMode) {
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
  extractOutcomes();
}

export function stopGeneration() {
  state.autoRunning = false;
  abortController?.abort();
  setAutoStopStatus("Auto paused.");
  render();
  extractOutcomes();
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
    `Pinned facts:\n${(Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : state.memory.pinnedFacts) || "None."}`,
    `Shared memory summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${(Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : state.memory.openQuestions) || "None."}`,
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

  const modal = typeof document !== "undefined" ? document.getElementById("stopOrContinueModal") : null;
  const reasonEl = typeof document !== "undefined" ? document.getElementById("modalReason") : null;
  const goalInput = typeof document !== "undefined" ? document.getElementById("modalGoalInput") : null;
  const stopBtn = typeof document !== "undefined" ? document.getElementById("modalStopButton") : null;
  const pauseBtn = typeof document !== "undefined" ? document.getElementById("modalPauseButton") : null;
  const continueBtn = typeof document !== "undefined" ? document.getElementById("modalContinueButton") : null;

  if (!modal || !reasonEl || !goalInput || !stopBtn || !pauseBtn || !continueBtn) {
    // Graceful fallback to native browser prompts (e.g. testing or incomplete DOM)
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

  // Use the custom glassmorphic modal
  return new Promise((resolve) => {
    reasonEl.textContent = reason;
    const suggested = options.suggestedGoal || "";
    goalInput.value = suggested;

    // Enable/disable Continue button dynamically based on input content
    const updateButtonState = () => {
      continueBtn.disabled = !goalInput.value.trim();
    };
    goalInput.addEventListener("input", updateButtonState);
    updateButtonState();

    // Show modal
    modal.style.display = "flex";
    // Trigger transition Reflow
    modal.getBoundingClientRect();
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");

    const cleanup = () => {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
      setTimeout(() => {
        modal.style.display = "none";
      }, 250); // Matches the CSS opacity transition duration

      stopBtn.removeEventListener("click", handleStop);
      pauseBtn.removeEventListener("click", handlePause);
      continueBtn.removeEventListener("click", handleContinue);
      goalInput.removeEventListener("input", updateButtonState);
    };

    function handleStop() {
      cleanup();
      state.autoStop.roundsRun = 0;
      setAutoStopStatus(`Stopped: ${reason}`);
      saveState();
      render();
      resolve(true);
    }

    function handlePause() {
      cleanup();
      state.autoStop.roundsRun = 0;
      setAutoStopStatus("Auto paused. No new goal was set.");
      saveState();
      render();
      resolve(true);
    }

    function handleContinue() {
      const newGoal = goalInput.value.trim();
      if (!newGoal) return; // Prevent empty goals (should be blocked by disabled state)
      cleanup();
      state.autoStop.goal = newGoal;
      state.autoStop.roundsRun = 0;
      setAutoStopStatus(options.fromAuto ? "New goal saved. Continuing Auto." : "New goal saved. Press Auto to continue.");
      if (options.fromAuto) state.autoRunning = true;
      saveState();
      render();
      resolve(false);
    }

    stopBtn.addEventListener("click", handleStop);
    pauseBtn.addEventListener("click", handlePause);
    continueBtn.addEventListener("click", handleContinue);
  });
}

export function setAutoStopStatus(message) {
  state.autoStop.status = message;
  if (els.autoStopStatus) els.autoStopStatus.textContent = message;
  saveState();
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sprint 6 — Cross-Session Actor Memory.
 *
 * Distills the actor's private thought into one persistent memory sentence and
 * upserts it into IndexedDB. Runs async (fire-and-forget) — never blocks a turn.
 *
 * Memory format: up to 10 sentences, newest last, word-capped at 200.
 *
 * @param {string} actorName
 * @param {string} thought  - the actor's private thought from this turn
 */
export async function distillActorMemory(actorName, thought) {
  if (!thought?.trim() || !actorName) return;

  // Cheap distillation prompt — one sentence only
  const system = [
    `You distill a private character thought into one short persistent memory sentence for ${actorName}.`,
    'Rules: maximum 20 words; present tense; third-person or first-person OK; no filler.',
    'Output ONLY the sentence, nothing else.'
  ].join('\n');
  const user = `Thought: ${trimWords(thought, 80)}`;

  try {
    const raw = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 40 });
    const sentence = (raw || '').trim().split('\n')[0].trim();
    if (!sentence) return;

    // Append to existing memory, keep last 10 sentences, word-cap at 200
    const existing = await getActorMemory(actorName) || '';
    const sentences = existing
      ? [...existing.split('\n').filter(Boolean), sentence].slice(-10)
      : [sentence];
    const memory = trimWords(sentences.join('\n'), 200);
    await putActorMemory(actorName, memory);
  } catch {
    // Silently fail — never interrupt a turn
  }
}

export async function askActor(actor, signal, onStream = null, twoPhase = false) {
  const showThoughts = state.settings.showThoughts !== false && !state.settings.turboMode;
  // In two-phase mode, Phase 1 already decided to speak — Phase 2 never re-checks skip.
  // Researchers are exempt: they have their own skip logic and are not simplified.
  const skipAllowed = !twoPhase || !!actor.isResearcher;

  if (actor.isResearcher) {
    const system = [
      `You are ${actor.name}.`,
      `Role: ${actor.role || "Research Specialist"}`,
      `Goal: ${actor.goal || "Provide up-to-date objective research and answer open questions to ground the discussion."}`,
      `Voice: ${actor.voice || "Objective, fact-driven, structured with clear source citations."}`,
      actor.persona ? `Persona: ${actor.persona}` : "",
      "You are the Specialized Research Agent inside a local AI forum.",
      "Your sole purpose is to ground the discussion in objective facts and data by searching the web and reading webpages/documents.",
      "Do not express personal opinions, choose sides, or argue. Report only what can be verified.",
      "MANDATORY TOOL USE: You have access to real-time search and web page reading.",
      "For every turn, you MUST inspect the current 'Open questions', 'Pinned facts', and recent transcript to see if there are any unverified claims, missing details, or unresolved factual questions.",
      showThoughts
        ? "If research is needed, you MUST execute a search using the tag `[SEARCH: query]` (or `[READ: url]` to read a page) in your thought field."
        : "If research is needed, you MUST execute a search using the tag `[SEARCH: query]` (or `[READ: url]` to read a page) in your JSON thought field (keep it empty other than the tag).",
      showThoughts
        ? "For example: {\"thought\":\"I need to look up latest specifications. [SEARCH: react router v7 features]\",\"action\":\"speak\",\"message\":\"\"}"
        : "For example: {\"thought\":\"[SEARCH: react router v7 features]\",\"action\":\"speak\",\"message\":\"\"}",
      "Do not guess or assume. Always fetch ground truth using your tools.",
      "CRITICAL SKIP RULE: If there are no open questions, no unverified claims, or if you have already provided all relevant facts and no new research is required, you MUST set action to \"skip\" and leave message empty. Yielding the floor saves tokens and keeps the forum efficient.",
      "CONCISENESS & CITATIONS: When writing your research brief in the 'message' field, be highly structured, objective, and dense. For every factual claim you make, you MUST cite the source URL exactly as retrieved by the tool. Use clean markdown formatting.",
      (!showThoughts)
        ? "IMPORTANT: Private thoughts display is disabled. You MUST keep your JSON \"thought\" field empty (\"\") or containing only a tool tag to save token throughput and minimize latency."
        : "IMPORTANT: Private thoughts display is enabled. You can reason privately in your thought field before formulating your response.",
      state.document.enabled
        ? (showThoughts
            ? "Return only valid JSON: {\"thought\":\"private reasoning with tool tag\",\"action\":\"speak or skip\",\"message\":\"public research brief with citations\",\"documentEdit\":\"(optional) text to edit/add to the document\"}."
            : "Return only valid JSON: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public research brief with citations\",\"documentEdit\":\"(optional) text to edit/add to the document\"}.")
        : (showThoughts
            ? "Return only valid JSON with this exact shape: {\"thought\":\"private reasoning with tool tag\",\"action\":\"speak or skip\",\"message\":\"public research brief with citations, empty if skipping\"}."
            : "Return only valid JSON with this exact shape: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public research brief with citations, empty if skipping\"}."),
      "The JSON is transport only. Put natural public dialogue/briefs only inside message; do not make message itself JSON."
    ].filter(Boolean).join("\n");

    const user = await buildPromptContext({ kind: "actor", actor });
    return chatJson(system, user, actor.temperature ?? state.settings.temperature, signal);
  }

  const isStoryMode = state.scenario.mode === "story" || state.scenario.mode === "freeform";
  const contextLine = isStoryMode
    ? [
        "You are a character in an interactive roleplay/story.",
        "Stay in character at all times.",
        showThoughts
          ? "IMPORTANT: The \"thought\" field is your PRIVATE out-of-character reasoning (strategy, analysis, what you notice). The \"message\" field is ONLY what you say and do IN CHARACTER. Never put analysis or meta-commentary in message."
          : "IMPORTANT: Private thoughts display is disabled. Keep the JSON \"thought\" field empty. The \"message\" field is ONLY what you say and do IN CHARACTER. Never put analysis or meta-commentary in message.",
        "In your message, you MUST include physical actions wrapped in asterisks alongside your spoken dialogue. Show what your character physically does—gestures, expressions, movements, interactions with objects and the environment.",
        "Example of a good message: *peers through the undergrowth, gripping the strap of his pack* \"I don't like the look of that ravine.\" *takes a cautious step back, scanning the treeline*",
        state.dm.enabled
          ? "The Director (prefixed with [DIRECTOR] in the transcript) narrates the scene, settings, and consequences. Read the Director's narration carefully and react to it. Do not confuse the Director's words with other characters' speech."
          : ""
      ].filter(Boolean).join("\n")
    : "You are one participant in a local AI forum. You can read the public transcript, but not other actors' private thoughts.";

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
    skipAllowed
      ? (showThoughts
          ? "For every turn, think privately first, then either speak or skip."
          : "For every turn, decide whether to speak or skip directly.")
      : (showThoughts
          ? "You have been selected to speak this turn. Think privately, then deliver your message."
          : "You have been selected to speak this turn. Deliver your message directly."),
    skipAllowed
      ? (showThoughts
          ? "CRITICAL SKIP RULE: Ask yourself in your thoughts: 'Does my public message add new arguments, data, questions, or proposals?' If the answer is NO (e.g. you are just agreeing, repeating what someone else said, summarizing, or saying you have nothing to add), you MUST set action to \"skip\" and leave message empty. Yielding the floor is a positive, productive contribution that keeps the discussion efficient."
          : "CRITICAL SKIP RULE: If your public message does not add new arguments, data, questions, or proposals (e.g. you are just agreeing, repeating what someone else said, summarizing, or saying you have nothing to add), you MUST set action to \"skip\" and leave message empty. Yielding the floor is a positive, productive contribution that keeps the discussion efficient.")
      : "",
    "CONCISENESS RULE: Keep your public message brief, direct, and high-density. Avoid conversational filler (e.g. 'I agree with Anya', 'That's a good point', 'As an expert in...'). Speak ONLY to introduce new arguments, data, or questions. If a simple 'Yes' or single-sentence response is sufficient, keep it to exactly that. Do not generate words for the sake of it.",
    (!showThoughts)
      ? "IMPORTANT: Private thoughts display is disabled. You MUST keep your JSON \"thought\" field empty (\"\") to save tokens and minimize latency."
      : "",
    isStoryMode
      ? (skipAllowed
          ? (showThoughts
              ? "Return only valid JSON: {\"thought\":\"your PRIVATE reasoning (not shown to others)\",\"action\":\"speak or skip\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}"
              : "Return only valid JSON: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}")
          : (showThoughts
              ? "Return only valid JSON: {\"thought\":\"your PRIVATE reasoning (not shown to others)\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}"
              : "Return only valid JSON: {\"thought\":\"\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}"))
      : state.document.enabled
        ? (skipAllowed
            ? (showThoughts
                ? "Return only valid JSON: {\"thought\":\"private reasoning\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}."
                : "Return only valid JSON: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}.")
            : (showThoughts
                ? "Return only valid JSON: {\"thought\":\"private reasoning\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}."
                : "Return only valid JSON: {\"thought\":\"\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\"}."))
        : (skipAllowed
            ? (showThoughts
                ? "Return only valid JSON with this exact shape: {\"thought\":\"private reasoning for your memory\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}."
                : "Return only valid JSON with this exact shape: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}.")
            : (showThoughts
                ? "Return only valid JSON with this exact shape: {\"thought\":\"private reasoning for your memory\",\"message\":\"your public message\"}."
                : "Return only valid JSON with this exact shape: {\"thought\":\"\",\"message\":\"your public message\"}.")),
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON. Use plain text — no LaTeX notation (e.g. write 'leads to' not '\\rightarrow'), no markdown outside the message field.",
    state.document.enabled
      ? [
          "SHARED DOCUMENT: The group is collaborating on a shared document. The current content is shown in your context.",
          "To add content, include a \"documentEdit\" field with your new text. It will be appended to the end automatically.",
          "Example: {\"documentEdit\": \"## Key Findings\\n- Finding one\\n- Finding two\"}",
          "To fix a specific part, use: {\"documentEdit\": \"[REPLACE: old text here] new text here\"}",
          "Write ONLY your actual content in documentEdit — do not write instructions or operation names, just the text itself.",
          "CRITICAL: Do NOT output the entire document in documentEdit to just append something, as that will duplicate it. To overwrite the whole document, start with [FULL]. Otherwise, output only the new line/content, or use [REPLACE: old text] new text.",
          "Omit documentEdit entirely if you have no changes to propose."
        ].join("\n")
      : "",
    (!isStoryMode && state.settings.toolsEnabled)
      ? (() => {
          const lastUserMsg = [...state.messages].reverse().find((m) => m.type === "user");
          const userWantsSearch = lastUserMsg && /search|look.?up|research|find out|check|googl|web|online/i.test(lastUserMsg.content || "");
          return [
            userWantsSearch
              ? (showThoughts
                  ? "IMPORTANT: The user has explicitly asked for a web search. You MUST use [SEARCH: your query] in your thought field before responding. Do not skip the search."
                  : "IMPORTANT: The user has explicitly asked for a web search. You MUST use [SEARCH: your query] in your JSON thought field (keep it empty other than the tag). Do not skip the search.")
              : (showThoughts
                  ? "WEB TOOLS: You have access to real-time search and web page reading. You are STRONGLY ENCOURAGED to make liberal use of these tools rather than relying on stale training weights. Before explaining technical details, citing specs, recommending libraries, or comparing tools, perform a quick search to ensure your facts are current."
                  : "WEB TOOLS: You have access to real-time search and web page reading. You are STRONGLY ENCOURAGED to make liberal use of these tools rather than relying on stale training weights. Before explaining technical details, citing specs, recommending libraries, or comparing tools, perform a quick search to ensure your facts are current."),
            showThoughts
              ? "PROBLEM-SOLVING MODE RESEARCH DRILL: You are in problem-solving mode. Challenge assumptions and bring fresh external facts. If your turn requires citing specifications, library features, benchmarks, or API signatures, you are STRONGLY ENCOURAGED to run a search query (e.g. `[SEARCH: latest react router v7 features]`) to fetch ground truth."
              : "PROBLEM-SOLVING MODE RESEARCH DRILL: You are in problem-solving mode. Challenge assumptions and bring fresh external facts. If your turn requires citing specifications, library features, benchmarks, or API signatures, you are STRONGLY ENCOURAGED to run a search query (e.g. `[SEARCH: latest react router v7 features]`) using your thought field.",
            "To use a tool, embed the search tag INSIDE your thought field. The system will pause, fetch the results, and let you finalise your message:",
            showThoughts
              ? "{\"thought\":\"I need current data. [SEARCH: best quantization methods for local LLMs 2026]\",\"action\":\"speak\",\"message\":\"\"}"
              : "{\"thought\":\"[SEARCH: best quantization methods for local LLMs 2026]\",\"action\":\"speak\",\"message\":\"\"}",
            showThoughts
              ? "Use [SEARCH: your query] to search the web, or [READ: https://example.com] to read a specific page. Search early in the discussion to ground your inputs in actual facts."
              : "Use [SEARCH: your query] in your JSON thought field to search the web, or [READ: https://example.com] to read a specific page."
          ].join("\n");
        })()
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "actor", actor });
  const promptParts = {
    ..._lastPromptParts,
    system,
    persona: `Name: ${actor.name}\nRole: ${actor.role || ""}\nPersona: ${actor.persona || ""}\nVoice: ${actor.voice || ""}`
  };
  const result = await chatJson(system, user, actor.temperature ?? state.settings.temperature, signal, onStream);
  result._promptParts = promptParts;
  return result;
}

export async function askDirector(dm, signal, onStream = null) {
  const showThoughts = state.settings.showThoughts !== false && !state.settings.turboMode;
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
    "CRITICAL SKIP RULE: If you have no new guidance, summaries, or questions to introduce, you MUST set action to \"skip\" and leave message empty. This keeps the debate focused on the active actors.",
    "CONCISENESS RULE: Keep your directions, summaries, and questions brief and high-density. Avoid conversational padding (e.g. 'Excellent points everyone', 'Let's move on'). Aim for the minimum words required to guide the discussion or narrate scene beats. Do not dominate or generate words for the sake of it.",
    "You can describe physical actions, scenery changes, or narrator actions by surrounding them with asterisks, e.g. *the wind howls in the background* or *gestures to the map*.",
    "FLOW CONTROL: You can direct the conversation flow dynamically. If you want a specific actor to respond next, include their name in the optional \"nextSpeaker\" JSON field (case-insensitive, e.g. \"Anya\" or \"Ben\"). If you want the default turn order to continue, omit \"nextSpeaker\" or set it to empty.",
    (!showThoughts)
      ? "IMPORTANT: Private thoughts display is disabled. You MUST keep your JSON \"thought\" field empty (\"\") to save tokens and minimize latency."
      : "IMPORTANT: Private thoughts display is enabled. You can record private thoughts before outputting your direction.",
    state.document.enabled
      ? (showThoughts
          ? "Return only valid JSON: {\"thought\":\"private note\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\",\"nextSpeaker\":\"(optional) name of next actor to speak\"}."
          : "Return only valid JSON: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public message\",\"documentEdit\":\"(optional) text to add or edit\",\"nextSpeaker\":\"(optional) name of next actor to speak\"}.")
      : (showThoughts
          ? "Return only valid JSON: {\"thought\":\"private director note\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\",\"nextSpeaker\":\"(optional) name of next actor to speak\"}."
          : "Return only valid JSON: {\"thought\":\"\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\",\"nextSpeaker\":\"(optional) name of next actor to speak\"}."),
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.",
    state.document.enabled
      ? [
          "SHARED DOCUMENT: As director, you can edit the shared document via the \"documentEdit\" field.",
          "Write your new content directly — it is appended automatically.",
          "To fix specific text, use: {\"documentEdit\": \"[REPLACE: old text] new text\"}",
          "Write ONLY actual content, not instructions or operation names.",
          "CRITICAL: Do NOT output the entire document in documentEdit to just append something, as that will duplicate it. To overwrite the whole document, start with [FULL]. Otherwise, output only the new line/content, or use [REPLACE: old text] new text."
        ].join("\n")
      : "",
    (!isStoryMode && state.settings.toolsEnabled)
      ? (() => {
          const lastUserMsg = [...state.messages].reverse().find((m) => m.type === "user");
          const userWantsSearch = lastUserMsg && /search|look.?up|research|find out|check|googl|web|online/i.test(lastUserMsg.content || "");
          return [
            userWantsSearch
              ? (showThoughts
                  ? "IMPORTANT: The user has asked for a web search. Use [SEARCH: query] in your thought field."
                  : "IMPORTANT: The user has asked for a web search. Use [SEARCH: query] in your JSON thought field (keep it empty other than the tag).")
              : (showThoughts
                  ? "WEB TOOLS: You have access to live web tools. To guide the panel effectively, verify facts, or check recent benchmarks, you are STRONGLY ENCOURAGED to use [SEARCH: query] or [READ: url] inside your thought field rather than relying on stale information."
                  : "WEB TOOLS: You have access to live web tools. To guide the panel effectively, verify facts, or check recent benchmarks, you are STRONGLY ENCOURAGED to use [SEARCH: query] or [READ: url] inside your JSON thought field."),
            showThoughts
              ? "DIRECTOR RESEARCH RULE: Use [SEARCH: query] to look up specs, news, or details if the panelists raise technical debates, so you can synthesize and resolve discrepancies with fresh ground truth."
              : "DIRECTOR RESEARCH RULE: Use [SEARCH: query] to look up specs, news, or details if the panelists raise technical debates.",
            showThoughts
              ? "Example: {\"thought\":\"I should look up the latest specs. [SEARCH: latest local LLM benchmarks 2026]\",\"action\":\"speak\",\"message\":\"\"}"
              : "Example: {\"thought\":\"[SEARCH: latest local LLM benchmarks 2026]\",\"action\":\"speak\",\"message\":\"\"}"
          ].join("\n");
        })()
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "dm", dm, privateThoughts });
  const promptParts = {
    ..._lastPromptParts,
    system,
    persona: `Name: ${dm.name}\nPersona: ${dm.persona || ""}`
  };
  const result = await chatJson(system, user, state.settings.temperature, signal, onStream);
  result._promptParts = promptParts;
  return result;
}

// Dynamic token budget — scales smoothly with the model's detected context window.
// Uses a logarithmic curve so there are no step-change cliffs at tier boundaries.
// Result: ~55% of budget at 8K context, ~65% at 32K, ~70% at 128K+.
function getPromptBudget() {
  const max = state.contextInfo?.maxContextLength;
  if (!max || max < 4000) return Math.floor((max || 4000) * 0.50);
  if (max < 8000) return 3800; // conservative for small quantized models
  const logMax  = Math.log(max);
  const log8k   = Math.log(8_000);
  const log128k = Math.log(128_000);
  const t = Math.min(1, (logMax - log8k) / (log128k - log8k));
  const pct = 0.55 + (0.70 - 0.55) * t;
  return Math.floor(max * pct);
}

// Working-memory N — how many recent messages to include verbatim.
// Scales with context window; larger models can carry more history without sacrificing
// space for retrieved chunks and the session contract.
function getWorkingMemoryN() {
  const max = state.contextInfo?.maxContextLength || 0;
  if (max >= 128_000) return 30;
  if (max >= 32_000)  return 20;
  if (max >= 8_000)   return 12;
  return 6;
}

export async function buildPromptContext({ kind, actor, dm, privateThoughts = "" }) {
  const participant = kind === "actor" ? actor : dm;
  const PROMPT_TOKEN_BUDGET = getPromptBudget();
  const workingMemoryN = getWorkingMemoryN();
  let recentMessages = state.messages.slice(-workingMemoryN);
  let recallChunks = state.memory.enabled ? await recallRelevantChunks(kind === "actor" ? actor : null) : [];
  const participantMemory = kind === "actor"
    ? `Your private actor memory:\n${trimWords(actor.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`
    : `Your private director notes:\n${trimWords(dm.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`;

  // Sprint 6: Inject cross-session persistent memory
  let crossSessionBlock = "";
  if (kind === "actor" && state.settings.enableCrossSessionMemory !== false) {
    const csm = await getActorMemory(actor.name);
    if (csm) {
      crossSessionBlock = `### Cross-Session Memory (${actor.name})\n${trimWords(csm, 200)}`;
    }
  }

  // Role reminder appended at the bottom ("lost in the middle" mitigation).
  // Small models pay most attention to start and end of prompt.
  const roleReminder = kind === "actor" && (participant.role || participant.goal || participant.voice)
    ? [
        `Reminder — you are ${participant.name}${participant.role ? `, ${participant.role}` : ""}.`,
        participant.goal ? `Your goal: ${participant.goal}` : "",
        participant.voice ? `Your voice: ${participant.voice}` : ""
      ].filter(Boolean).join(" ")
    : "";

  // Programmatic gravity reminders & warnings
  const alignment = state.telemetry?.currentAlignmentScore ?? 100;
  const threshold = state.settings?.gravitySensitivity ?? 50;
  const isDrifting = alignment < threshold;

  const periodicReminder = (state.scenario.objective && state.messages.length > 0 && state.messages.length % 5 === 0)
    ? `### Core Objective Anchor\nRemember the council's core objective: "${state.scenario.objective}". Keep your contributions aligned with this objective.`
    : "";
  const gravityWarning = (isDrifting && kind === "actor" && !actor.isResearcher)
    ? `### CRITICAL Orchestration Warning: Semantic Drift Detected\nThe discussion has drifted from the core objective (semantic alignment: ${alignment}% vs threshold: ${threshold}%). Do NOT express generic agreement or repeat previous comments. You MUST challenge an assumption, raise a critical open question, or propose a concrete next action to steer the forum back to the objective: "${state.scenario.objective || "completing the goal"}".`
    : "";

  let nudgeReminder = "";
  if (state.telemetry?.nudgeTriggered && kind === "actor") {
    nudgeReminder = `### Facilitator Intervention: Direct Steering Nudge\nThe facilitator has injected a manual steering nudge. Pivot your focus immediately, address the core objective, and resolve any outstanding discrepancies. Objective: "${state.scenario.objective}".`;
    // Consume nudge
    state.telemetry.nudgeTriggered = false;
    logTransition("manual_nudge_consumed", { actor: actor.name });
  }

  // Build sections and enforce token budget with graceful degradation.
  const buildSections = (chunks, msgs, memOverride = null) => [
    scenarioBlock(),
    state.memory.enabled ? memoryBlock(chunks) : "",
    state.document.enabled
      ? `### Shared Document: "${state.document.title}"\n---\n${state.document.content || "(Empty — start drafting.)" }\n---`
      : "",
    crossSessionBlock,
    memOverride || participantMemory,
    privateThoughts,
    `### Recent transcript\n${formatTranscript(msgs, WORD_LIMITS.recentTranscript)}`,
    periodicReminder,
    gravityWarning,
    nudgeReminder,
    roleReminder,
    kind === "actor"
      ? (actor.isResearcher
          ? "You are the Researcher. Analyze the open questions, run a web search using `[SEARCH: query]` in your thought field if facts are needed, cite your sources, and skip your turn if no further research is required right now."
          : "Take your next turn now. Be extremely concise. Avoid filler. If a simple 'Yes', 'No', or single-sentence reply suffices, use exactly that.")
      : "Take the director turn now. Be brief. Keep summaries and guidance concise."
  ].filter(Boolean).join("\n\n");

  let assembled = buildSections(recallChunks, recentMessages);

  // The scenario block (premise + objective) is non-compressible — it is the anchor
  // that prevents drift and must reach the model intact regardless of budget pressure.
  // Reserve its token footprint before the degradation stages so it is never trimmed.
  const scenarioTokens = estimateTokens(scenarioBlock());
  const effectiveBudget = PROMPT_TOKEN_BUDGET - scenarioTokens;

  // Stage 1: drop lowest-scored chunks until under budget
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 1) {
    recallChunks = recallChunks.slice(1); // oldest / lowest-scored is first after sort
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 2: trim transcript to 4 messages minimum
  let transcriptLimit = workingMemoryN;
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

  // Stage 4: LLM micro-compress private actor memory (never mutates state)
  if (
    estimateTokens(assembled) > PROMPT_TOKEN_BUDGET &&
    kind === "actor" &&
    state.settings.enableAdaptiveCompression !== false &&
    !state.settings.turboMode
  ) {
    const rawThoughts = actor.thoughts || "";
    if (rawThoughts.split(/\s+/).length > 30) {
      try {
        const compressed = await chatCompletion(
          "Compress character memory. Output ONLY the compressed text, nothing else. Maximum 80 words.",
          rawThoughts.slice(0, 800),
          { temperature: 0.1, maxTokens: 130 }
        );
        if (compressed?.trim()) {
          const compressedMem = `Your private actor memory (compressed):\n${compressed.trim()}`;
          assembled = buildSections([], recentMessages, compressedMem);
          logTransition("adaptive_compression", { actor: actor.name, before: rawThoughts.length, after: compressed.length });
        }
      } catch {
        // Silently continue with existing prompt
      }
    }
  }

  const finalTokens = estimateTokens(assembled);
  if (finalTokens > PROMPT_TOKEN_BUDGET) {
    console.warn(`[budget] Prompt still over budget (${finalTokens} tokens, budget ${PROMPT_TOKEN_BUDGET}) after all degradation steps.`);
  }
  // Log utilization for empirical tuning
  console.debug(`[budget] tokens=${finalTokens} budget=${PROMPT_TOKEN_BUDGET} model_ctx=${state.contextInfo?.maxContextLength || 'unknown'} working_n=${workingMemoryN}`);
  void effectiveBudget; // reserved for future fine-grained section budgeting

  _lastPromptParts = {
    scenario: scenarioBlock(),
    proceduralMemory: state.memory.enabled ? memoryBlock(recallChunks) : "",
    workMemory: participantMemory,
    recentMessages: formatTranscript(recentMessages, WORD_LIMITS.recentTranscript)
  };

  return assembled;
}

export function memoryBlock(recallChunks) {
  const chunkText = recallChunks.length
    ? recallChunks.map((chunk, index) => `${index + 1}. ${trimWords(chunk.text || chunk.summary || "", WORD_LIMITS.chunk)}`).join("\n")
    : "No older archived memory recalled.";
  const deltaText = state.memory.recentDeltas?.length
    ? state.memory.recentDeltas.join("\n")
    : "";
  const pinnedStr = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : (state.memory.pinnedFacts || "");
  const questionsStr = Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : (state.memory.openQuestions || "");

  // Sprint 7: Anchor block — settled group agreements injected as immovable constraints
  const anchorLines = Array.isArray(state.anchors) && state.anchors.length
    ? state.anchors.map(a => `- [${a.speaker || 'Group'}]: ${a.text}`).join('\n')
    : '';

  return [
    "### Long-term memory",
    pinnedStr ? `**Pinned facts:**\n${trimWords(pinnedStr, WORD_LIMITS.sharedSummary)}` : "Pinned facts: none.",
    anchorLines ? `**Anchored agreements (settled — do not re-argue these):**\n${trimWords(anchorLines, ANCHOR_WORD_CAP)}` : "",
    state.memory.sharedSummary ? `**Shared summary:**\n${trimWords(state.memory.sharedSummary, WORD_LIMITS.sharedSummary)}` : "Shared summary: none yet.",
    deltaText ? `**Recent updates (since last full summary):**\n${deltaText}` : "",
    questionsStr ? `**Open questions:**\n${trimWords(questionsStr, WORD_LIMITS.openQuestions)}` : "Open questions: none recorded.",
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

    // Director-guided dynamic turn routing
    if (result.nextSpeaker) {
      const targetName = String(result.nextSpeaker).trim().toLowerCase();
      const targetActor = state.actors.find(a => a.enabled && a.name.toLowerCase() === targetName);
      if (targetActor) {
        console.log(`[turns] Director routed next turn to actor: ${targetActor.name}`);
        state.turnQueue = state.turnQueue.filter(id => id !== targetActor.id);
        state.turnQueue.unshift(targetActor.id);
        saveState();
      }
    }

    // Repetition safeguard
    const speakerMessages = state.messages.filter(m => m.speaker === speakerName && m.type !== "skip");
    if (result.action !== "skip" && result.message && speakerMessages.length > 0) {
      const lastMsg = speakerMessages[speakerMessages.length - 1];
      if (lastMsg.content && lastMsg.content.trim() === result.message.trim()) {
        console.warn(`[turns] Repetition safeguard triggered: forcing skip for Director ${speakerName}`);
        result.action = "skip";
      }
    }

    if (result.action === "skip") {
      logTransition("skip_decision", { speaker: speakerName, reason: result.thought });
      return addMessage({ type: "skip", speaker: state.dm.name, content: "Skipped.", thought: result.thought, color: "var(--gold)", toolCalls: result.toolCalls || [], docEdited, trace: result.trace, metrics: result.metrics });
    }
    return addMessage({ type: "dm", speaker: state.dm.name, content: result.message, thought: result.thought, color: "var(--gold)", toolCalls: result.toolCalls || [], docEdited, trace: result.trace, metrics: result.metrics });
  }

  const actor = participant.data;
  actor.thoughts = appendMemory(actor.thoughts, result.thought);

  // Repetition safeguard for actors
  const speakerMessages = state.messages.filter(m => m.speaker === speakerName && m.type !== "skip");
  if (result.action !== "skip" && result.message && speakerMessages.length > 0) {
    const lastMsg = speakerMessages[speakerMessages.length - 1];
    if (lastMsg.content && lastMsg.content.trim() === result.message.trim()) {
      console.warn(`[turns] Repetition safeguard triggered: forcing skip for Actor ${speakerName}`);
      result.action = "skip";
    }
  }

  if (result.action === "skip") {
    logTransition("skip_decision", { speaker: speakerName, reason: result.thought });
    return addMessage({ type: "skip", actorId: actor.id, speaker: actor.name, content: "Skipped.", thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, metrics: result.metrics });
  }
  return addMessage({ type: "actor", actorId: actor.id, speaker: actor.name, content: result.message, thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, metrics: result.metrics });
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

  let cleaned = editText.trim();

  // [REPLACE: old text] new text — surgical find-and-replace
  if (/^\[REPLACE:/i.test(cleaned)) {
    const match = cleaned.match(/^\[REPLACE:\s*([\s\S]*?)\]\s*([\s\S]*)$/i);
    if (match) {
      const findText = match[1].trim();
      let replaceText = match[2].trim();
      
      // Clean potential [WITH: ...] or WITH: prefixes inside replace content
      replaceText = replaceText.replace(/^\[WITH:\s*([\s\S]*?)\]$/i, "$1");
      replaceText = replaceText.replace(/^WITH:\s*/i, "");

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
  // [FULL] — explicit full replacement
  else if (/^\[FULL\]/i.test(cleaned)) {
    newContent = cleaned.replace(/^\[FULL\]\s*/i, "").trim();
    opLabel = "full replace";
  }
  // Default: APPEND to the end with wrapper cleanup & duplication protection
  else {
    // Strip common bracketed wrappers like [APPEND: text] or [INSERT: text]
    const bracketWrapper = /^\[(APPEND|INSERT|ADD|UPDATE):\s*([\s\S]*?)\]$/i;
    const wrapperMatch = cleaned.match(bracketWrapper);
    if (wrapperMatch) {
      cleaned = wrapperMatch[2].trim();
    }
    
    // Also strip generic leading/trailing tags
    cleaned = cleaned.replace(/^\[(APPEND|INSERT|ADD|UPDATE|EDIT)\]\s*/i, "");
    cleaned = cleaned.replace(/\s*\[\/(APPEND|INSERT|ADD|UPDATE|EDIT)\]$/i, "");
    
    cleaned = cleaned.trim();

    if (cleaned) {
      const cleanPrev = prev.trim();
      
      // Heuristic 1: Redundant append (ignore if already in document)
      if (cleanPrev && cleanPrev.includes(cleaned)) {
        console.warn(`[document] ${author} sent edit that is already fully present in the document, ignoring.`);
        return;
      }
      
      // Check for suffix-prefix line overlap
      const prevLinesRaw = prev.split("\n");
      const cleanLinesRaw = cleaned.split("\n");
      const prevLinesProcessed = prevLinesRaw.map(l => l.trim());
      const cleanLinesProcessed = cleanLinesRaw.map(l => l.trim());
      
      let overlapFound = 0;
      const maxOverlap = Math.min(prevLinesProcessed.length, cleanLinesProcessed.length);
      for (let K = maxOverlap; K >= 1; K--) {
        let match = true;
        let hasContentLine = false;
        for (let i = 0; i < K; i++) {
          const l1 = prevLinesProcessed[prevLinesProcessed.length - K + i];
          const l2 = cleanLinesProcessed[i];
          if (l1 !== l2) {
            match = false;
            break;
          }
          if (l2.length > 5) {
            hasContentLine = true;
          }
        }
        if (match && hasContentLine) {
          overlapFound = K;
          break;
        }
      }

      if (overlapFound > 0) {
        const remainingEdit = cleanLinesRaw.slice(overlapFound).join("\n");
        if (remainingEdit.trim() !== "") {
          newContent = prev.trimEnd() + "\n" + remainingEdit;
        } else {
          newContent = prev;
        }
        opLabel = "append (merged suffix-prefix overlap)";
      } else {
        // Heuristic 2: Duplicate full-text generation
        const prevLen = prev.length;
        const newLen = cleaned.length;
        const prevLines = prev.split("\n").map(l => l.trim()).filter(Boolean);
        const longLines = prevLines.filter(l => l.length > 15);
        const targetLines = longLines.length ? longLines : prevLines;
        
        let matchedCount = 0;
        for (const line of targetLines) {
          if (cleaned.includes(line)) {
            matchedCount++;
          }
        }
        const lineOverlapPct = targetLines.length ? (matchedCount / targetLines.length) : 0;
        const decision = (prevLen > 0 && newLen >= prevLen * 0.6 && lineOverlapPct >= 0.3) ? "replace" : "append";
        
        console.debug("[doc] duplicate detection", { 
          prevLen, newLen, lineOverlapPct, decision 
        });

        if (decision === "replace") {
          newContent = cleaned;
          opLabel = "heuristics: full replace (high line overlap)";
        } else if (cleanPrev.length >= 20 && cleaned.startsWith(cleanPrev.substring(0, 20))) {
          newContent = cleaned;
          opLabel = "heuristics: full replace (detected duplicate document body)";
        } else {
          newContent = prev + (prev ? "\n\n" : "") + cleaned;
          opLabel = "append";
        }
      }
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

  // LCS Line-level authorship attribution
  const prevLines = prev.split("\n");
  const newLines = newContent.split("\n");
  const oldAttributions = state.document.lineAttribution || [];
  state.document.lineAttribution = alignLineAttributions(
    prevLines,
    newLines,
    oldAttributions,
    author,
    state.document.versions.length
  );

  state.document.content = newContent;
  logTransition("document_edit", { author, operation: opLabel, prevLength: prev.length, newLength: newContent.length });
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
