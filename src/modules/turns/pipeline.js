import { state, saveState } from '../state.js';
import { chatJson, chatStructured, setStatus, setCurrentSpeaker, getLastToolCalls, isJsonSchemaSupported, resolveModelTier } from '../api.js';
import { mutateState } from '../stateStore.js';
import { setBusy, getBusy as getIsGenerating, showToast } from '../uiStore.js';
import { showStreamingBubble, updateStreamingBubble, removeStreamingBubble, forceRemoveStreamingBubble, showBackgroundActivity, updateBackgroundActivity, hideBackgroundActivity, clearBackgroundActivities } from '../streamingStore.js';
import { summarizeMemory, extractOutcomes } from '../memory.js';
import { normalizeCadence, isQueueActor, normalizeSpeakingOrderStrategy, shouldFireCadence, appendMemory, trimWords, stringifyList, formatTranscript } from '../utils.js';
import { buildActorSchema, buildSchemaPromptLine } from '../schemas.js';
import { buildNarrativeDmInstruction, buildRoleplayContextLine, buildRoleplayStyleBlock } from '../storyMode.js';
import { frag } from '../../prompts/index.js';
import { addMessage, wait, participantCycleCount, resolveSystemSettings, validateActorOutput, resolveActorThinkingTier, globalStyleInstruction, nextParticipant, generateDiscussionPlan, advancePlanStep } from './config.js';
import { resolverCandidates, resolveNextSpeaker } from './resolver.js';
import { buildPromptContext, privateThoughtDigest, relationshipBlock, getLastPromptParts, setLastPromptParts, getAndConsumeInjectionMaxTokens } from './prompt.js';
import { applyAiResult, finalizeDeferredQuestions, getAndClearResumeAfterPause, cancelPendingPause, distillAllActorsMemory } from './result.js';

let _sessionController = null;
export let abortController = null;
let _stopFlag = false;
let _pipelineActive = false;
const _tokSpeedWindow = [];
let _globalTurnIndex = 0;
let _recentUserTriggerActorIds = new Set();

function consumeRecentUserTriggerActorIds() {
  const fired = _recentUserTriggerActorIds;
  _recentUserTriggerActorIds = new Set();
  return fired;
}

function ensureSessionController() {
  if (!_sessionController || _sessionController.signal.aborted) {
    _sessionController = new AbortController();
  }
  abortController = _sessionController;
  return _sessionController;
}

function _maybeResumeAfterPause() {
  if (!getAndClearResumeAfterPause()) return;
  setTimeout(() => {
    if (_pipelineActive || state.autoRunning) return;
    console.debug('[turns] Resuming after pause response');
    runSingleResponse().catch(err =>
      console.warn('[turns] Post-pause continuation failed:', err?.message || err));
  }, 50);
}

const TRIGGER_EVENT_LABELS = {
  on_user_message:     'The user just sent a message',
  on_round_start:      'A new discussion round is starting',
  on_round_end:        'The discussion round just ended',
  on_conflict:         'A conflict was flagged in the discussion',
};

function buildEventContextBlock(eventName, data = {}) {
  const label = TRIGGER_EVENT_LABELS[eventName] || eventName;
  const lines = [`[CONTROL TRIGGER: ${label}]`];
  if (data.message) lines.push(`User message: "${String(data.message).slice(0, 300)}"`);
  if (data.actorName) lines.push(`Actor: ${data.actorName}`);
  if (data.context) lines.push(`Context: ${String(data.context).slice(0, 200)}`);
  return lines.join('\n');
}

async function fireTriggerActors(eventName, eventData = {}, signal = null, excludeId = null, excludeIds = null) {
  const effectiveSignal = signal || abortController?.signal || null;
  const fired = new Set();
  const triggered = state.actors.filter(a =>
    a.enabled &&
    a.id !== excludeId &&
    !(excludeIds && excludeIds.has(a.id)) &&
    Array.isArray(a.triggerOn) &&
    a.triggerOn.includes(eventName)
  );
  if (!triggered.length) return fired;

  const nextActorId = state.turnQueue[0];
  const nextActor = nextActorId ? state.actors.find(a => a.id === nextActorId) : null;

  for (const actor of triggered) {
    if (effectiveSignal?.aborted) break;
    setCurrentSpeaker('');
    fired.add(actor.id);
    const activityId = showBackgroundActivity(`${actor.name} is working`, `Handling ${TRIGGER_EVENT_LABELS[eventName] || eventName} before the next visible turn.`, actor.color || 'var(--accent)');
    try {
      const result = await askActor(actor, effectiveSignal, null, false, {
        triggerEvent: eventName,
        triggerData: eventData,
        nextActor,
      });
      updateBackgroundActivity(activityId, { detail: result?.action === 'skip' ? 'No visible action needed.' : 'Applying silent routing or setup changes.' });
      if (result && result.action !== 'skip') {
        await applyAiResult({ kind: 'actor', data: actor }, result, { justSpokeId: excludeId, onConflict: (data) => fireTriggerActors('on_conflict', data, null, data.actorId) });
      }
    } catch (err) {
      console.warn(`[turns] trigger "${eventName}" actor "${actor.name}" error:`, err.message);
    } finally {
      hideBackgroundActivity(activityId);
    }
  }
  return fired;
}

export async function fireUserMessageTriggers(message) {
  if (_pipelineActive) {
    console.warn('[turns] fireUserMessageTriggers skipped — pipeline already active');
    return;
  }
  _pipelineActive = true;
  const alreadyBusy = getIsGenerating();
  if (!alreadyBusy) setBusy(true);
  try {
    _recentUserTriggerActorIds = await fireTriggerActors('on_user_message', { message });
    try {
      const docMod = await import('../documentWriting.js');
      const instruction = docMod.detectInlineScribeRequest(message);
      if (instruction) {
        await docMod.runScribePass(null, { instruction });
      }
    } catch (err) {
      console.warn('[scribe] inline request failed:', err?.message || err);
    }
  } finally {
    if (!alreadyBusy) setBusy(false);
    _pipelineActive = false;
  }
}

