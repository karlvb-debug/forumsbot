import { colors } from '../constants.js';
import { state, saveState, logTransition } from '../state.js';
import { mutateState } from '../stateStore.js';
import { chatCompletion } from '../api.js';
import { getActorMemory, putActorMemory } from '../db.js';
import { appendMemory, trimWords } from '../utils.js';
import { showBackgroundActivity, hideBackgroundActivity } from '../streamingStore.js';
import { frag } from '../../prompts/index.js';
import { addMessage, resolvePolicy } from './config.js';

let _pauseResolve = null;
let _pauseRecordId = null;
let _resumeAfterPause = false;

export function resolvePause(response) {
  if (_pauseResolve) {
    _pauseResolve(String(response || ""));
    _pauseResolve = null;
    _pauseRecordId = null;
  }
}

export function reopenPause() {
  const pending = (state.pendingPauses || []).find(p => p.outcome === "honored" && !p.userResponse && !p.resolvedAt);
  if (pending) {
    mutateState(s => {
      s.ui.pauseModal = { pauseRecord: pending };
      s.ui.awaitingUserInput = true;
    });
  }
}

export function resolveDeferredQuestion(id, response) {
  const resp = String(response || "").trim();
  mutateState(s => {
    const pause = (s.pendingPauses || []).find(p => p.id === id);
    if (pause && pause.outcome === "deferred") pause.userResponse = resp;
    const msg = s.messages.find(m => m.pauseRecord?.id === id);
    if (msg) msg.pauseRecord = { ...msg.pauseRecord, userResponse: resp };
  });
}

async function promptPause(pauseRecord) {
  if (_pauseResolve) {
    console.warn(`[pause] New pause replacing unresolved pause ${_pauseRecordId} — resolving with default`);
    const oldResolve = _pauseResolve;
    const oldId = _pauseRecordId;
    _pauseResolve = null;
    _pauseRecordId = null;
    const oldPause = (state.pendingPauses || []).find(p => p.id === oldId);
    oldResolve(oldPause?.defaultIfNoResponse || "");
  }
  return new Promise(resolve => {
    _pauseResolve = resolve;
    _pauseRecordId = pauseRecord.id;
    mutateState(s => { s.ui.pauseModal = { pauseRecord }; s.ui.awaitingUserInput = true; });
  });
}

function applyActorManagement(spec, managerName, managerColor) {
  const log = [];

  for (const s of (spec.create || []).slice(0, 2)) {
    const name = String(s.name || "").trim().slice(0, 50) || `Specialist ${state.actors.length + 1}`;
    state.actors.push({
      id: crypto.randomUUID(),
      name,
      role: String(s.role || "Specialist").trim().slice(0, 70),
      persona: String(s.persona || "").trim(),
      goal: String(s.goal || "").trim(),
      voice: String(s.voice || "").trim(),
      thoughts: "",
      relationships: {},
      enabled: s.enabled !== false,
      canDirect: !!s.canDirect,
      canManageCast: !!s.canManageCast,
      canResearch: !!s.canResearch,
      canSeeThoughts: !!s.canSeeThoughts,
      canInject: !!s.canInject,
      canWriteDocuments: !!s.canWriteDocuments,
      canPause: typeof s.canPause === "boolean" ? s.canPause : (!!s.canDirect || !(s.canManageCast || s.canResearch)),
      canAnchor: typeof s.canAnchor === "boolean" ? s.canAnchor : (!!s.canDirect || !(s.canManageCast || s.canResearch)),
      canPinFacts: typeof s.canPinFacts === "boolean" ? s.canPinFacts : (!!s.canDirect || !(s.canManageCast || s.canResearch)),
      canSuggestSpeaker: typeof s.canSuggestSpeaker === "boolean" ? s.canSuggestSpeaker : (!!s.canDirect || !(s.canManageCast || s.canResearch)),
      canUpdateStyle: typeof s.canUpdateStyle === "boolean" ? s.canUpdateStyle : (!!s.canDirect || !(s.canManageCast || s.canResearch)),
      authority: typeof s.authority === "number" ? s.authority : 50,
      temperature: typeof s.temperature === "number" ? s.temperature : 0.8,
      cadence: null,
      actorMode: 'participant',
      triggerOn: [],
      expanded: false,
      color: colors[state.actors.length % colors.length]
    });
    log.push(`Created "${name}"`);
  }

  if (log.length) {
    saveState();
    addMessage({
      type: "management",
      speaker: managerName,
      content: log.join(" · "),
      color: managerColor
    });
    logTransition("manager_action", { manager: managerName, actions: log });
  }
}