async function runBetweenTurnActors(signal, justSpokeId = null) {
  const dueActors = state.actors.filter(a => {
    if (!a.enabled || a.id === justSpokeId) return false;
    if (normalizeSpeakingOrderStrategy(state.scenario?.systems?.turnRouting?.strategy) === 'agentic' && (a.actorMode || 'participant') !== 'background') return false;
    const cadence = normalizeCadence(a);
    return cadence?.unit === 'turn' && shouldFireCadence(cadence, { turnIndex: _globalTurnIndex });
  });
  if (!dueActors.length) return;

  const nextActorId = state.turnQueue[0];
  const nextActor = nextActorId ? state.actors.find(a => a.id === nextActorId) : null;

  for (const actor of dueActors) {
    if (signal?.aborted) break;
    setCurrentSpeaker('');
    const activityId = showBackgroundActivity(`${actor.name} is working`, 'Checking whether any silent guidance, routing, or cast changes are needed.', actor.color || 'var(--accent)');
    try {
      const result = await askActor(actor, signal, null, false, { nextActor });
      updateBackgroundActivity(activityId, { detail: result?.action === 'skip' ? 'No visible action needed.' : 'Applying silent guidance or routing changes.' });
      if (result && result.action !== 'skip') {
        await applyAiResult({ kind: 'actor', data: actor }, result, { justSpokeId, onConflict: (data) => fireTriggerActors('on_conflict', data, null, data.actorId) });
      }
    } catch (err) {
      console.warn(`[turns] cadence actor "${actor.name}" error:`, err.message);
    } finally {
      hideBackgroundActivity(activityId);
    }
  }
}

async function runRoundCadenceActors(signal, alreadyFired = new Set()) {
  const roundIndex = state.currentRound || 0;
  const dueActors = state.actors.filter(a => {
    if (!a.enabled || alreadyFired.has(a.id)) return false;
    if (normalizeSpeakingOrderStrategy(state.scenario?.systems?.turnRouting?.strategy) === 'agentic' && (a.actorMode || 'participant') !== 'background') return false;
    const cadence = normalizeCadence(a);
    return cadence?.unit === 'round' && shouldFireCadence(cadence, { roundIndex });
  });
  if (!dueActors.length) return;

  const nextActorId = state.turnQueue[0];
  const nextActor = nextActorId ? state.actors.find(a => a.id === nextActorId) : null;

  for (const actor of dueActors) {
    if (signal?.aborted) break;
    setCurrentSpeaker('');
    const activityId = showBackgroundActivity(`${actor.name} is working`, 'Preparing round-start guidance before the visible speakers continue.', actor.color || 'var(--accent)');
    try {
      const result = await askActor(actor, signal, null, false, { nextActor });
      updateBackgroundActivity(activityId, { detail: result?.action === 'skip' ? 'No visible action needed.' : 'Applying silent round-start changes.' });
      if (result && result.action !== 'skip') {
        await applyAiResult({ kind: 'actor', data: actor }, result, { onConflict: (data) => fireTriggerActors('on_conflict', data, null, data.actorId) });
      }
    } catch (err) {
      console.warn(`[turns] round-cadence actor "${actor.name}" error:`, err.message);
    } finally {
      hideBackgroundActivity(activityId);
    }
  }
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

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
  if (options.isRoundContinuation) return _runTurn(options);
  if (_pipelineActive) {
    console.warn('[turns] runNextTurn ignored — a turn is already in progress');
    return false;
  }
  _pipelineActive = true;
  try {
    return await _runTurn(options);
  } finally {
    _pipelineActive = false;
    _maybeResumeAfterPause();
  }
}

export async function runSingleResponse(options = {}) {
  console.debug('[turns] runSingleResponse called', options);
  if (_pipelineActive) {
    console.warn('[turns] runSingleResponse ignored — a turn or round is already in progress');
    return false;
  }
  _pipelineActive = true;
  try {
    abortController = null;
    _sessionController = null;
    _stopFlag = false;
    ensureSessionController();
    const candidates = resolverCandidates();
    const resolved = await resolveNextSpeaker(candidates, {
      signal: _sessionController?.signal
    });
    if (!resolved) {
      setStatus("No eligible speaker found.", "warn");
      return false;
    }
    state.turnQueue = [resolved.actor.id, ...state.turnQueue.filter(id => id !== resolved.actor.id)];
    return await _runTurn({ summarizeCycle: false, isRoundContinuation: true, forceSpeak: false });
  } finally {
    _pipelineActive = false;
    _maybeResumeAfterPause();
  }
}

async function _runTurn(options = {}) {
  console.debug('[turns] runNextTurn called', options);
  if (_stopFlag) {
    console.debug('[turns] runNextTurn blocked by stop flag');
    return false;
  }
  if (!state.settings.model) {
    setStatus("Choose or type a model first.", "warn");
    return false;
  }
  if (abortController?.signal.aborted && !options.isRoundContinuation) {
    console.debug('[turns] Resetting aborted abortController for new turn');
    abortController = null;
  }
  if (abortController?.signal.aborted) {
    console.debug('[turns] runNextTurn aborted');
    return false;
  }
  const participant = nextParticipant();
  if (!participant) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  setBusy(true);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (abortController?.signal.aborted) break;
    try {
      ensureSessionController();
      setCurrentSpeaker(participant.data.name);

      const startTime = Date.now();

      const twoPhase = !!options.forceSpeak;

      const streamingColor = participant.data.color || "var(--accent)";
      showStreamingBubble(participant.data.name, streamingColor, "actor");
      const onStream = (data) => updateStreamingBubble(data);

      let result = await askActor(participant.data, abortController.signal, onStream, twoPhase, { forceSpeak: !!options.forceSpeak });

      const guardrailProblem = validateActorOutput(result);
      if (guardrailProblem) {
        console.warn(`[guardrail] ${participant.data.name} output failed: ${guardrailProblem} — retrying once`);
        const corrections = {
          empty: 'Your last reply was empty. Say something substantive now.',
          too_short: 'Your last reply was too short to be useful. Expand it.',
          filler_only: 'Your last reply was filler with no content. Make a concrete point.',
        };
        removeStreamingBubble();
        showStreamingBubble(participant.data.name, streamingColor, "actor");
        result = await askActor(participant.data, abortController.signal, onStream, twoPhase, {
          forceSpeak: true,
          correction: corrections[guardrailProblem],
        });
      }


      const latencyMs = Date.now() - startTime;

      result.toolCalls = getLastToolCalls();
      setCurrentSpeaker("");

      const completionTokens = result._completionTokens || 0;
      const promptTokens = result._promptTokens || 0;
      const tokenSpeed = latencyMs > 0 ? Number((completionTokens / (latencyMs / 1000)).toFixed(2)) : 0;

      if (tokenSpeed > 0) {
        _tokSpeedWindow.push(tokenSpeed);
        if (_tokSpeedWindow.length > 8) _tokSpeedWindow.shift();
        const avg = Math.round(_tokSpeedWindow.reduce((a, b) => a + b, 0) / _tokSpeedWindow.length);
        state.ui.tokenSpeed = avg;
      }

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
        parseFailure: !!result._parseFailure,
        rawCompletion: result._rawCompletion || ""
      };

      await applyAiResult(participant, result);
      removeStreamingBubble();
      _globalTurnIndex += 1;
      await runBetweenTurnActors(abortController.signal, participant.data.id);

      try {
        const docMod = await import('../documentWriting.js');
        await docMod.runScribePass(abortController?.signal || null);
      } catch (err) {
        console.warn('[scribe] pass failed:', err?.message || err);
      }


      if (state.memory.enabled && options.summarizeCycle !== false && !state.settings.turboMode) {
        state.memory.turnsSinceSummary += 1;
        const cycleSize = participantCycleCount();
        if (state.memory.turnsSinceSummary >= cycleSize) {
          await summarizeMemory("cycle", null, { signal: _sessionController?.signal });
        }
      }
      if (result._promptParts) {
        setLastPromptParts(result._promptParts);
      }

      setStatus(`Last turn: ${participant.data.name}`, "ok");
      setBusy(false);
      abortController = null;
      _sessionController = null;
      return true;
    } catch (error) {
      setCurrentSpeaker("");
      forceRemoveStreamingBubble();
      clearBackgroundActivities();
      abortController = null;
      _sessionController = null;

      if (error.name === "AbortError") {
        setStatus("Generation stopped.", "warn");
        setBusy(false);
        return false;
      }

      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await countdownRetry(attempt + 1, delayMs);
        continue;
      }

      const msg = error.message || "Generation failed.";
      const label = attempt > 1 ? `${msg} (failed after ${attempt} attempts)` : msg;
      setStatus(label, "error");
      showToast(label, "error");
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

  setStatus("Generation stopped.", "warn");
  clearBackgroundActivities();
  setBusy(false);
  return false;
}

export async function runRound(options = {}) {
  console.debug('[turns] runRound called', options);
  const ownLock = !options.fromAuto;
  if (ownLock) {
    if (_pipelineActive) {
      console.warn('[turns] runRound ignored — a turn or round is already in progress');
      return false;
    }
    _pipelineActive = true;
  }
  try {
    return await _runRound(options);
  } finally {
    if (ownLock) {
      _pipelineActive = false;
      _maybeResumeAfterPause();
    }
  }
}

async function _runRound(options = {}) {
  abortController = null;
  _sessionController = null;
  _stopFlag = false;
  ensureSessionController();

  const candidates = resolverCandidates();
  if (!candidates.length) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  const maxTurns = candidates.length;
  const startIndex = state.messages.length;
  let completedTurns = 0;
  state.currentRound = (state.currentRound || 0) + 1;
  if (state.currentRound > 1) advancePlanStep();
  if (state.currentRound === 1 && hasTask() && !state.scenario.plan) {
    try { await generateDiscussionPlan(abortController?.signal); } catch { /* silent */ }
  }

  const userTriggerFired = consumeRecentUserTriggerActorIds();
  const rsFired = await fireTriggerActors('on_round_start', { round: state.currentRound }, abortController?.signal, null, userTriggerFired);
  await runRoundCadenceActors(abortController?.signal, new Set([...userTriggerFired, ...rsFired]));

  const alreadySpokeThisRound = new Set();
  for (let i = 0; i < maxTurns; i++) {
    if (_stopFlag || abortController?.signal.aborted) break;
    const resolved = await resolveNextSpeaker(candidates, {
      signal: _sessionController?.signal,
      alreadySpokeThisRound
    });
    if (!resolved) {
      if (state.lastIntent?.need === 'conclude' && completedTurns > 0) {
        const summary = (state.lastIntent.read || '').trim();
        if (summary) {
          await addMessage({
            type: 'system', speaker: 'System',
            content: `[The discussion has reached a natural conclusion: ${summary}]`,
            color: 'var(--fg-mute)'
          });
        }
      }
      break;
    }

    state._pendingTurnIntent = { reason: resolved.reason, ...(resolved.intent || {}) };

    state.turnQueue = [resolved.actor.id, ...state.turnQueue.filter(id => id !== resolved.actor.id)];
    const ok = await runNextTurn({ summarizeCycle: false, isRoundContinuation: true, forceSpeak: false });
    if (!ok) { state._pendingTurnIntent = null; break; }
    alreadySpokeThisRound.add(resolved.actor.id);
    completedTurns++;
    if (options.fromAuto) {
      const delayMs = (state.settings.turnDelay || 0) * 1000;
      if (delayMs > 0) await wait(delayMs);
    }
  }

  await finalizeDeferredQuestions(state.currentRound);

  const roundMessages = state.messages.slice(startIndex);

  if (roundMessages.length) {
    await fireTriggerActors('on_round_end', { round: state.currentRound }, abortController?.signal);
  }

  if (roundMessages.length && state.memory.enabled && !state.settings.turboMode) {
    state.memory.turnsSinceSummary = 0;
    await summarizeMemory("round", roundMessages, { signal: _sessionController?.signal });
  }
  if (roundMessages.length) {
    const shouldStop = await evaluateAutoStopAfterRound(roundMessages, options);
    if (shouldStop) return false;
  }
  return completedTurns > 0 && completedTurns === maxTurns;
}