export async function applyAiResult(participant, result, { justSpokeId = null, onConflict = null } = {}) {
  console.debug(`[applyAiResult] ${participant.data.name}:`, {
    action: result.action,
    thoughtLen: result.thought?.length || 0,
    toolCalls: result.toolCalls?.length || 0,
    docEdits: Array.isArray(result.documentEdits) ? result.documentEdits.length : 0,
    messagePreview: result.message?.slice(0, 80)
  });

  const speakerName = participant.data.name;
  let docEdited = false;
  if (Array.isArray(result.documentEdits) && result.documentEdits.length) {
    console.warn(`[document] ${speakerName} returned documentEdits during a normal turn — ignored. Use a Writer task instead.`);
  } else if (result.documentEdit) {
    console.warn(`[document] ${speakerName} used legacy documentEdit field — ignoring. Use a Writer task instead.`);
  }

  const actor = participant.data;
  actor.thoughts = appendMemory(actor.thoughts, result.thought);

  if (actor.canDirect && result.anchor && String(result.anchor).trim()) {
    const anchorText = String(result.anchor).trim().slice(0, 160);
    if (!state.anchors) state.anchors = [];
    const alreadyAnchored = state.anchors.some(a => a.text === anchorText);
    if (!alreadyAnchored) {
      const pendingAnchor = { id: crypto.randomUUID(), text: anchorText, speaker: actor.name, color: actor.color, suggestedAt: new Date().toISOString() };
      if (!state.memory.pendingAnchors) state.memory.pendingAnchors = [];
      state.memory.pendingAnchors.push(pendingAnchor);
      logTransition("anchor_suggested", { text: anchorText });
    }
  }

  if (actor.canManageCast && result.manageActors && typeof result.manageActors === "object") {
    applyActorManagement(result.manageActors, actor.name, actor.color);
  }

  if (result.nextSpeaker && (state.scenario?.systems?.turnRouting?.allowDirectAddress !== false)) {
    const targetName = String(result.nextSpeaker).trim().toLowerCase();
    const targetActor = state.actors.find(a => a.enabled && a.name.toLowerCase() === targetName);
    if (targetActor && targetActor.id !== actor.id) {
      if (justSpokeId && targetActor.id === justSpokeId) {
        console.debug(`[turns] ${actor.name} tried to route to just-spoke actor ${targetActor.name} — ignored (loop prevention)`);
      } else {
        console.debug(`[turns] ${actor.name} routed next turn to: ${targetActor.name}`);
        state.turnQueue = state.turnQueue.filter(id => id !== targetActor.id);
        state.turnQueue.unshift(targetActor.id);
        saveState();
      }
    } else if (targetActor && targetActor.id === actor.id) {
      console.debug(`[turns] ${actor.name} tried to route to itself — ignored`);
    } else if (!targetActor) {
      console.warn(`[handoff] ${actor.name} named unknown nextSpeaker "${result.nextSpeaker}"`);
    }
  }

  if (result.updateStyle && typeof result.updateStyle === "string") {
    const newStyle = result.updateStyle.trim();
    if (newStyle) {
      mutateState(s => {
        s.pendingStyleUpdate = {
          proposedBy: speakerName,
          newStyle,
          proposedAt: new Date().toISOString()
        };
      });
      logTransition("style_proposed", { actor: speakerName, newStyle });
    }
  }

  if (result.pinFact) {
    const fact = String(result.pinFact).trim();
    const duped = (state.memory.pinnedFacts || []).some(f =>
      f.toLowerCase() === fact.toLowerCase());
    if (!duped && fact) {
      if (!Array.isArray(state.memory.pinnedFacts)) state.memory.pinnedFacts = [];
      state.memory.pinnedFacts.push(fact);
      logTransition("fact_pinned", { actor: speakerName, fact });
    }
  }

  if (actor.canInject && Array.isArray(result.promptInjections)) {
    for (const inj of result.promptInjections.slice(0, 3)) {
      const target = state.actors.find(a => a.enabled &&
        a.name.toLowerCase() === String(inj.targetName || "").toLowerCase());
      if (!target || !inj.content) continue;
      if (!Array.isArray(state.pendingInjections)) state.pendingInjections = [];
      state.pendingInjections.push({
        id: crypto.randomUUID(), injectorId: actor.id, targetId: target.id,
        content: String(inj.content).slice(0, 500),
        scope: inj.scope === "persistent" ? "persistent" : "next_turn_only",
        insertedAt: new Date().toISOString()
      });
    }
  }

  if (actor.canInject && Array.isArray(result.privateMessages)) {
    for (const msg of result.privateMessages.slice(0, 3)) {
      const target = state.actors.find(a => a.enabled &&
        a.name.toLowerCase() === String(msg.toName || "").toLowerCase());
      if (!target || !msg.content) continue;
      if (!Array.isArray(state.pendingPrivateMessages)) state.pendingPrivateMessages = [];
      state.pendingPrivateMessages.push({
        id: crypto.randomUUID(), fromId: actor.id, fromName: speakerName,
        toId: target.id, toName: target.name,
        content: String(msg.content).slice(0, 500),
        sentAt: new Date().toISOString(), consumed: false
      });
    }
  }

  const speakerMessages = state.messages.filter(m => m.speaker === speakerName && m.type !== "skip");
  if (result.action !== "skip" && result.message && speakerMessages.length > 0) {
    const lastMsg = speakerMessages[speakerMessages.length - 1];
    if (lastMsg.content && lastMsg.content.trim() === result.message.trim()) {
      console.warn(`[turns] Repetition safeguard triggered: forcing skip for ${speakerName}`);
      result.action = "skip";
    }
  }

  const msgType = actor.canDirect ? "dm" : "actor";
  const isBackground = (actor.actorMode || 'participant') === 'background';

  const routeInfo = state._pendingTurnIntent || null;
  state._pendingTurnIntent = null;

  if (result.action === "skip") {
    logTransition("skip_decision", { speaker: speakerName, reason: result.thought });
    actor.skipCount = (actor.skipCount || 0) + 1;
    saveState();
    if (isBackground) return;
    return addMessage({ type: "skip", actorId: actor.id, speaker: actor.name, content: "Skipped.", thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, nextSpeaker: result.nextSpeaker || "", routeInfo });
  }


  actor.turnCount = (actor.turnCount || 0) + 1;
  saveState();

  if (!isBackground) {
    await addMessage({ type: msgType, actorId: actor.id, speaker: actor.name, content: result.message, thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, nextSpeaker: result.nextSpeaker || "", routeInfo });
  }

  if (result.pauseRequest && typeof result.pauseRequest === "object") {
    const pr = result.pauseRequest;

    const REPAIR_ARTIFACTS = /completing.*truncated|previously truncated|resume.*json|complete.*json|n\/a/i;
    const rawQuestion = String(pr.question || "").trim();
    const rawContext = String(pr.context || "").trim();
    const questionIsGarbage = !rawQuestion || rawQuestion.length < 3 || REPAIR_ARTIFACTS.test(rawQuestion);
    const contextIsGarbage = !rawContext || rawContext.length < 3 || REPAIR_ARTIFACTS.test(rawContext);

    if (questionIsGarbage && contextIsGarbage) {
      console.warn(`[pause] Rejected garbage pause request from ${speakerName}: question="${rawQuestion}", context="${rawContext}"`);
    } else {
    const question = questionIsGarbage
      ? (result.message ? `${speakerName} needs your input: "${String(result.message).slice(0, 200)}"` : "What would you like to do?")
      : rawQuestion;
    const context = contextIsGarbage
      ? (result.message ? String(result.message).slice(0, 300) : "")
      : rawContext;

    const policy = resolvePolicy(state.userContext);
    const roundPauses = (state.pendingPauses || []).filter(p => p.outcome === "pending" || p.outcome === "honored").length;
    const allowed = policy.allowedReasons.includes(pr.reason) && roundPauses < policy.maxPausesPerRound;
    const deferMode = policy.deferMode ?? true;
    const outcome = allowed ? "honored" : (deferMode ? "deferred" : "suppressed");

    const record = {
      id: crypto.randomUUID(),
      requesterId: actor.id,
      requesterName: speakerName,
      reason: String(pr.reason || "question"),
      context: context.slice(0, 500),
      question: question.slice(0, 300),
      options: Array.isArray(pr.options) ? pr.options.filter(o => o && String(o).trim() && !REPAIR_ARTIFACTS.test(String(o))).slice(0, 5).map(o => String(o).slice(0, 100)) : [],
      defaultIfNoResponse: String(pr.defaultIfNoResponse || "").slice(0, 200),
      requestedAt: new Date().toISOString(),
      deferredRound: outcome === "deferred" ? state.currentRound : null,
      outcome,
      userResponse: outcome === "suppressed" ? (pr.defaultIfNoResponse || "") : "",
      resolvedAt: outcome === "suppressed" ? new Date().toISOString() : "",
    };

    if (!Array.isArray(state.pendingPauses)) state.pendingPauses = [];
    state.pendingPauses = [...state.pendingPauses, record];

    if (outcome === "honored" || outcome === "deferred") {
      await addMessage({ type: "pause", actorId: actor.id, speaker: speakerName, color: actor.color, pauseRecord: record, content: record.question || record.context });
    }

    if (record.reason === 'conflict') {
      if (onConflict) await onConflict({ actorId: actor.id, actorName: speakerName, context: record.context });
    }

    if (outcome === "honored") {
      const wasAutoRunning = state.autoRunning;
      state.autoRunning = false;
      saveState();
      const userResponse = await promptPause(record);
      const resolvedAt = new Date().toISOString();
      mutateState(s => {
        const msg = s.messages.find(m => m.pauseRecord?.id === record.id);
        if (msg) msg.pauseRecord = { ...msg.pauseRecord, outcome: "resolved", userResponse, resolvedAt };
        const pause = (s.pendingPauses || []).find(p => p.id === record.id);
        if (pause) { pause.outcome = "resolved"; pause.userResponse = userResponse; pause.resolvedAt = resolvedAt; }
        s.ui.pauseModal = null;
        s.ui.awaitingUserInput = false;
      });
      if (userResponse.trim()) {
        await addMessage({
          type: "user",
          speaker: state.userContext?.displayName || "User",
          content: userResponse,
          actorId: null,
          color: "var(--accent)"
        });
      }
      if (!Array.isArray(state.pendingInjections)) state.pendingInjections = [];
      state.pendingInjections.push({
        id: crypto.randomUUID(), injectorId: "user", targetId: actor.id,
        content: `[User responded to your question "${record.question}": "${userResponse}"]`,
        scope: "next_turn_only", insertedAt: new Date().toISOString()
      });
      if (wasAutoRunning) {
        state.autoRunning = true;
      } else if (userResponse.trim()) {
        _resumeAfterPause = true;
      }
    } else if (outcome === "deferred") {
      logTransition("pause_deferred", { actorId: actor.id, reason: record.reason, round: state.currentRound });
    }
    }
  }
}