export async function runAutoLoop() {
  const starting = !state.autoRunning;
  if (starting) {
    if (_pipelineActive) {
      setStatus('A turn or round is already in progress.', 'warn');
      return;
    }
    _pipelineActive = true;
  }
  state.autoRunning = starting;
  _stopFlag = false;
  if (starting) {
    state.autoStop.roundsRun = 0;
    _globalTurnIndex = 0;
    setAutoStopStatus("Auto running.");
  } else {
    setAutoStopStatus("Auto paused.");
  }
  saveState();
  const { saveCurrentSession } = await import('../session.js');
  try {
    while (state.autoRunning) {
      const ok = await runRound({ fromAuto: true });
      if (!ok) {
        state.autoRunning = false;
        break;
      }
      saveCurrentSession().catch(console.warn);
      await wait(450);
    }
  } catch (err) {
    console.error("[runAutoLoop] Crashed:", err);
    state.autoRunning = false;
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Auto-run error: ${msg}`, 'error');
    showToast(`Auto-run error: ${msg}`, 'error');
  } finally {
    clearBackgroundActivities();
    if (starting) _pipelineActive = false;
    saveState();
    if (starting && !_stopFlag) {
      await distillAllActorsMemory().catch(err =>
        console.warn('[cross-session-memory] session-end pass failed:', err?.message || err));
    }
  }
}

export function stopGeneration() {
  state.autoRunning = false;
  _stopFlag = true;
  abortController?.abort();
  cancelPendingPause();
  mutateState(s => { s.ui.pauseModal = null; s.ui.awaitingUserInput = false; });
  forceRemoveStreamingBubble();
  clearBackgroundActivities();
  setAutoStopStatus("Stopped.");
  saveState();
}

export async function evaluateAutoStopAfterRound(roundMessages, options = {}) {
  if (!state.autoStop.enabled) {
    saveState();
    return false;
  }

  state.autoStop.roundsRun += 1;

  if (state.autoStop.stopOnAllSkip && roundMessages.length && roundMessages.every((message) => message.type === "skip")) {
    return promptStopOrContinue("Everyone skipped this round. The forum may be out of useful things to add.", options);
  }

  const atMaxRounds = state.autoStop.maxRoundsEnabled && state.autoStop.roundsRun >= state.autoStop.maxRounds;

  if (state.autoStop.goalCheckEnabled && state.scenario.doneWhen?.trim()) {
    const verdict = await judgeGoal(roundMessages);

    if (verdict.failed) {
      // Synthetic verdict (API error or missing prerequisites) — leave the
      // progress cache untouched so a transient failure doesn't poison prompts.
      setAutoStopStatus(`Goal check skipped: ${verdict.reason}`);
    } else {
      // Cache progress for actor prompts and intent routing
      if (!state.discussion) state.discussion = {};
      if (!state.discussion.goal) state.discussion.goal = {};
      const goal = state.discussion.goal;
      const wasBlocked = goal.verdict === 'blocked';
      const nowBlocked = verdict.status === 'blocked';
      goal.progressPct = verdict.progress ?? goal.progressPct;
      goal.verdict = verdict.status;
      goal.verdictReason = trimWords(verdict.reason, 40);
      goal.verdictAt = new Date().toISOString();
      goal.unmetCriteria = verdict.unmetCriteria || [];
      if (nowBlocked) {
        if (!wasBlocked) goal.blockedSince = new Date().toISOString();
        goal.blockedRounds = (goal.blockedRounds || 0) + 1;
      } else {
        goal.blockedSince = null;
        goal.blockedRounds = 0;
      }

      if (verdict.status === 'complete') {
        state.autoRunning = false;
        setAutoStopStatus(`Task complete: ${verdict.reason}`);
        showToast(`Task complete: ${verdict.reason}`, 'ok');
        await addMessage({ type: 'system', speaker: 'System', content: `✓ Task complete: ${verdict.reason}`, color: 'var(--accent)' });
        saveState();
        // Completion is the payoff moment — mine the structured outcomes now
        // instead of waiting for a manual Extract click. Fire-and-forget; the
        // chat scheduler serializes it behind any in-flight calls.
        extractOutcomes().catch(err => console.warn('[outcomes] auto-extract on completion failed:', err?.message || err));
        return true;
      }
      if (nowBlocked) {
        setAutoStopStatus(`Blocked: ${verdict.reason}`);

        // Escalation ladder: steer for two blocked rounds, then ask the user.
        if (goal.blockedRounds >= 3) {
          await addMessage({ type: 'system', speaker: 'System', content: `⚠ Blocked for ${goal.blockedRounds} rounds: ${verdict.reason}`, color: 'var(--warn)' });
          return promptStopOrContinue(`The group has been blocked for ${goal.blockedRounds} rounds: ${verdict.reason}`, options);
        }

        // Steer: inject guidance into the director (or highest-authority actor)
        // from the second consecutive blocked round.
        if (goal.blockedRounds >= 2 && verdict.unmetCriteria?.length) {
          const director = state.actors.find(a => a.canDirect && a.enabled);
          const target = director || [...state.actors].filter(a => a.enabled)
            .sort((a, b) => (b.authority || 50) - (a.authority || 50))[0];
          if (target) {
            if (!Array.isArray(state.pendingInjections)) state.pendingInjections = [];
            state.pendingInjections.push({
              id: crypto.randomUUID(), injectorId: 'system', targetId: target.id,
              content: `[SYSTEM — the group has been blocked for multiple rounds. Unmet: ${verdict.unmetCriteria.join('; ')}. Name the blockage explicitly and propose a concrete path to resolve it.]`,
              scope: 'next_turn_only', insertedAt: new Date().toISOString()
            });
          }
        }

        if (options.fromAuto) {
          showToast(`Discussion blocked: ${verdict.reason}`, 'warn');
          await addMessage({ type: 'system', speaker: 'System', content: `⚠ Blocked: ${verdict.reason}`, color: 'var(--warn)' });
        }
      } else {
        setAutoStopStatus(`Still working (~${goal.progressPct}%): ${verdict.reason || "Needs more discussion."}`);
      }
    }
    saveState();
  } else if (!atMaxRounds) {
    setAutoStopStatus(`Round ${state.autoStop.roundsRun} complete. Auto-stop is watching for skips and limits.`);
  }

  if (atMaxRounds) {
    return promptStopOrContinue(`Reached the ${state.autoStop.maxRounds}-round limit.`, options);
  }

  saveState();
  return false;
}

export async function judgeGoal(roundMessages = [], options = {}) {
  const doneWhen = (state.scenario.doneWhen || '').trim();
  const task = (state.scenario.task || '').trim();
  if (!doneWhen) {
    setAutoStopStatus("Set 'Done When' criteria to enable completion checking.");
    return { status: 'continue', reason: 'No completion criteria set.', progress: null, unmetCriteria: [], failed: true };
  }
  if (!state.settings.model) {
    setAutoStopStatus("Choose or type a model before checking.");
    return { status: 'continue', reason: 'No model selected.', progress: null, unmetCriteria: [], failed: true };
  }

  const alreadyBusy = getIsGenerating();
  setBusy(true);
  setAutoStopStatus("Checking completion...");

  const schema = {
    type: 'object',
    properties: {
      status:        { type: 'string', enum: ['continue', 'complete', 'blocked'] },
      reason:        { type: 'string' },
      progress:      { type: 'integer', minimum: 0, maximum: 100 },
      unmetCriteria: { type: 'array', items: { type: 'string' } }
    },
    required: ['status', 'reason', 'progress'],
    additionalProperties: false
  };
  const JUDGE_SHAPE = 'Return only JSON: {"status":"continue|complete|blocked","reason":"one sentence","progress":0-100,"unmetCriteria":["specific gap 1","specific gap 2"]}';
  const system = frag('goal_judge') + '\n' + JUDGE_SHAPE;
  const user = [
    task ? `Task:\n${task}` : '',
    `Done When:\n${doneWhen}`,
    `Shared summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${(Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : state.memory.openQuestions) || "None."}`,
    `Latest round:\n${formatTranscript(roundMessages.length ? roundMessages : state.messages.slice(-8), 600, state.actors)}`
  ].filter(Boolean).join("\n\n");

  try {
    const result = await chatStructured(system, user, schema, {
      temperature: 0.1, maxTokens: 400, tier: 'reason', purpose: 'goalCheck'
    });
    const verdict = {
      status: ['complete', 'blocked', 'continue'].includes(result?.status) ? result.status : 'continue',
      reason: trimWords(String(result?.reason || ''), 80),
      progress: typeof result?.progress === 'number' ? Math.max(0, Math.min(100, result.progress)) : 0,
      unmetCriteria: Array.isArray(result?.unmetCriteria)
        ? result.unmetCriteria.map(s => String(s).trim()).filter(Boolean).slice(0, 5)
        : []
    };
    if (options.manual) {
      if (verdict.status === 'complete') {
        setAutoStopStatus(`Task complete: ${verdict.reason}`);
      } else if (verdict.status === 'blocked') {
        setAutoStopStatus(`Blocked: ${verdict.reason}`);
      } else {
        setAutoStopStatus(`Still working (~${verdict.progress}%): ${verdict.reason || "Needs more discussion."}`);
      }
    }
    return verdict;
  } catch (error) {
    const message = error.message || "Completion check failed.";
    setAutoStopStatus(message);
    // failed: true tells the caller this is a synthetic verdict — do not cache it
    // or surface it to actors (the reason here is an error string, not a judgment).
    return { status: 'continue', reason: message, progress: null, unmetCriteria: [], failed: true };
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

export function normalizeGoalVerdict(value) {
  const status = value?.status || (value?.achieved ? 'complete' : 'continue');
  return { status, reason: trimWords(stringifyList(value?.reason), 80) };
}

let _stopResolve = null;
export function resolveStopOrContinue(shouldStop) {
  mutateState(s => { s.ui.stopModal = null; });

  if (_stopResolve) {
    _stopResolve({ shouldStop });
    _stopResolve = null;
  } else {
    if (shouldStop) {
      state.autoRunning = false;
      state.autoStop.roundsRun = 0;
      setAutoStopStatus("Stopped by user.");
    }
    saveState();
  }
}

export async function promptStopOrContinue(reason, _options = {}) {
  state.autoRunning = false;
  setAutoStopStatus(reason);
  showToast(reason, "warn");
  saveState();

  const { shouldStop } = await new Promise(resolve => {
    _stopResolve = resolve;
    mutateState(s => { s.ui.stopModal = { reason }; });
  });

  if (shouldStop) {
    state.autoStop.roundsRun = 0;
    setAutoStopStatus(`Stopped: ${reason}`);
    saveState();
    return true;
  }
  saveState();
  return false;
}

export function setAutoStopStatus(message) {
  state.autoStop.status = message;
  saveState();
}

const NEED_TOKEN_BUDGET = {
  redirect:   200,
  conclude:   250,
  challenge:  450,
  decide:     450,
  deepen:     500,
  broaden:    500,
  synthesize: 900,
};

export async function askActor(actor, signal, onStream = null, twoPhase = false, options = {}) {
  const thinkingTier = resolveActorThinkingTier(actor);
  const tierModel = resolveModelTier(thinkingTier);
  const showThoughts = thinkingTier !== 'fast' && !state.settings.turboMode;
  const forceSpeak = !!options.forceSpeak;
  const skipAllowed = !forceSpeak && (!twoPhase || !!actor.canResearch || !!actor.canManageCast);
  const docsContext = { hasEditable: false };
  const sysCfg = resolveSystemSettings();
  const validSpeakerNames = state.actors
    .filter(a => a.enabled && a.id !== actor.id && isQueueActor(a))
    .map(a => a.name);

  const triggerBlock = options.triggerEvent
    ? buildEventContextBlock(options.triggerEvent, options.triggerData || {})
    : '';

  if (actor.canDirect) {
    const privateThoughts = actor.canSeeThoughts ? privateThoughtDigest() : "";
    const modeInstruction = sysCfg.dmNarrates
      ? buildNarrativeDmInstruction()
      : frag('director_mode_facilitator');

    const dmRoleModifier = sysCfg.dmRole === 'observer'
      ? frag('director_mode_observer')
      : sysCfg.dmRole === 'arbiter'
      ? frag('director_mode_arbiter')
      : "";

    const castManagementBlock = (sysCfg.stageDirectionsEnabled || actor.canManageCast)
      ? [
          sysCfg.stageDirectionsEnabled
            ? frag('director_cast_mgmt_narrative')
            : frag('director_cast_mgmt_analytical'),
          frag('director_cast_mgmt_instructions')
        ].join("\n")
      : "";

    const system = [
      frag('director_identity', { name: actor.name }),
      actor.persona ? frag('director_persona', { persona: actor.persona }) : "",
      globalStyleInstruction(),
      modeInstruction,
      dmRoleModifier,
      castManagementBlock,
      sysCfg.stageDirectionsEnabled
        ? frag('director_user_msg_stageDirections')
        : frag('director_user_msg_analytical'),
      forceSpeak
        ? (sysCfg.dmRole === 'narrator'
            ? frag('director_speak_narrator_forced')
            : frag('director_speak_forced'))
        : (sysCfg.dmRole === 'narrator'
            ? frag('director_speak_narrator_optional')
            : frag('director_speak_facilitator_optional')),
      forceSpeak
        ? ""
        : sysCfg.dmRole === 'observer'
        ? frag('director_skip_observer')
        : sysCfg.dmRole === 'arbiter'
        ? frag('director_skip_arbiter')
        : sysCfg.dmRole === 'narrator'
        ? frag('director_skip_narrator')
        : frag('director_skip_facilitator'),
      frag('director_conciseness'),
      frag('director_physical_actions'),
      sysCfg.allowDirectAddress
        ? frag('director_flow_control_enabled')
        : frag('director_flow_control_disabled'),
      frag('director_anchors'),
      frag('director_injections'),
      frag('director_private_msg'),
      frag('director_style_control'),
      (!showThoughts)
        ? frag('thoughts_disabled')
        : frag('thoughts_enabled'),
      buildSchemaPromptLine(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, schemaActive: isJsonSchemaSupported(tierModel), forceSpeak }),
      'The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.',
      "",
      (!sysCfg.stageDirectionsEnabled && state.settings.toolsEnabled && actor.canResearch)
        ? frag('director_web_tools', {
            thoughtField: showThoughts ? 'thought field' : 'JSON thought field',
            researchSuffix: showThoughts ? ', so you can synthesize and resolve discrepancies with fresh ground truth' : '',
            searchExample: showThoughts
              ? '{"thought":"I should look up the latest specs. [SEARCH: latest local LLM benchmarks 2026]","action":"speak","message":""}'
              : '{"thought":"[SEARCH: latest local LLM benchmarks 2026]","action":"speak","message":""}'
          })
        : ""
    ].filter(Boolean).join("\n");

    const baseUser = await buildPromptContext({ kind: "actor", actor, privateThoughts });
    const rosterLabel = sysCfg.stageDirectionsEnabled ? "Current cast" : "Current actor roster";
    const rosterLines = state.actors.map(a => `- ${a.name} (${a.role || (sysCfg.stageDirectionsEnabled ? "Character" : "Participant")})${a.enabled ? "" : (sysCfg.stageDirectionsEnabled ? " [offstage]" : " [disabled]")}`).join("\n");
    const user = `${baseUser}\n\n### ${rosterLabel}\n${rosterLines}`;
    const promptParts = {
      ...getLastPromptParts(),
      system,
      persona: `Name: ${actor.name}\nPersona: ${actor.persona || ""}`
    };

    const isBackground = (actor.actorMode || 'participant') === 'background';
    let directorSystem = system;
    if (isBackground) {
      const nextAct = options.nextActor;
      const nextLabel = nextAct
        ? `The next scheduled actor is: **${nextAct.name}** (${nextAct.role || 'participant'}).`
        : 'No next actor determined yet.';
      directorSystem = `BACKGROUND MODE: Your response will NOT appear in the transcript. Only your promptInjections, manageActors, nextSpeaker, and privateMessages fields take effect. Omit or leave "message" blank.\n${nextLabel}\n\n` + system;
    }

    const directorUser = triggerBlock ? `${user}\n\n${triggerBlock}` : user;
    const schema = buildActorSchema(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, forceSpeak, validSpeakerNames });
    const result = await chatJson(directorSystem, directorUser, actor.temperature ?? state.settings.temperature, signal, onStream, actor.maxTokens || 1200, schema, { toolsAllowed: !!actor.canResearch, tier: thinkingTier, purpose: actor.name });
    result._promptParts = promptParts;
    return result;
  }

  if (actor.canManageCast) {
    const rosterLines = state.actors
      .map(a => `- ${a.name} (${a.role || "Participant"})${a.enabled ? "" : " [disabled]"}`)
      .join("\n");

    const system = [
      frag('manager_identity', { name: actor.name }),
      actor.persona ? `Persona: ${actor.persona}` : "",
      actor.goal ? `Responsibility: ${actor.goal}` : "",
      actor.voice ? `Voice: ${actor.voice}` : "",
      actor.voice ? "" : globalStyleInstruction(),
      frag('manager_job'),
      frag('manager_observe'),
      frag('manager_creation_rules'),
      forceSpeak
        ? frag('manager_speak_forced')
        : frag('manager_skip_rules'),
      frag('manager_public_msg'),
      frag('manager_user_msg'),
      buildSchemaPromptLine(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, schemaActive: isJsonSchemaSupported(tierModel), forceSpeak }),
      'All manageActors sub-arrays are optional — omit any you don\'t need. The JSON is transport only; put natural dialogue only inside message.',
      (!showThoughts) ? frag('thoughts_disabled') : "",
      frag('security_transcript')
    ].filter(Boolean).join("\n");

    const baseContext = await buildPromptContext({ kind: "actor", actor });
    const user = `${baseContext}\n\n### Current actor roster\n${rosterLines}`;

    const isBackgroundMgr = (actor.actorMode || 'participant') === 'background';
    let managerSystem = system;
    if (isBackgroundMgr) {
      const nextAct = options.nextActor;
      const nextLabel = nextAct
        ? `The next scheduled actor is: **${nextAct.name}** (${nextAct.role || 'participant'}).`
        : 'No next actor determined yet.';
      managerSystem = `BACKGROUND MODE: Your response will NOT appear in the transcript. Only your promptInjections, manageActors, nextSpeaker, and privateMessages fields take effect. Omit or leave "message" blank.\n${nextLabel}\n\n` + system;
    }
    const managerUser = triggerBlock ? `${user}\n\n${triggerBlock}` : user;
    const managerSchema = buildActorSchema(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, forceSpeak, validSpeakerNames });
    return chatJson(managerSystem, managerUser, actor.temperature ?? state.settings.temperature, signal, onStream, actor.maxTokens || 1200, managerSchema, { toolsAllowed: false, tier: thinkingTier, purpose: actor.name });
  }

  if (actor.canResearch) {
    const researcherToolsEnabled = state.settings.toolsEnabled && !sysCfg.stageDirectionsEnabled;
    const system = [
      frag('researcher_identity', { name: actor.name }),
      `Role: ${actor.role || "Research Specialist"}`,
      `Responsibility: ${actor.goal || "Provide up-to-date objective research and answer open questions to ground the discussion."}`,
      `Voice: ${actor.voice || "Objective, fact-driven, structured with clear source citations."}`,
      actor.persona ? `Persona: ${actor.persona}` : "",
      actor.voice ? "" : globalStyleInstruction(),
      actor.exampleDialogue ? `How ${actor.name} speaks:\n${actor.exampleDialogue}` : "",
      frag('researcher_specialization'),
      researcherToolsEnabled
        ? frag('researcher_purpose_tools')
        : frag('researcher_purpose_no_tools'),
      frag('researcher_objectivity'),
      researcherToolsEnabled
        ? frag('researcher_mandatory_tools')
        : frag('researcher_tools_disabled'),
      forceSpeak
        ? frag('researcher_speak_forced')
        : frag('researcher_inspect'),
      researcherToolsEnabled
        ? (showThoughts
            ? frag('researcher_tool_instruction_thoughts')
            : frag('researcher_tool_instruction_no_thoughts'))
        : forceSpeak
        ? frag('researcher_no_tools_forced')
        : frag('researcher_no_tools_optional'),
      researcherToolsEnabled
        ? (showThoughts
            ? frag('researcher_example_thoughts')
            : frag('researcher_example_no_thoughts'))
        : "",
      researcherToolsEnabled
        ? frag('researcher_ground_truth_tools')
        : frag('researcher_ground_truth_no_tools'),
      forceSpeak
        ? ""
        : frag('researcher_skip_rules'),
      researcherToolsEnabled
        ? frag('researcher_citations_tools')
        : frag('researcher_citations_no_tools'),
      (!showThoughts)
        ? frag('thoughts_disabled_researcher')
        : frag('thoughts_enabled_participant'),
      buildSchemaPromptLine(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, schemaActive: isJsonSchemaSupported(tierModel), forceSpeak }),
      'The JSON is transport only. Put natural public dialogue/briefs only inside message; do not make message itself JSON.',
      frag('researcher_user_msg'),
      frag('security_directive')
    ].filter(Boolean).join("\n");

    const user = await buildPromptContext({ kind: "actor", actor });

    const isBackgroundRes = (actor.actorMode || 'participant') === 'background';
    let researchSystem = system;
    if (isBackgroundRes) {
      const nextAct = options.nextActor;
      const nextLabel = nextAct
        ? `The next scheduled actor is: **${nextAct.name}** (${nextAct.role || 'participant'}).`
        : 'No next actor determined yet.';
      researchSystem = `BACKGROUND MODE: Your response will NOT appear in the transcript. Only your promptInjections, manageActors, nextSpeaker, and privateMessages fields take effect. Omit or leave "message" blank.\n${nextLabel}\n\n` + system;
    }
    const researchUser = triggerBlock ? `${user}\n\n${triggerBlock}` : user;
    const researchSchema = buildActorSchema(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, forceSpeak, validSpeakerNames });
    return chatJson(researchSystem, researchUser, actor.temperature ?? state.settings.temperature, signal, onStream, actor.maxTokens || null, researchSchema, { toolsAllowed: researcherToolsEnabled, tier: thinkingTier, purpose: actor.name });
  }

  const contextLine = sysCfg.stageDirectionsEnabled
    ? buildRoleplayContextLine(showThoughts, state.actors.some(a => a.canDirect && a.enabled))
    : frag('participant_context_analytical');

  const intentHint = (() => {
    const li = state.lastIntent;
    if (!li?.need || !li?.speaker) return '';
    if (li.speaker.toLowerCase() !== actor.name.toLowerCase()) return '';
    if (Date.now() - new Date(li.at).getTime() > 60_000) return '';
    const suffix = li.rationale ? ` (${li.rationale})` : '';
    let hint = frag('participant_intent_hint', { need: li.need, rationale: suffix });
    if (li.expectedOutput) {
      hint += `\nTHIS TURN, produce: ${li.expectedOutput}`;
    }
    return hint;
  })();

  const intentBudget = (() => {
    const li = state.lastIntent;
    if (!li?.need || !li?.speaker) return null;
    if (li.speaker.toLowerCase() !== actor.name.toLowerCase()) return null;
    if (Date.now() - new Date(li.at).getTime() > 60_000) return null;
    return NEED_TOKEN_BUDGET[li.need] || null;
  })();

  // Suppress skip when the intent pass deliberately chose this actor with high confidence
  const intentChoseThis = (() => {
    const li = state.lastIntent;
    if (!li?.need || !li?.speaker) return false;
    if (li.speaker.toLowerCase() !== actor.name.toLowerCase()) return false;
    if (Date.now() - new Date(li.at).getTime() > 60_000) return false;
    return typeof li.confidence === 'number' && li.confidence >= 0.8;
  })();
  const effectiveSkipAllowed = skipAllowed && !intentChoseThis;

  const intentBudgetHint = intentBudget
    ? `TOKEN BUDGET: Keep your response to roughly ${Math.round(intentBudget * 0.75)} words or fewer this turn.`
    : '';

  const relationships = relationshipBlock(actor);
  const system = [
    `You are ${actor.name}.`,
    actor.role ? `Role: ${actor.role}` : "",
    actor.persona ? `Persona: ${actor.persona}` : "",
    actor.goal ? `Responsibility: ${actor.goal}` : "",
    actor.voice ? `Voice: ${actor.voice}` : "",
    actor.voice ? "" : globalStyleInstruction(),
    actor.exampleDialogue ? `How ${actor.name} speaks:\n${actor.exampleDialogue}` : "",
    "LENGTH: Match response length to the turn. Reactions, questions, and redirects: 2–3 sentences. Proposals, analysis, and synthesis: as long as needed, no padding.",
    relationships,
    contextLine,
    intentHint,
    intentBudgetHint,
    sysCfg.stageDirectionsEnabled
      ? frag('participant_user_msg_stageDirections')
      : frag('participant_user_msg_analytical'),
    effectiveSkipAllowed
      ? (showThoughts
          ? frag('participant_think_speak_thoughts')
          : frag('participant_think_speak_no_thoughts'))
      : (showThoughts
          ? frag('participant_forced_thoughts')
          : frag('participant_forced_no_thoughts')),
    effectiveSkipAllowed
      ? (showThoughts
          ? frag('participant_skip_rules_thoughts')
          : frag('participant_skip_rules_no_thoughts'))
      : "",
    sysCfg.stageDirectionsEnabled
      ? buildRoleplayStyleBlock(sysCfg.stageDirectionsMaxShare, sysCfg.stageDirectionsIntensity)
      : frag('participant_conciseness_analytical'),
    (!showThoughts)
      ? frag('thoughts_disabled')
      : "",
    buildSchemaPromptLine(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, schemaActive: isJsonSchemaSupported(tierModel), forceSpeak }),
    sysCfg.stageDirectionsEnabled
      ? 'The JSON is transport only. ' + frag('participant_markdown_stageDirections')
      : 'The JSON is transport only. ' + frag('participant_markdown_analytical'),
    (state.userContext?.interactionMode !== "observer")
      ? 'All of the above fields are part of a single JSON object. You may also add optional fields like "pauseRequest", "pinFact", "anchor", etc. alongside the required fields in that same object. ' + frag('participant_handoff')
      : "",
    frag('security_directive'),
    "",
    (!sysCfg.stageDirectionsEnabled && state.settings.toolsEnabled && actor.canResearch)
      ? frag('participant_web_tools', {
          researchSuffix: showThoughts ? 'to fetch ground truth' : 'using your thought field',
          searchExample: showThoughts
            ? '{"thought":"I need current data. [SEARCH: best quantization methods for local LLMs 2026]","action":"speak","message":""}'
            : '{"thought":"[SEARCH: best quantization methods for local LLMs 2026]","action":"speak","message":""}',
          readInstructions: showThoughts
            ? 'Use [SEARCH: your query] to search the web, or [READ: https://example.com] to read a specific page. Search early in the discussion to ground your inputs in actual facts.'
            : 'Use [SEARCH: your query] in your JSON thought field to search the web, or [READ: https://example.com] to read a specific page.'
        })
      : "",
    !sysCfg.stageDirectionsEnabled
      ? frag('participant_fact_pin')
      : "",
    !sysCfg.stageDirectionsEnabled
      ? frag('participant_style_control')
      : "",
    (() => {
      const mode = state.userContext?.interactionMode || "collaborator";
      if (mode === "observer") return "";
      const allowedDesc = mode === "sponsor"
        ? "major decisions or conflicts only"
        : "decisions, conflicts, questions, clarifications, or needed information";
      return frag('participant_pause', { allowedDesc });
    })()
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "actor", actor });

  const isBackgroundActor = (actor.actorMode || 'participant') === 'background';
  let actorSystem = system;
  if (isBackgroundActor) {
    const nextAct = options.nextActor;
    const nextLabel = nextAct
      ? `The next scheduled actor is: **${nextAct.name}** (${nextAct.role || 'participant'}).`
      : 'No next actor determined yet.';
    actorSystem = `BACKGROUND MODE: Your response will NOT appear in the transcript. Only your promptInjections, manageActors, nextSpeaker, and privateMessages fields take effect. Omit or leave "message" blank.\n${nextLabel}\n\n` + system;
  }

  const promptParts = {
    ...getLastPromptParts(),
    system: actorSystem,
    persona: `Name: ${actor.name}\nRole: ${actor.role || ""}\nPersona: ${actor.persona || ""}\nVoice: ${actor.voice || ""}`
  };

  let actorUser = triggerBlock ? `${user}\n\n${triggerBlock}` : user;
  if (options.correction) actorUser += `\n\n[CORRECTION: ${options.correction}]`;
  const actorSchema = buildActorSchema(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, forceSpeak, validSpeakerNames });
  const dynamicMaxTokens = getAndConsumeInjectionMaxTokens() || options.maxTokensOverride || actor.maxTokens || intentBudget || null;
  const result = await chatJson(actorSystem, actorUser, actor.temperature ?? state.settings.temperature, signal, onStream, dynamicMaxTokens, actorSchema, { toolsAllowed: !!actor.canResearch, tier: thinkingTier, purpose: actor.name });
  result._promptParts = promptParts;
  return result;
}