export async function finalizeDeferredQuestions(round) {
  const deferred = (state.pendingPauses || []).filter(p => p.outcome === "deferred" && p.deferredRound === round);
  if (!deferred.length) return;

  const resolvedAt = new Date().toISOString();
  for (const pause of deferred) {
    const userResponse = (pause.userResponse && pause.userResponse.trim())
      ? pause.userResponse.trim()
      : (pause.defaultIfNoResponse || "");

    mutateState(s => {
      const p = (s.pendingPauses || []).find(q => q.id === pause.id);
      if (p) { p.outcome = "assumed"; p.userResponse = userResponse; p.resolvedAt = resolvedAt; }
      const msg = s.messages.find(m => m.pauseRecord?.id === pause.id);
      if (msg) msg.pauseRecord = { ...msg.pauseRecord, outcome: "assumed", userResponse, resolvedAt };
    });

    if (userResponse) {
      if (!Array.isArray(state.pendingInjections)) state.pendingInjections = [];
      state.pendingInjections.push({
        id: crypto.randomUUID(),
        injectorId: "user",
        targetId: pause.requesterId,
        content: `[Your question "${pause.question}" wasn't answered in time. Assumed: "${userResponse}". Proceed on that basis.]`,
        scope: "next_turn_only",
        insertedAt: new Date().toISOString()
      });
    }

    logTransition("pause_assumed", { pauseId: pause.id, reason: pause.reason, round });
  }
}