export async function runDirectorBrief() {
  const director = state.actors.find(a => a.canDirect && a.enabled);
  if (!director) {
    setStatus("Enable a Director actor to run a brief.", "warn");
    return;
  }
  if (!state.settings.model) {
    setStatus("Choose a model first.", "warn");
    return;
  }
  if (_pipelineActive) {
    setStatus("A turn or round is already in progress.", "warn");
    return;
  }
  _pipelineActive = true;
  setBusy(true);
  try {
    ensureSessionController();
    const streamingColor = director.color || "var(--gold)";
    showStreamingBubble(director.name, streamingColor, "dm");
    const onStream = (data) => updateStreamingBubble(data);

    const showThoughts = !state.settings.turboMode;
    const briefSchema = buildActorSchema(director, { showThoughts, hasEditable: false, stageDirections: false, allowNextSpeaker: false });
    const system = [
      frag('director_identity', { name: director.name }),
      director.persona ? frag('director_persona', { persona: director.persona }) : "",
      frag('director_brief'),
      buildSchemaPromptLine(director, { showThoughts, hasEditable: false, stageDirections: false, allowNextSpeaker: false, schemaActive: isJsonSchemaSupported(resolveModelTier('reason')) }),
      frag('security_transcript')
    ].filter(Boolean).join("\n");
    const user = await buildPromptContext({ kind: "actor", actor: director, privateThoughts: "" });

    const result = await chatJson(system, user, state.settings.temperature, abortController.signal, onStream, null, briefSchema, { toolsAllowed: !!director.canResearch, tier: 'reason', purpose: 'directorBrief' });
    removeStreamingBubble();
    director.thoughts = appendMemory(director.thoughts, result.thought);
    await addMessage({
      type: "dm",
      speaker: director.name,
      content: result.message || "(No brief generated)",
      thought: result.thought,
      color: director.color || "var(--gold)",
      toolCalls: [],
      docEdited: false
    });
    setStatus("Director brief complete.", "ok");
  } catch (err) {
    removeStreamingBubble();
    setStatus(`Brief failed: ${err.message}`, "error");
  } finally {
    _pipelineActive = false;
    setBusy(false);
    abortController = null;
    _sessionController = null;
  }
}

function hasTask() {
  return !!String(state.scenario?.task || '').trim();
}