export async function distillActorMemory(actorName, thought) {
  if (!thought?.trim() || !actorName) return;

  state.memory.isDistilling = true;
  state.memory.distillingActor = actorName;
  saveState();
  const activityId = showBackgroundActivity('Saving actor memory', `Distilling ${actorName}'s private thought for future sessions.`);

  const system = frag('thought_distiller', { name: actorName });
  const user = `Thought: ${trimWords(thought, 80)}`;

  try {
    const raw = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 40, tier: 'fast' });
    const sentence = (raw || '').trim().split('\n')[0].trim();
    if (sentence) {
      const existing = await getActorMemory(actorName) || '';
      const sentences = existing
        ? [...existing.split('\n').filter(Boolean), sentence].slice(-10)
        : [sentence];
      const memory = trimWords(sentences.join('\n'), 200);
      await putActorMemory(actorName, memory);
    }
  } catch (err) {
    console.warn('[cross-session-memory] distill failed:', err.message);
  } finally {
    state.memory.isDistilling = false;
    state.memory.distillingActor = '';
    saveState();
    hideBackgroundActivity(activityId);
  }
}

export async function distillAllActorsMemory() {
  if (state.settings.enableCrossSessionMemory === false) return;
  for (const actor of (state.actors || []).filter(a => a.enabled)) {
    if (!actor.thoughts?.trim()) continue;
    try {
      await distillActorMemory(actor.name, actor.thoughts);
    } catch (err) {
      console.warn('[cross-session-memory] session-end distill failed:', err.message);
    }
  }
}

export function getAndClearResumeAfterPause() {
  const val = _resumeAfterPause;
  _resumeAfterPause = false;
  return val;
}

export function cancelPendingPause() {
  if (_pauseResolve) {
    _pauseResolve('');
    _pauseResolve = null;
    _pauseRecordId = null;
  }
}
