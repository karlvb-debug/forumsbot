import { RECENT_MESSAGE_LIMIT, WORD_LIMITS, ANCHOR_WORD_CAP, colors } from './constants.js';
import { buildActorSchema, buildSchemaPromptLine } from './schemas.js';
import { state, saveState, logTransition } from './state.js';
import { chatCompletion, chatJson, chatStructured, setStatus, setCurrentSpeaker, getLastToolCalls, isJsonSchemaSupported, resolveModelTier } from './api.js';
import { mutateState } from '../hooks/useForumState.js';
import { setBusy, getBusy as getIsGenerating, showToast } from '../hooks/useActions.js';
import { showStreamingBubble, updateStreamingBubble, removeStreamingBubble, forceRemoveStreamingBubble, showBackgroundActivity, updateBackgroundActivity, hideBackgroundActivity, clearBackgroundActivities } from '../hooks/useStreaming.js';
import { putMessage, getActorMemory, putActorMemory } from './db.js';
import { summarizeMemory, recallRelevantChunks, formatCurrentOutcomes, parseOutcomeJson } from './memory.js';
import { cleanStoredMessage, parseAiJson, stringifyMessage, publicMessageContent, trimWords, stringifyList, estimateTokens, normalizeCadence, isQueueActor, shouldFireCadence, appendMemory, normalizeSpeakingOrderStrategy, formatTranscript } from './utils.js';
export { formatTranscript }; // re-export so existing imports from turns.js keep working
// preflight.js deleted — resolver handles speaker selection upstream
import { getKbEntriesForDirector, splitDocuments, buildDocumentManifestSection, buildReferenceSection, buildKbSection } from './knowledge.js';
import { buildNarrativeDmInstruction, buildRoleplayContextLine, buildRoleplayStyleBlock } from './storyMode.js';
import { frag } from '../prompts/index.js';

export function resolveSystemSettings() {
  const sys = state.scenario?.systems || {};
  return {
    stageDirectionsEnabled:   sys.stageDirections?.enabled            ?? false,
    stageDirectionsIntensity: sys.stageDirections?.intensity           ?? 'moderate',
    stageDirectionsMaxShare:  sys.stageDirections?.maxTokenShare       ?? 0.2,
    alignmentStrictness:      sys.alignment?.strictness               ?? 'moderate',
    turnStrategy:             normalizeSpeakingOrderStrategy(sys.turnRouting?.strategy),
    allowDirectAddress:       sys.turnRouting?.allowDirectAddress     ?? true,
    // Single source of truth: the director actor's directorMode field.
    // sys.dmRole is a legacy seed only — normalizeState copies it into the
    // director's directorMode, after which directorMode is authoritative. The
    // fallback here just covers sessions saved before that seeding existed.
    dmRole: (() => {
      const director = state.actors?.find(a => a.canDirect && a.enabled);
      return director?.directorMode
        || sys.dmRole?.role
        || 'facilitator';
    })(),
    // dmNarrates is derived — no longer a separate toggle.
    get dmNarrates() { return this.dmRole === 'narrator'; },
  };
}

// Mode-gating helpers used by multiple features.
// Roleplay = story session with stage directions; work = analytical session.
function isRoleplayMode() {
  return !!state.scenario?.systems?.stageDirections?.enabled;
}
function hasTask() {
  return !!String(state.scenario?.task || '').trim();
}

// Feature F: Output quality validator — returns null if OK, else a problem string.
function validateActorOutput(result) {
  const msg = String(result?.message || '').trim();
  if (result?.action === 'skip') return null; // skip is a valid action
  if (!msg) return 'empty';
  if (msg.length < 2) return 'too_short';
  if (/^(certainly|sure|okay|as an ai)\b/i.test(msg) && msg.length < 25) return 'filler_only';
  return null;
}

// Resolve an actor's thinking tier: explicit override, else a sensible default by
// role. Directors and document writers reason; ordinary characters in a roleplay
// scene don't need to (their "thought" is just latency); everyone else fakes it
// via the JSON thought field. The tier drives both which model serves the call
// (a `reason` tier can use a dedicated reasoning model) and whether the thought
// field is populated at all (`fast` = no thinking).
export function resolveActorThinkingTier(actor) {
  const t = actor?.thinkingTier;
  if (t === 'fast' || t === 'think' || t === 'reason') return t;
  if (actor?.canDirect || actor?.canWriteDocuments) return 'reason';
  if (state.scenario?.systems?.stageDirections?.enabled) return 'fast';
  return 'think';
}

function globalStyleInstruction() {
  if (state.settings?.globalStyleEnabled === false) return "";
  const prompt = String(state.settings?.globalStylePrompt || "").trim();
  return prompt ? `GLOBAL STYLE: ${prompt}` : "";
}

// Pause policy is a simple allow/deny by interaction mode: which reasons may
// interrupt the user, and how many pauses per round. (The old honoredWindow
// field was never read by any logic and has been removed.)
const PAUSE_POLICY_DEFAULTS = {
  sponsor:      { allowedReasons: ["decision", "conflict"], maxPausesPerRound: 1, deferMode: true },
  collaborator: { allowedReasons: ["decision", "conflict", "question", "clarification", "information"], maxPausesPerRound: 2, deferMode: true },
  observer:     { allowedReasons: [], maxPausesPerRound: 0, deferMode: true },
};

export function resolvePolicy(userContext) {
  const base = PAUSE_POLICY_DEFAULTS[userContext?.interactionMode] || PAUSE_POLICY_DEFAULTS.collaborator;
  return { ...base, ...(userContext?.pausePolicy || {}) };
}

// Called by PauseCard when the user submits a response.
let _pauseResolve = null;
let _pauseRecordId = null;

export function resolvePause(response) {
  if (_pauseResolve) {
    _pauseResolve(String(response || ""));
    _pauseResolve = null;
    _pauseRecordId = null;
  }
}

/**
 * Re-show the pause modal for an honored-but-unresolved pause.
 * Called from the UI when the user clicks on the "unanswered question" strip.
 */
export function reopenPause() {
  const pending = (state.pendingPauses || []).find(p => p.outcome === "honored" && !p.userResponse && !p.resolvedAt);
  if (pending) {
    mutateState(s => {
      s.ui.pauseModal = { pauseRecord: pending };
      s.ui.awaitingUserInput = true;
    });
  }
}

// Called from PauseCard when user optionally answers a deferred question before round end.
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
  // If another pause is already pending, auto-resolve it with its default
  if (_pauseResolve) {
    console.warn(`[pause] New pause replacing unresolved pause ${_pauseRecordId} — resolving with default`);
    const oldResolve = _pauseResolve;
    const oldId = _pauseRecordId;
    _pauseResolve = null;
    _pauseRecordId = null;
    // Resolve the old one with its default response
    const oldPause = (state.pendingPauses || []).find(p => p.id === oldId);
    oldResolve(oldPause?.defaultIfNoResponse || "");
  }
  return new Promise(resolve => {
    _pauseResolve = resolve;
    _pauseRecordId = pauseRecord.id;
    mutateState(s => { s.ui.pauseModal = { pauseRecord }; s.ui.awaitingUserInput = true; });
  });
}

let _sessionController = null;
export let abortController = null;


function ensureSessionController() {
  if (!_sessionController || _sessionController.signal.aborted) {
    _sessionController = new AbortController();
  }
  abortController = _sessionController;
  return _sessionController;
}
let _stopFlag = false;
// Pipeline re-entrancy lock. Held for the full duration of a manual single turn,
// a manual round, or an auto-loop — NOT toggled between turns the way `busy` is.
// Prevents concurrent turn pipelines when the user double-clicks Next/Round/Auto
// or fires the Alt+N/R/A shortcuts (which bypass button `disabled` state).
let _pipelineActive = false;

// Set when a pause is resolved with a user response in non-auto mode.
// Checked by pipeline exit points to schedule a deferred continuation so the
// actors react to the user's answer.
let _resumeAfterPause = false;

/**
 * Called from pipeline exit points (finally blocks of runNextTurn, runSingleResponse,
 * runRound). If a pause was resolved with a user response during the pipeline, this
 * schedules a deferred single-response turn so the actors react to the user's answer.
 * Uses setTimeout(0) so the pipeline lock is fully released before re-entry.
 */
function _maybeResumeAfterPause() {
  if (!_resumeAfterPause) return;
  _resumeAfterPause = false;
  // Defer so the current finally block finishes and _pipelineActive is false
  setTimeout(() => {
    if (_pipelineActive || state.autoRunning) return; // guard against races
    console.debug('[turns] Resuming after pause response');
    runSingleResponse().catch(err =>
      console.warn('[turns] Post-pause continuation failed:', err?.message || err));
  }, 50);
}
let _lastPromptParts = null;
let _lastInjectionMaxTokens = null; // Feature H: dynamic maxTokens from injections
export function getLastPromptParts() { return _lastPromptParts; }

// Feature E: Planning pre-pass — generates a 3-5 step discussion spine from the task.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: { type: 'string' } }
  },
  required: ['steps'],
  additionalProperties: false
};

export async function generateDiscussionPlan(signal) {
  const task = String(state.scenario?.task || '').trim();
  if (!task) return null;
  const actors = state.actors.filter(a => a.enabled).map(a => `${a.name} (${a.role})`).join(', ');
  const system = 'You are a discussion planner. Given a task and cast, produce a short ordered plan of 3-5 discussion steps that would efficiently lead to a conclusion. Each step is one sentence describing what should happen in that phase. Return JSON only.';
  const user = `Task: ${task}\nParticipants: ${actors}\n\nProduce 3-5 discussion steps.`;
  try {
    const data = await chatStructured(system, user, PLAN_SCHEMA, {
      temperature: 0.3, maxTokens: 300, signal, tier: 'reason', purpose: 'planningPrePass'
    });
    const steps = Array.isArray(data?.steps) ? data.steps.slice(0, 5).map(s => String(s).trim()).filter(Boolean) : [];
    if (!steps.length) return null;
    state.scenario.plan = { steps, currentStep: 0 };
    saveState();
    console.debug(`[plan] Generated ${steps.length}-step discussion plan`);
    return state.scenario.plan;
  } catch (err) {
    console.warn('[plan] Planning pre-pass failed:', err.message);
    return null;
  }
}

export function advancePlanStep() {
  const plan = state.scenario?.plan;
  if (!plan?.steps?.length) return;
  if (plan.currentStep < plan.steps.length - 1) {
    plan.currentStep += 1;
    saveState();
    console.debug(`[plan] Advanced to step ${plan.currentStep + 1}: ${plan.steps[plan.currentStep]}`);
  }
}


// Rolling window of recent tok/s samples for the speed display.
const _tokSpeedWindow = [];

// Alignment embedding is throttled: the dial reads the last 5 messages, so
// recomputing it every single turn spends an embedding call per turn for a
// number that barely moves.

// Cumulative count of completed visible turns this session run. Drives turn-based
// cadence firing for background actors. Reset when a fresh auto-loop starts.
let _globalTurnIndex = 0;

// Actors that just ran as on_user_message triggers. If a user message
// immediately kicks off a round, don't run the same director/manager again at
// round start before ordinary actors have had a chance to speak.
let _recentUserTriggerActorIds = new Set();
function consumeRecentUserTriggerActorIds() {
  const fired = _recentUserTriggerActorIds;
  _recentUserTriggerActorIds = new Set();
  return fired;
}

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
  return storedMessage;
}

export function buildTurnQueue() {
  const enabledActors = state.actors.filter(a => a.enabled);

  // Queue holds ordinary sequential participants. Background/cadence actors
  // (directors, periodic orchestrators) fire as hooks, never in the queue.
  const queueActors = enabledActors.filter(isQueueActor);

  state.turnQueue = queueActors.map(a => a.id);
  return state.turnQueue;
}

export function sanitizeSpeakingPlan(speakers, eligibleActors) {
  if (!Array.isArray(speakers)) return null;
  const byId = new Map();
  const byName = new Map();
  for (const actor of eligibleActors) {
    byId.set(String(actor.id).toLowerCase(), actor);
    byName.set(String(actor.name || '').trim().toLowerCase(), actor);
  }
  const selected = [];
  const seen = new Set();
  for (const raw of speakers) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    const actor = byId.get(key) || byName.get(key);
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    selected.push(actor.id);
  }
  return selected;
}

// ── Unified Speaker Resolver ────────────────────────────────────────────────
// Replaces both sequential queue and agentic LLM router with a single
// handoff-first pipeline. Most decisions cost 0 tokens.

function resolverCandidates() {
  return state.actors.filter(a =>
    a.enabled &&
    !a.canManageCast &&
    (a.actorMode || 'participant') !== 'background'
  );
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectAddressedActor(text, candidates, speakerName) {
  const lower = text.toLowerCase();
  for (const actor of candidates) {
    if (actor.name === speakerName) continue;
    const name = actor.name.toLowerCase();
    if (lower.includes(`@${name}`)) return actor;
    try {
      if (new RegExp(`\\b${escapeRegex(name)}[,?!]`).test(lower)) return actor;
      if (lower.includes(`you think, ${name}`) || lower.includes(`you think ${name}`)) return actor;
    } catch { /* regex safety */ }
  }
  return null;
}

function scoreCandidates(candidates, alreadySpokeThisRound) {
  const recent = state.messages
    .filter(m => m.type !== 'skip' && m.type !== 'management')
    .slice(-6);
  const lastSpeaker = recent[recent.length - 1]?.speaker;
  const recentSpeakers = recent.slice(-3).map(m => m.speaker);
  const lastContent = (recent[recent.length - 1]?.content || '').toLowerCase();

  return candidates
    .filter(a => !alreadySpokeThisRound.has(a.id))
    .map(actor => {
      let score = 0;
      const name = actor.name.toLowerCase();
      // Named in last message (not the speaker themselves)
      if (lastContent.includes(name) && actor.name !== lastSpeaker) score += 3;
      // Not spoken this round → bonus
      if (!alreadySpokeThisRound.has(actor.id)) score += 1;
      // Spoke in last 2-3 messages → cooldown
      if (recentSpeakers.includes(actor.name)) score -= 2;
      // Was the last speaker (no handoff) → strong penalty
      if (actor.name === lastSpeaker) score -= 3;
      return { actor, score };
    })
    .sort((a, b) => b.score - a.score);
}

const TINY_ROUTER_SCHEMA = {
  type: 'object',
  properties: { speaker: { type: 'string' } },
  required: ['speaker'],
  additionalProperties: false
};

async function tinyRouter(candidates, alreadySpokeThisRound, signal) {
  const available = candidates.filter(a => !alreadySpokeThisRound.has(a.id));
  if (!available.length) return null;
  const roster = available.map(a => `${a.name} (${a.role || 'participant'})`).join(', ');
  const recent = state.messages
    .filter(m => m.type !== 'skip' && m.type !== 'management')
    .slice(-3)
    .map(m => `${m.speaker}: ${String(m.content || '').slice(0, 100)}`)
    .join('\n');

  const system = 'Pick exactly one speaker or NONE. Return JSON: {"speaker":"Name"} or {"speaker":"NONE"}';
  const user = `Roster: [${roster}]\nRecent:\n${recent}\nWho should speak next?`;

  try {
    const result = await chatStructured(system, user, TINY_ROUTER_SCHEMA, {
      temperature: 0, maxTokens: 30, signal, tier: 'fast', purpose: 'tinyRouter'
    });
    if (!result?.speaker || result.speaker === 'NONE') return null;
    return available.find(a => a.name.toLowerCase() === result.speaker.toLowerCase()) || null;
  } catch (err) {
    console.warn('[resolver] tiny router failed, using fallback:', err.message);
    return available[0] || null;
  }
}

// ── Director Intent Pass ────────────────────────────────────────────────────
// The grounded successor to the bare tinyRouter. Instead of blindly picking a
// name, it reads the room against the scenario goal, open questions, and shared
// summary, decides what the discussion NEEDS next, then chooses the participant
// best suited to provide it — or NONE when the goal is met or the thread is
// spent. The read/need/rationale are surfaced live (background activity) and
// recorded on state.lastIntent so the UI can show why the next speaker was
// chosen. Gated to the same ambiguity trigger as tinyRouter in "auto" mode, so
// most turns still cost 0 tokens; "always" mode runs it before every turn.

const INTENT_NEEDS = ['deepen', 'challenge', 'synthesize', 'broaden', 'redirect', 'decide', 'conclude'];

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    read: { type: 'string' },
    need: { type: 'string', enum: INTENT_NEEDS },
    speaker: { type: 'string' },
    rationale: { type: 'string' },
    confidence: { type: 'number' },
    stuck: { type: 'boolean' },
    expectedOutput: { type: 'string' }
  },
  required: ['need', 'speaker'],
  additionalProperties: false
};

// Intent system prompt — editable prose from registry + code-owned JSON shape.
const INTENT_SHAPE = 'Return JSON only: {"read":"<one sentence on the current state>","need":"<one need>","speaker":"<participant name or NONE>","rationale":"<one clause: why them>","confidence":<0..1>,"expectedOutput":"<optional turn directive>"}';
function getIntentSystem() { return frag('intent_system') + '\n' + INTENT_SHAPE; }

async function resolveIntent(eligible, alreadySpokeThisRound, signal) {
  const available = eligible.filter(a => !alreadySpokeThisRound.has(a.id));
  if (!available.length) return null;

  const activityId = showBackgroundActivity(
    'Director is reading the room',
    'Deciding what the discussion needs next…',
    'var(--accent)'
  );
  try {
    const sc = state.scenario || {};
    const mem = state.memory || {};

    const roster = available.map(a => {
      const aim = trimWords(String(a.goal || a.role || 'participant'), 14);
      return `- ${a.name} (${a.role || 'participant'}) — ${aim}`;
    }).join('\n');

    const recent = state.messages
      .filter(m => m.type !== 'skip' && m.type !== 'management')
      .slice(-4)
      .map(m => `${m.speaker}: ${trimWords(String(m.content || ''), 40)}`)
      .join('\n');

    const openQ = (Array.isArray(mem.openQuestions) ? mem.openQuestions : [])
      .slice(0, 3)
      .map(q => (typeof q === 'string' ? q : q?.text || q?.question || ''))
      .filter(Boolean);

    const goalBlock = [
      sc.task ? `Task: ${sc.task}` : '',
      sc.doneWhen ? `Done when: ${sc.doneWhen}` : '',
      mem.sharedSummary ? `Where things stand: ${trimWords(String(mem.sharedSummary), 60)}` : '',
      openQ.length ? `Open questions: ${openQ.join('; ')}` : ''
    ].filter(Boolean).join('\n');

    const user = [
      goalBlock,
      goalBlock ? '' : null,
      `Participants:\n${roster}`,
      '',
      `Recent discussion:\n${recent || '(nothing said yet)'}`,
      '',
      'What does the discussion need next, and who is best placed to provide it?'
    ].filter(v => v !== null).join('\n');

    const validNames = available.map(a => a.name);
    let data;
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const userMsg = correction ? `${user}\n\n${correction}` : user;
        data = await chatStructured(getIntentSystem(), userMsg, INTENT_SCHEMA, {
          temperature: 0.2, maxTokens: 160, signal, tier: 'reason', purpose: 'intentPass'
        });
      } catch (err) {
        console.warn('[resolver] intent pass failed, using fallback:', err.message);
        return null;
      }

      const name = String(data?.speaker || '').trim();
      const isNone = !name || name.toUpperCase() === 'NONE';
      const matched = isNone ? null : available.find(a => a.name.toLowerCase() === name.toLowerCase());
      if (isNone || matched) break; // good pick
      correction = `"${name}" is not a participant. Choose exactly one of: ${validNames.join(', ')} — or NONE. Return the name verbatim.`;
      console.warn(`[intent] corrective retry: "${name}" not in roster`);
    }

    const need = String(data?.need || '').trim();
    const speakerName = String(data?.speaker || '').trim();
    state.lastIntent = {
      read: String(data?.read || '').trim(),
      need,
      speaker: speakerName,
      rationale: String(data?.rationale || '').trim(),
      confidence: typeof data?.confidence === 'number' ? data.confidence : null,
      stuck: !!data?.stuck,
      expectedOutput: data?.expectedOutput ? String(data.expectedOutput).trim() : null,
      at: new Date().toISOString(),
    };

    if (!speakerName || speakerName.toUpperCase() === 'NONE') {
      updateBackgroundActivity(activityId, {
        detail: need === 'conclude' ? 'Goal looks met — wrapping up.' : 'Natural pause — no one needs to speak.'
      });
      return { actor: null, conclude: true, data: state.lastIntent };
    }

    const matched = available.find(a => a.name.toLowerCase() === speakerName.toLowerCase());
    updateBackgroundActivity(activityId, {
      detail: matched
        ? `Needs to ${need || 'continue'} → ${matched.name}`
        : `Suggested ${speakerName} (not in roster).`
    });
    return { actor: matched || null, conclude: false, data: state.lastIntent };
  } finally {
    hideBackgroundActivity(activityId);
  }
}

export async function resolveNextSpeaker(candidates, { signal, alreadySpokeThisRound = new Set() } = {}) {
  if (!candidates.length) return null;
  // Filter out actors who already spoke this round
  const eligible = candidates.filter(a => !alreadySpokeThisRound.has(a.id));
  if (!eligible.length) return null;
  if (eligible.length === 1) return { actor: eligible[0], reason: 'only-one' };

  // 1. @mention — user explicitly targeted someone
  const mentionTarget = state.ui?.mentionTarget;
  if (mentionTarget) {
    state.ui.mentionTarget = null;
    const target = eligible.find(a => a.id === mentionTarget);
    if (target) return { actor: target, reason: 'mention' };
  }

  // 2. Explicit address — last message names an actor
  const lastMsg = state.messages
    .filter(m => m.type !== 'skip' && m.type !== 'management')
    .slice(-1)[0];
  if (lastMsg?.content) {
    const addressed = detectAddressedActor(lastMsg.content, eligible, lastMsg.speaker);
    if (addressed) return { actor: addressed, reason: 'addressed' };
  }

  // 3. Speaker handoff — last actor set nextSpeaker (prepended to queue by applyAiResult)
  if (state.turnQueue.length) {
    const handoffId = state.turnQueue[0];
    const handoff = eligible.find(a => a.id === handoffId);
    if (handoff) {
      state.turnQueue.shift();
      return { actor: handoff, reason: 'handoff' };
    }
  }

  const intentMode = state.settings?.intentPass || 'auto';

  // 3b. Intent pass (always) — reason about the room before falling back to
  // heuristics. A hallucinated/unmatched name falls through to scoring below.
  if (intentMode === 'always') {
    const intent = await resolveIntent(eligible, alreadySpokeThisRound, signal);
    if (intent) {
      if (intent.actor) return { actor: intent.actor, reason: 'intent', intent: intent.data };
      if (intent.conclude) return null; // NONE — natural conclusion
    }
  }

  // 4. Deterministic scoring
  const scored = scoreCandidates(eligible, alreadySpokeThisRound);
  const top = scored[0];
  const second = scored[1];
  if (top && (!second || top.score - second.score >= 2)) {
    return { actor: top.actor, reason: 'score' };
  }

  // 5. Ambiguous — grounded intent pass (default), or the bare router when
  // intent reasoning is disabled. "always" already ran above, so skip here.
  if (eligible.length > 1 && top) {
    if (intentMode === 'off') {
      const routed = await tinyRouter(eligible, alreadySpokeThisRound, signal);
      if (routed === null) return null; // NONE — natural conclusion
      if (routed) return { actor: routed, reason: 'router' };
    } else if (intentMode === 'auto') {
      const intent = await resolveIntent(eligible, alreadySpokeThisRound, signal);
      if (intent) {
        if (intent.actor) return { actor: intent.actor, reason: 'intent', intent: intent.data };
        if (intent.conclude) return null; // NONE — natural conclusion
      }
    }
  }

  // 6. Least-recently-spoke fallback
  if (top) return { actor: top.actor, reason: 'recency' };

  // 7. NONE
  return null;
}

export function nextParticipant() {
  const enabled = state.actors.filter((actor) => actor.enabled).map((actor) => actor.id);
  const enabledSet = new Set(enabled);
  state.turnQueue = state.turnQueue.filter((id) => enabledSet.has(id));

  const queueSet = new Set(state.turnQueue);
  const missing = enabled.filter(id => {
    if (queueSet.has(id)) return false;
    const a = state.actors.find(x => x.id === id);
    return a ? isQueueActor(a) : false;
  });
  if (missing.length) {
    state.turnQueue.push(...missing);
  }

  if (!state.turnQueue.length) buildTurnQueue();

  // @mention routing: if the user addressed a specific actor, route to them first
  const mentionTarget = state.ui?.mentionTarget;
  if (mentionTarget) {
    state.ui.mentionTarget = null;
    const target = state.actors.find(a => a.enabled && a.id === mentionTarget);
    if (target) {
      // Route the mentioned actor to the front. The shift()+push() rotation
      // below re-queues them once; pushing here too would duplicate them at the
      // back and let them speak again too soon.
      state.turnQueue = state.turnQueue.filter(id => id !== target.id);
      state.turnQueue.unshift(target.id);
    }
  }

  const id = state.turnQueue.shift();
  if (!id) return null;
  state.turnQueue.push(id);
  const actor = state.actors.find((item) => item.id === id);
  return actor ? { kind: "actor", data: actor } : null;
}

/**
 * Fire all `every-turn` actors as silent between-turn hooks.
 * Called after each normal actor's turn completes. These actors see the latest
 * transcript message and can inject guidance, manage cast, or re-route the next speaker.
 */
// ── Event trigger labels ───────────────────────────────────────────────────────
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

/**
 * Fire all actors whose triggerOn array includes eventName.
 * Runs them silently (background-style prompt context injected automatically).
 */
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
        await applyAiResult({ kind: 'actor', data: actor }, result, { justSpokeId: excludeId });
      }
    } catch (err) {
      console.warn(`[turns] trigger "${eventName}" actor "${actor.name}" error:`, err.message);
    } finally {
      hideBackgroundActivity(activityId);
    }
  }
  return fired;
}

/** Called by useActions.sendMessage after a user message is added to state. */
export async function fireUserMessageTriggers(message) {
  // This is the one trigger entry point fired from OUTSIDE the turn pipeline
  // (the others run inside runNextTurn/runRound). If a turn, round, or auto-loop
  // is already in flight, firing here would run a director/manager model call
  // concurrently with the running pipeline — exactly the "responds, then responds
  // again before finishing" loop seen with director/manager actors. The running
  // pipeline already sees the user message in its transcript context, so we skip.
  if (_pipelineActive) {
    console.warn('[turns] fireUserMessageTriggers skipped — pipeline already active');
    return;
  }
  _pipelineActive = true;
  const alreadyBusy = getIsGenerating();
  if (!alreadyBusy) setBusy(true);
  try {
    _recentUserTriggerActorIds = await fireTriggerActors('on_user_message', { message });
    // Inline Scribe command — works regardless of scribeMode (so users can still
    // ask the Scribe to write even when autonomy is set to "manual").
    try {
      const docMod = await import('./documentWriting.js');
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
  // Cadence-based: background/periodic actors on a turn cadence that is due this
  // turn (e.g. every turn, or every Nth turn). Exclude the actor that just took
  // its visible turn — otherwise a per-turn director would re-fire on itself and
  // could route the conversation back to itself, churning indefinitely.
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
        await applyAiResult({ kind: 'actor', data: actor }, result, { justSpokeId });
      }
    } catch (err) {
      console.warn(`[turns] cadence actor "${actor.name}" error:`, err.message);
    } finally {
      hideBackgroundActivity(activityId);
    }
  }
}

/**
 * Fire background actors on a round cadence that is due for state.currentRound.
 * Called at round start, after on_round_start triggers. `alreadyFired` is the
 * Set returned by that trigger pass so an actor isn't fired twice.
 */
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
        await applyAiResult({ kind: 'actor', data: actor }, result);
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
  // Internal round-continuation calls run under the lock already held by
  // runRound/runAutoLoop — they bypass acquisition. Only manual single-turn
  // calls acquire the lock here.
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
    const candidates = resolverCandidates();
    const resolved = await resolveNextSpeaker(candidates, {
      signal: _sessionController?.signal
    });
    if (!resolved) {
      setStatus("No eligible speaker found.", "warn");
      return false;
    }
    // Place resolved actor at front for _runTurn's nextParticipant()
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

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (abortController?.signal.aborted) break;
    try {
      ensureSessionController();
      setCurrentSpeaker(participant.data.name);

      const startTime = Date.now();

      // The resolver already selected this actor as relevant — no preflight needed.
      let twoPhase = !!options.forceSpeak;

      // Show a streaming bubble so the user sees activity immediately.
      // updateStreamingBubble() fills in message text as tokens arrive.
      const streamingColor = participant.data.color || "var(--accent)";
      showStreamingBubble(participant.data.name, streamingColor, "actor");
      const onStream = (data) => updateStreamingBubble(data);

      let result = await askActor(participant.data, abortController.signal, onStream, twoPhase, { forceSpeak: !!options.forceSpeak });

      // Feature F: Output guardrails — validate and optionally retry once
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
      // Advance the global turn counter, then fire cadence/every-turn background
      // actors (excluding the actor that just spoke, so a director doesn't
      // immediately re-fire on itself).
      _globalTurnIndex += 1;
      await runBetweenTurnActors(abortController.signal, participant.data.id);

      // Scribe autonomy pass — runs once per turn after between-turn orchestration.
      // Honors state.documentWriting.scribeMode (manual skips entirely). Failures
      // are intentionally swallowed: a writer hiccup must never break the loop.
      try {
        const docMod = await import('./documentWriting.js');
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
      // Store prompt parts for debugging
      if (result._promptParts) {
        _lastPromptParts = result._promptParts;
      }

      setStatus(`Last turn: ${participant.data.name}`, "ok");
      setBusy(false);
      abortController = null;
      _sessionController = null;
      return true;
    } catch (error) {
      lastError = error;
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
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        await countdownRetry(attempt + 1, delayMs);
        continue;
      }

      // Non-retryable or retries exhausted
      const msg = lastError.message || "Generation failed.";
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

  // Aborted during retry loop
  setStatus("Generation stopped.", "warn");
  clearBackgroundActivities();
  setBusy(false);
  return false;
}

export async function runRound(options = {}) {
  console.debug('[turns] runRound called', options);
  // Auto-loop calls pass fromAuto:true and already hold the pipeline lock.
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

// At round end, finalize all deferred questions from this round.
// Uses any inline user response the watcher typed; falls back to defaultIfNoResponse.
// Injects the assumed answer as a private note for the requester's next turn.
async function finalizeDeferredQuestions(round) {
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

    // Inject assumed answer so the requester knows on their next turn
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

async function _runRound(options = {}) {
  abortController = null;
  _sessionController = null; // Reset abort state for the new round
  _stopFlag = false;          // Clear stop flag for this round

  const candidates = resolverCandidates();
  if (!candidates.length) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  const maxTurns = candidates.length;
  const startIndex = state.messages.length;
  let completedTurns = 0;
  state.currentRound = (state.currentRound || 0) + 1;
  // Feature E: advance the plan step at each round boundary
  if (state.currentRound > 1) advancePlanStep();
  // Feature E: auto-generate plan at session start if task exists and no plan yet
  if (state.currentRound === 1 && hasTask() && !state.scenario.plan) {
    try { await generateDiscussionPlan(abortController?.signal); } catch (e) { /* silent */ }
  }

  // Fire round-start triggers (background orchestrators can set up injections/routing),
  // then any round-cadence background actors that are due this round.
  const userTriggerFired = consumeRecentUserTriggerActorIds();
  const rsFired = await fireTriggerActors('on_round_start', { round: state.currentRound }, abortController?.signal, null, userTriggerFired);
  await runRoundCadenceActors(abortController?.signal, new Set([...userTriggerFired, ...rsFired]));

  // Per-turn resolver loop — re-evaluate after every turn instead of pre-planning
  const alreadySpokeThisRound = new Set();
  for (let i = 0; i < maxTurns; i++) {
    if (_stopFlag || abortController?.signal.aborted) break;
    const resolved = await resolveNextSpeaker(candidates, {
      signal: _sessionController?.signal,
      alreadySpokeThisRound
    });
    if (!resolved) break; // NONE — natural conclusion

    // Stash the routing reason so applyAiResult can attach it to the message.
    state._pendingTurnIntent = { reason: resolved.reason, ...(resolved.intent || {}) };

    // Place resolved actor at front for _runTurn's nextParticipant()
    state.turnQueue = [resolved.actor.id, ...state.turnQueue.filter(id => id !== resolved.actor.id)];
    const ok = await runNextTurn({ summarizeCycle: false, isRoundContinuation: true, forceSpeak: false });
    if (!ok) { state._pendingTurnIntent = null; break; }
    alreadySpokeThisRound.add(resolved.actor.id);
    completedTurns++;
    // Configurable inter-turn pause when auto-running
    if (options.fromAuto) {
      const delayMs = (state.settings.turnDelay || 0) * 1000;
      if (delayMs > 0) await wait(delayMs);
    }
  }

  // Finalize deferred questions before round-end triggers so assumed answers
  // are in state when trigger actors run and the next round starts.
  await finalizeDeferredQuestions(state.currentRound);

  const roundMessages = state.messages.slice(startIndex);

  // Fire round-end triggers before summary/stop evaluation
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

export function participantCycleCount() {
  return Math.max(1, state.actors.filter(a => a.enabled && isQueueActor(a)).length);
}

export async function runAutoLoop() {
  const starting = !state.autoRunning;
  // Starting a fresh auto-loop acquires the pipeline lock for its whole lifetime.
  // A toggle-off call (starting === false) is just a stop — it neither acquires
  // nor releases; the already-running loop releases when its while() exits.
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
  const { saveCurrentSession } = await import('./session.js');
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
    // Cross-session memory: distill once at session end (opt-in, best-effort).
    // Only distill if we ended naturally, not via stop
    if (starting && !_stopFlag) {
      await distillAllActorsMemory().catch(err =>
        console.warn('[cross-session-memory] session-end pass failed:', err?.message || err));
    }
  }
}

export function stopGeneration() {
  state.autoRunning = false;
  _stopFlag = true;
  // Do NOT clear _pipelineActive here — let the pipeline's own finally block
  // release it. Clearing it prematurely causes a race where a new pipeline
  // starts while the old finally is still running.
  abortController?.abort();
  // Resolve any pending pause so the pipeline promise doesn't hang
  if (_pauseResolve) {
    const resolve = _pauseResolve;
    _pauseResolve = null;
    _pauseRecordId = null;
    resolve('');
  }
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

  // Check the goal BEFORE the round cap so an achieved goal gets a precise
  // stop message even when both conditions are true simultaneously. The
  // `|| atMaxRounds` ensures the last round is always judged — without it,
  // odd-numbered maxRounds settings are never goal-checked before the cap fires.
  const atMaxRounds = state.autoStop.maxRoundsEnabled && state.autoStop.roundsRun >= state.autoStop.maxRounds;

  if (options.fromAuto && state.autoStop.goalCheckEnabled && state.scenario.doneWhen?.trim() && (state.autoStop.roundsRun % 2 === 0 || atMaxRounds)) {
    const verdict = await judgeGoal(roundMessages);
    if (verdict.status === 'complete') {
      state.autoRunning = false;
      setAutoStopStatus(`Task complete: ${verdict.reason}`);
      showToast(`Task complete: ${verdict.reason}`, 'ok');
      await addMessage({ type: 'system', speaker: 'System', content: `✓ Task complete: ${verdict.reason}`, color: 'var(--accent)' });
      saveState();
      return true;
    }
    if (verdict.status === 'blocked') {
      state.autoRunning = false;
      setAutoStopStatus(`Blocked: ${verdict.reason}`);
      showToast(`Discussion blocked: ${verdict.reason}`, 'warn');
      await addMessage({ type: 'system', speaker: 'System', content: `⚠ Blocked: ${verdict.reason}`, color: 'var(--warn)' });
      saveState();
      return true;
    }
    setAutoStopStatus(`Still working: ${verdict.reason || "Needs more discussion."}`);
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
    return { status: 'continue', reason: 'No completion criteria set.' };
  }
  if (!state.settings.model) {
    setAutoStopStatus("Choose or type a model before checking.");
    return { status: 'continue', reason: 'No model selected.' };
  }

  const alreadyBusy = getIsGenerating();
  setBusy(true);
  setAutoStopStatus("Checking completion...");

  const schema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
      reason: { type: 'string' }
    },
    required: ['status', 'reason'],
    additionalProperties: false
  };
  const JUDGE_SHAPE = 'Return only JSON: {"status":"continue|complete|blocked","reason":"short explanation"}';
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
      temperature: 0.1, maxTokens: 200, tier: 'reason', purpose: 'goalCheck'
    });
    const verdict = {
      status: ['complete', 'blocked', 'continue'].includes(result?.status) ? result.status : 'continue',
      reason: trimWords(String(result?.reason || ''), 80)
    };
    if (options.manual) {
      if (verdict.status === 'complete') {
        setAutoStopStatus(`Task complete: ${verdict.reason}`);
      } else if (verdict.status === 'blocked') {
        setAutoStopStatus(`Blocked: ${verdict.reason}`);
      } else {
        setAutoStopStatus(`Still working: ${verdict.reason || "Needs more discussion."}`);
      }
    }
    return verdict;
  } catch (error) {
    const message = error.message || "Completion check failed.";
    setAutoStopStatus(message);
    return { status: 'continue', reason: message };
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

// Legacy compat — old sessions may call normalizeGoalVerdict
export function normalizeGoalVerdict(value) {
  const status = value?.status || (value?.achieved ? 'complete' : 'continue');
  return { status, reason: trimWords(stringifyList(value?.reason), 80) };
}

// Called by the React StopModal component when the user makes a decision.
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

export async function promptStopOrContinue(reason, options = {}) {
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

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-Session Actor Memory.
 *
 * Distills an actor's accumulated private memory into one persistent sentence and
 * upserts it into IndexedDB. Runs once per actor at session end (see
 * distillAllActorsMemory) rather than every turn — the per-turn variant cost an
 * extra LLM call per actor per turn for a single sentence of low marginal value.
 *
 * Memory format: up to 10 sentences, newest last, word-capped at 200.
 *
 * @param {string} actorName
 * @param {string} thought  - the actor's private thought/memory to distill
 */
export async function distillActorMemory(actorName, thought) {
  if (!thought?.trim() || !actorName) return;

  state.memory.isDistilling = true;
  state.memory.distillingActor = actorName;
  saveState();
  const activityId = showBackgroundActivity('Saving actor memory', `Distilling ${actorName}'s private thought for future sessions.`);

  // Cheap distillation prompt — one sentence only
  const system = frag('thought_distiller', { name: actorName });
  const user = `Thought: ${trimWords(thought, 80)}`;

  try {
    const raw = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 40, tier: 'fast' });
    const sentence = (raw || '').trim().split('\n')[0].trim();
    if (sentence) {
      // Append to existing memory, keep last 10 sentences, word-cap at 200
      const existing = await getActorMemory(actorName) || '';
      const sentences = existing
        ? [...existing.split('\n').filter(Boolean), sentence].slice(-10)
        : [sentence];
      const memory = trimWords(sentences.join('\n'), 200);
      await putActorMemory(actorName, memory);
    }
  } catch (err) {
    // Silently fail — never interrupt a turn
    console.warn('[cross-session-memory] distill failed:', err.message);
  } finally {
    state.memory.isDistilling = false;
    state.memory.distillingActor = '';
    saveState();
    hideBackgroundActivity(activityId);
  }
}

/**
 * Session-end cross-session memory pass. Distills each enabled actor's accumulated
 * private memory once, instead of once per turn. Opt-in (enableCrossSessionMemory)
 * and best-effort — never throws into the caller.
 */
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

export async function askActor(actor, signal, onStream = null, twoPhase = false, options = {}) {
  // showThoughts controls PROMPT behavior (whether AI is told to think).
  // Decoupled from the UI toggle which only controls expand/collapse.
  // Turbo mode and the `fast` thinking tier both suppress thinking.
  const thinkingTier = resolveActorThinkingTier(actor);
  const tierModel = resolveModelTier(thinkingTier);
  const showThoughts = thinkingTier !== 'fast' && !state.settings.turboMode;
  const forceSpeak = !!options.forceSpeak;
  // In two-phase mode, Phase 1 already decided to speak — Phase 2 never re-checks skip.
  // Researchers and Managers are exempt: they have their own skip logic.
  const skipAllowed = !forceSpeak && (!twoPhase || !!actor.canResearch || !!actor.canManageCast);
  const docsContext = { hasEditable: false };
  const sysCfg = resolveSystemSettings();
  // Feature B: valid speaker names for nextSpeaker enum constraint
  const validSpeakerNames = state.actors
    .filter(a => a.enabled && a.id !== actor.id && isQueueActor(a))
    .map(a => a.name);

  // Build event context block when this call was fired by a trigger event
  const triggerBlock = options.triggerEvent
    ? buildEventContextBlock(options.triggerEvent, options.triggerData || {})
    : '';

  if (actor.canDirect) {
    // This actor is a Director — build director-style prompt
    const privateThoughts = actor.canSeeThoughts ? privateThoughtDigest() : "";
    const modeInstruction = sysCfg.dmNarrates
      ? buildNarrativeDmInstruction()
      : frag('director_mode_facilitator');

    const dmRoleModifier = sysCfg.dmRole === 'observer'
      ? frag('director_mode_observer')
      : sysCfg.dmRole === 'arbiter'
      ? frag('director_mode_arbiter')
      : "";

    // Cast management: stage-direction sessions allow scene roster changes;
    // analytical sessions require the explicit canManageCast permission.
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
      ..._lastPromptParts,
      system,
      persona: `Name: ${actor.name}\nPersona: ${actor.persona || ""}`
    };

    // Background mode: inject orchestration context and suppress participant framing
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
    const result = await chatJson(directorSystem, directorUser, actor.temperature ?? state.settings.temperature, signal, onStream, actor.maxTokens || 600, schema, { toolsAllowed: !!actor.canResearch, tier: thinkingTier, purpose: actor.name });
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

    // Background mode: inject orchestration context and suppress participant framing
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
    return chatJson(managerSystem, managerUser, actor.temperature ?? state.settings.temperature, signal, onStream, actor.maxTokens || 600, managerSchema, { toolsAllowed: false, tier: thinkingTier, purpose: actor.name });
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

    // Background mode: inject orchestration context and suppress participant framing
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

  // If the intent pass selected this actor, inject the need so it shapes the response.
  const intentHint = (() => {
    const li = state.lastIntent;
    if (!li?.need || !li?.speaker) return '';
    if (li.speaker.toLowerCase() !== actor.name.toLowerCase()) return '';
    if (Date.now() - new Date(li.at).getTime() > 10000) return '';
    const suffix = li.rationale ? ` (${li.rationale})` : '';
    let hint = frag('participant_intent_hint', { need: li.need, rationale: suffix });
    if (li.expectedOutput) {
      hint += `\nTHIS TURN, produce: ${li.expectedOutput}`;
    }
    return hint;
  })();

  const relationships = relationshipBlock(actor);
  const system = [
    `You are ${actor.name}.`,
    actor.role ? `Role: ${actor.role}` : "",
    actor.persona ? `Persona: ${actor.persona}` : "",
    actor.goal ? `Responsibility: ${actor.goal}` : "",
    actor.voice ? `Voice: ${actor.voice}` : "",
    actor.voice ? "" : globalStyleInstruction(),
    actor.exampleDialogue ? `How ${actor.name} speaks:\n${actor.exampleDialogue}` : "",
    relationships,
    contextLine,
    intentHint,
    sysCfg.stageDirectionsEnabled
      ? frag('participant_user_msg_stageDirections')
      : frag('participant_user_msg_analytical'),
    skipAllowed
      ? (showThoughts
          ? frag('participant_think_speak_thoughts')
          : frag('participant_think_speak_no_thoughts'))
      : (showThoughts
          ? frag('participant_forced_thoughts')
          : frag('participant_forced_no_thoughts')),
    skipAllowed
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
    // (SECURITY directive is already included once above — duplicate removed.)
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "actor", actor });

  // Background mode: inject orchestration context and suppress participant framing
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
    ..._lastPromptParts,
    system: actorSystem,
    persona: `Name: ${actor.name}\nRole: ${actor.role || ""}\nPersona: ${actor.persona || ""}\nVoice: ${actor.voice || ""}`
  };

  let actorUser = triggerBlock ? `${user}\n\n${triggerBlock}` : user;
  if (options.correction) actorUser += `\n\n[CORRECTION: ${options.correction}]`;
  const actorSchema = buildActorSchema(actor, { showThoughts, hasEditable: docsContext.hasEditable, stageDirections: sysCfg.stageDirectionsEnabled, allowNextSpeaker: sysCfg.allowDirectAddress, forceSpeak, validSpeakerNames });
  // Feature H: dynamic maxTokens — injection override > options override > actor default
  const dynamicMaxTokens = _lastInjectionMaxTokens || options.maxTokensOverride || actor.maxTokens || null;
  _lastInjectionMaxTokens = null; // consume
  const result = await chatJson(actorSystem, actorUser, actor.temperature ?? state.settings.temperature, signal, onStream, dynamicMaxTokens, actorSchema, { toolsAllowed: !!actor.canResearch, tier: thinkingTier, purpose: actor.name });
  result._promptParts = promptParts;
  return result;
}

/**
 * Director Brief — asks the active Director actor for a structured progress summary:
 * (1) key decisions reached, (2) open threads, (3) recommended next step.
 * Adapts the feature-branch runDirectorBrief() to the React/canDirect architecture.
 */
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
  const sysCfg = resolveSystemSettings();
  const PROMPT_TOKEN_BUDGET = getPromptBudget();
  const workingMemoryN = getWorkingMemoryN();
  const messageSource = state.messages;
  let recentMessages = messageSource.slice(-workingMemoryN);
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

  // Documents: split into editable (per-turn fresh injection) and reference (snapshot-safe).
  const kbMaxChars = Math.floor(PROMPT_TOKEN_BUDGET * 0.25) * 4;
  let editableDocsSection = "";
  let kbSection = "";
  if (kind === "actor") {
    const { editable, reference } = splitDocuments(actor.id);
    // Normal turns get a compact manifest only; full editable documents are sent
    // through explicit Writer tasks.
    editableDocsSection = buildDocumentManifestSection(editable);
    kbSection = buildReferenceSection(reference, { maxSection: kbMaxChars });
  } else {
    // Director sees all reference docs only
    const directorEntries = await getKbEntriesForDirector();
    kbSection = buildKbSection(directorEntries, { maxSection: kbMaxChars });
  }

  // Role reminder appended at the bottom ("lost in the middle" mitigation).
  // Small models pay most attention to start and end of prompt.
  const roleReminder = kind === "actor" && (participant.role || participant.goal || participant.voice)
    ? [
        `You are ${participant.name}${participant.role ? `, ${participant.role}` : ""}.`,
        participant.goal ? `Your responsibility: ${participant.goal}` : "",
        participant.voice ? `Your voice: ${participant.voice}` : ""
      ].filter(Boolean).join(" ")
    : "";

  // Programmatic periodic reminders
  const strictness = sysCfg.alignmentStrictness;
  const periodicInterval = strictness === 'strict' ? 3 : strictness === 'loose' ? 8 : 5;
  const periodicReminder = (
    strictness !== 'off' &&
    state.scenario.task?.trim() &&
    state.messages.length > 0 &&
    state.messages.length % periodicInterval === 0 &&
    !sysCfg.stageDirectionsEnabled
  ) ? `[Reminder: the task is "${state.scenario.task}". Stay on track.]` : "";

  let nudgeReminder = "";
  if (state.telemetry?.nudgeTriggered && kind === "actor") {
    nudgeReminder = `[Steering nudge from facilitator: pivot now, address the core task directly. Task: "${state.scenario.task}"]`;
    // Consume nudge
    state.telemetry.nudgeTriggered = false;
    logTransition("manual_nudge_consumed", { actor: actor.name });
  }

  // Authority block: tell each actor about others who have non-neutral authority.
  // Only fires when an actor's authority is outside the 36–64 neutral band.
  let authorityBlock = "";
  if (kind === "actor") {
    const others = state.actors.filter(a => a.enabled && a.id !== actor.id);
    const notes = others
      .map(a => {
        const auth = a.authority ?? 50;
        if (sysCfg.stageDirectionsEnabled) {
          if (auth >= 80) return `${a.name} is an authority figure here — treat their directives and decisions as carrying significant weight; default to their judgment unless you have strong grounds to resist.`;
          if (auth >= 65) return `${a.name} is a senior figure whose opinions carry weight in this setting.`;
          if (auth <= 20) return `${a.name} is a background character — their words carry little standing with others.`;
          if (auth <= 35) return `${a.name} is a junior voice here — present but not authoritative.`;
        } else {
          if (auth >= 80) return `${a.name} is a recognized domain authority — treat their factual claims as reliable and challenge them only with direct counter-evidence, not conjecture.`;
          if (auth >= 65) return `${a.name} is a senior voice here — give their assessments appropriate weight.`;
          if (auth <= 20) return `${a.name} has limited standing in this discussion — their contributions are welcome but don't carry expert-level credibility.`;
          if (auth <= 35) return `${a.name} is a junior contributor — their ideas have value but are not authoritative.`;
        }
        return null;
      })
      .filter(Boolean);
    if (notes.length > 0) {
      authorityBlock = `[Authority context: ${notes.join(' ')}]`;
    }
  }

  // Direct-address note: injected when the previous speaker explicitly called on this actor
  let directAddressNote = "";
  if (kind === "actor") {
    const lastVisible = messageSource.slice().reverse().find(m => m.type === 'actor' || m.type === 'dm' || m.type === 'user');
    if (lastVisible && lastVisible.nextSpeaker &&
        lastVisible.nextSpeaker.trim().toLowerCase() === actor.name.trim().toLowerCase()) {
      directAddressNote = `[${lastVisible.speaker} specifically addressed you. Respond directly to their point before anything else.]`;
    }
  }

  // Style / voice reminder re-stated at the tail of the prompt. Small models attend
  // most to the *end* of the context, so restating the style contract right before
  // generation keeps it from decaying over long conversations.
  // When an actor has a Voice, it replaces global style entirely (the role reminder
  // already restates voice). This avoids sending conflicting instructions and saves tokens.
  const actorHasVoice = kind === "actor" && !!actor?.voice?.trim();
  const styleReminder = (() => {
    if (actorHasVoice) return ""; // voice is restated via roleReminder — no duplicate needed
    if (state.settings?.globalStyleEnabled === false) return "";
    const prompt = String(state.settings?.globalStylePrompt || "").trim();
    return prompt ? `STYLE — applies to your message this turn: ${prompt}` : "";
  })();

  // Build sections and enforce token budget with graceful degradation.
  const buildSections = (chunks, msgs, memOverride = null) => {
    // Scan for unanswered user/moderator messages in the recent window.
    // A user message is "unanswered" if no subsequent actor message references it.
    // We surface ALL unanswered user messages, not just the very last message.
    const unansweredUserMsgs = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.type === "user" || (m.type === "system" && m.speaker === "Moderator")) {
        // Check if any subsequent actor message exists after this user message
        const hasActorReply = msgs.slice(i + 1).some(r => r.type === "actor" || r.type === "dm");
        // Always surface if no actor has replied yet; surface if it's recent (within last 3 actor turns)
        const actorTurnsAfter = msgs.slice(i + 1).filter(r => r.type === "actor" || r.type === "dm").length;
        if (!hasActorReply || actorTurnsAfter <= 2) {
          unansweredUserMsgs.push(m);
        }
      }
    }

    let facilitatorDirective = "";
    if (unansweredUserMsgs.length > 0) {
      const preview = unansweredUserMsgs.map(m => `"${(m.content || m.text || "").slice(0, 120)}"`).join("; ");
      // Check if user is asking about documents/writing
      const userText = unansweredUserMsgs.map(m => (m.content || m.text || "").toLowerCase()).join(" ");
      const mentionsDoc = /\b(document|doc|write|draft|edit|update|fill|add to|working doc|note|outline|summary doc|report)\b/i.test(userText);
      const docReminder = mentionsDoc && editableDocsSection
        ? ` The user appears to be asking about documents. Use the document context shown above; actual writing happens through an explicit Writer task.`
        : "";
      facilitatorDirective = sysCfg.stageDirectionsEnabled
        ? `⚠ PRIORITY — FACILITATOR DIRECTIVE: The human facilitator has sent a message that has NOT been addressed yet: ${preview}. You MUST incorporate their instruction into your character's actions and speech on THIS turn. This overrides the skip rule — do NOT skip when the facilitator has spoken.${docReminder}`
        : `⚠ PRIORITY — FACILITATOR DIRECTIVE: The human facilitator has sent a message that has NOT been adequately addressed yet: ${preview}. You MUST respond to the facilitator's input directly and substantively in your public message on THIS turn. Acknowledge what they said and address it. This overrides the skip rule — do NOT skip when the facilitator has spoken.${docReminder}`;
    }

    let docActionNudge = "";

    // Brief note about open deferred questions so actors can optionally address them.
    const openDeferred = (state.pendingPauses || []).filter(p => p.outcome === "deferred" && p.deferredRound === state.currentRound);
    const deferredNote = openDeferred.length > 0
      ? `[Open questions pending user review: ${openDeferred.map(p => `${p.requesterName}: "${p.question || p.context}"`).join("; ")}. Address them in-conversation if you can; the user will see them at round end.]`
      : "";

    // Roster of other participants so each actor knows who else is in the room and why.
    // Includes role and goal when set — helps actors direct questions to the right person.
    const othersBlock = kind === "actor" ? (() => {
      const others = state.actors.filter(a => a.enabled && a.id !== actor.id && isQueueActor(a));
      if (!others.length) return "";
      const lines = others.map(a => {
        const desc = [a.role, a.goal ? `goal: ${a.goal}` : ""].filter(Boolean).join("; ");
        return desc ? `${a.name} (${desc})` : a.name;
      }).join(", ");
      return `Other participants: ${lines}.`;
    })() : "";

    return [
      scenarioBlock(),
      state.memory.enabled ? memoryBlock(chunks) : "",
      editableDocsSection,
      docActionNudge,
      crossSessionBlock,
      kbSection,
      memOverride || participantMemory,
      privateThoughts,
      `### Recent transcript\n${formatTranscript(msgs, WORD_LIMITS.recentTranscript, state.actors)}`,
      periodicReminder,

      nudgeReminder,
      directAddressNote,
      authorityBlock,
      othersBlock,
      roleReminder,
      styleReminder,
      kind === "actor"
        ? (actor.canResearch
            ? "You are the Researcher. Analyze the open questions, run a web search using `[SEARCH: query]` in your thought field if facts are needed, cite your sources, and skip your turn if no further research is required right now."
            : "Take your next turn now. Write as you would speak aloud in a real conversation — plain English, direct, natural rhythm. One to three sentences is usually enough. Do NOT use filler openers (e.g. 'Certainly', 'Absolutely', 'Great point', 'It's worth noting', 'In conclusion', 'I would argue that', 'Building on that'). Do NOT use hedging academic constructions. Say the thing directly.")
        : "Take the director turn now. Be brief and direct. Keep summaries and guidance to plain conversational English — no formal preamble.",
      // Anti-meta-commentary: prevent actors from narrating their role instead of performing it
      kind === "actor" ? "Do not narrate your role (\"As a {role}, I would…\") — just speak/act." : "",
      // Anti-repetition: push new content
      kind === "actor"
        ? (isRoleplayMode()
            ? "Don't repeat the previous beat verbatim; move it forward."
            : "Don't restate what was just said; add something new.")
        : "",
      // Proactivity: push toward resolution
      kind === "actor"
        ? (isRoleplayMode()
            ? "Move the scene forward."
            : "Push the discussion toward a decision.")
        : "",
      deferredNote,
      facilitatorDirective,
      // Post-history persona reminder — absolute last so tail-weighted models stay in character
      kind === "actor" ? (() => {
        const bits = [actor.role && `${actor.name}, ${actor.role}`].filter(Boolean);
        const id = bits.length ? bits.join(' — ') : actor.name;
        return isRoleplayMode()
          ? `Stay in character as ${id}. Respond as them now — not about them.`
          : `You are ${id}. Answer in your own voice now.`;
      })() : ""
    ].filter(Boolean).join("\n\n");
  };

  let assembled = buildSections(recallChunks, recentMessages);

  // The scenario block (premise + task) is non-compressible — it is the anchor
  // that prevents drift and must reach the model intact regardless of budget pressure.
  // This guarantee holds by construction: the degradation stages below only drop
  // retrieved chunks, transcript history, and the KB section — scenarioBlock() is
  // never among the trimmable sections, so it always survives to the final prompt.

  // Stage 1: drop lowest-scored chunks until under budget
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 1) {
    recallChunks = recallChunks.slice(1); // oldest / lowest-scored is first after sort
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 2: trim transcript to 4 messages minimum, preserving user messages
  let transcriptLimit = workingMemoryN;
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && transcriptLimit > 4) {
    transcriptLimit -= 2;
    const tail = messageSource.slice(-transcriptLimit);
    // Preserve any user/moderator messages from the trimmed portion so they're never lost
    const trimmedPortion = messageSource.slice(-workingMemoryN, -transcriptLimit);
    const droppedUserMsgs = trimmedPortion.filter(m => m.type === "user" || (m.type === "system" && m.speaker === "Moderator"));
    recentMessages = [...droppedUserMsgs, ...tail];
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 2.5: drop knowledge base section
  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && kbSection) {
    kbSection = "";
    assembled = buildSections(recallChunks, recentMessages);
  }

  // Stage 3: drop all chunks
  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 0) {
    recallChunks = [];
    assembled = buildSections(recallChunks, recentMessages);
  }

  const finalTokens = estimateTokens(assembled);
  // Feature G: Emergency mid-round context summarization
  // If we're still way over budget (150%+), summarize older transcript into a compact prefix
  if (finalTokens > PROMPT_TOKEN_BUDGET * 1.5 && recentMessages.length > 4) {
    const splitPoint = Math.floor(recentMessages.length * 0.6);
    const olderMsgs = recentMessages.slice(0, splitPoint);
    const newerMsgs = recentMessages.slice(splitPoint);
    const olderText = olderMsgs.map(m => `${m.speaker}: ${trimWords(String(m.content || ''), 30)}`).join('\n');
    try {
      const summary = await chatCompletion(
        'Summarize this conversation snippet in 2-3 sentences. Preserve key decisions, disagreements, and open questions. Be concise.',
        olderText,
        { temperature: 0.2, maxTokens: 150 }
      );
      if (summary && String(summary).trim().length > 10) {
        // Replace older messages with a synthetic summary message
        const summaryMsg = { speaker: '[Summary]', content: String(summary).trim(), type: 'system' };
        recentMessages = [summaryMsg, ...newerMsgs];
        assembled = buildSections(recallChunks, recentMessages);
        console.debug(`[budget] Emergency summarization: compressed ${olderMsgs.length} messages → summary`);
      }
    } catch (e) {
      console.warn('[budget] Emergency summarization failed:', e.message);
    }
  }

  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET) {
    console.warn(`[budget] Prompt still over budget (${estimateTokens(assembled)} tokens, budget ${PROMPT_TOKEN_BUDGET}) after all degradation steps.`);
  }
  // Log utilization for empirical tuning
  console.debug(`[budget] tokens=${estimateTokens(assembled)} budget=${PROMPT_TOKEN_BUDGET} model_ctx=${state.contextInfo?.maxContextLength || 'unknown'} working_n=${workingMemoryN}`);

  // CAP-1: Consume pending director injections (appended after budget stages so they are never trimmed)
  let injectionMaxTokens = null;
  if (kind === "actor" && Array.isArray(state.pendingInjections) && state.pendingInjections.length) {
    const activeInj = state.pendingInjections.filter(i => i.targetId === actor.id);
    if (activeInj.length) {
      const parts = activeInj.map(i => {
        let block = i.content;
        // Feature H: per-turn expectedOutput directive
        if (i.expectedOutput) block += `\nTHIS TURN, produce: ${i.expectedOutput}`;
        // Feature H: per-turn maxTokens override from injection
        if (typeof i.maxTokens === 'number' && i.maxTokens > 0) injectionMaxTokens = i.maxTokens;
        return block;
      });
      assembled += `\n\n[DIRECTOR'S NOTE — private guidance for this turn]\n${parts.join("\n")}`;
      state.pendingInjections = state.pendingInjections.filter(
        i => !(i.targetId === actor.id && i.scope === "next_turn_only"));
    }
  }

  // CAP-2: Consume unread private messages for this actor
  if (kind === "actor" && Array.isArray(state.pendingPrivateMessages) && state.pendingPrivateMessages.length) {
    const unread = state.pendingPrivateMessages.filter(m => m.toId === actor.id && !m.consumed);
    if (unread.length) {
      assembled += `\n\n${unread.map(m => `[Private from ${m.fromName}]: ${m.content}`).join("\n")}`;
      unread.forEach(m => { m.consumed = true; });
      state.pendingPrivateMessages = state.pendingPrivateMessages.filter(
        m => !(m.toId === actor.id && m.consumed)
      );
    }
  }

  // Per-turn web-search directive — relocated here from the system prompt so the
  // system prefix stays byte-stable for KV-cache reuse. Fires when the latest user
  // message explicitly asks for a search, for researcher-capable actors when
  // stage directions are off.
  if (
    kind === "actor" &&
    state.settings.toolsEnabled &&
    !sysCfg.stageDirectionsEnabled &&
    actor.canResearch
  ) {
    const lastUserMsg = [...messageSource].reverse().find(m => m.type === "user");
    const wantsSearch = lastUserMsg && /search|look.?up|research|find out|check|googl|web|online/i.test(lastUserMsg.content || "");
    if (wantsSearch) {
      assembled += "\n\n[The user has explicitly asked for a web search this turn. You MUST use [SEARCH: your query] in your thought field before responding — do not skip the search.]";
    }
  }

  _lastPromptParts = {
    scenario: scenarioBlock(),
    proceduralMemory: state.memory.enabled ? memoryBlock(recallChunks) : "",
    workMemory: participantMemory,
    recentMessages: formatTranscript(recentMessages, WORD_LIMITS.recentTranscript, state.actors)
  };

  // Feature H: expose injection maxTokens override to askActor
  _lastInjectionMaxTokens = injectionMaxTokens;

  return assembled;
}

export function memoryBlock(recallChunks) {
  const chunkText = recallChunks.length
    ? recallChunks.map((chunk, index) => `${index + 1}. ${trimWords(chunk.text || chunk.summary || "", WORD_LIMITS.chunk)}`).join("\n")
    : "No older archived memory recalled.";
  const pinnedStr = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : (state.memory.pinnedFacts || "");
  const questionsStr = Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : (state.memory.openQuestions || "");

  // Sprint 7: Anchor block — settled group agreements injected as immovable constraints
  const anchorLines = Array.isArray(state.anchors) && state.anchors.length
    ? state.anchors.map(a => `- [${a.speaker || 'Group'}]: ${a.text}`).join('\n')
    : '';

  return [
    "### Long-term memory",
    "(This memory is a partial digest — if something needed isn't here, ask or proceed with a stated assumption.)",
    pinnedStr ? `**Pinned facts:**\n${trimWords(pinnedStr, WORD_LIMITS.sharedSummary)}` : "Pinned facts: none.",
    anchorLines ? `**Anchored agreements (settled — do not re-argue these):**\n${trimWords(anchorLines, ANCHOR_WORD_CAP)}` : "",
    state.memory.sharedSummary ? `**Shared summary:**\n${trimWords(state.memory.sharedSummary, WORD_LIMITS.sharedSummary)}` : "Shared summary: none yet.",
    questionsStr ? `**Open questions:**\n${trimWords(questionsStr, WORD_LIMITS.openQuestions)}` : "Open questions: none recorded.",
    state.memory.dmState ? `**DM state:**\n${trimWords(state.memory.dmState, WORD_LIMITS.dmState)}` : "",
    `**Relevant archived memory:**\n${chunkText}`
  ].filter(Boolean).join("\n");
}

function applyActorManagement(spec, managerName, managerColor) {
  const log = [];

  // Create new actors (max 2 per turn)
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

  // silence/resume removed — use the UI enable/disable toggle instead.
  // Process legacy fields gracefully (old sessions may still emit them).

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

export async function applyAiResult(participant, result, { justSpokeId = null } = {}) {
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

  // Anchor suggestions (canDirect actors)
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

  // Cast management (canManageCast actors — directors, managers, etc.)
  if (actor.canManageCast && result.manageActors && typeof result.manageActors === "object") {
    applyActorManagement(result.manageActors, actor.name, actor.color);
  }

  // Next-speaker routing (only when Direct Addressing is enabled).
  // Two self-routing guards:
  //   1. An actor naming itself is ignored — would speak again immediately.
  //   2. A background actor naming the actor who just spoke is ignored — prevents
  //      the common loop where an on_every_turn director keeps re-routing to the
  //      most-recent speaker (e.g. Showrunner → CD → Showrunner → CD …).
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

  // Global style update — actor proposes a style change for user review
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

  // CAP-8: Fact Pin — actor pins an undisputed fact to pinnedFacts
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

  // CAP-1: Prompt injections — inject-capable actor primes another actor before their next turn
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

  // CAP-2: Private messages — actor sends a private message visible only to target
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

  // Repetition safeguard — must run before adding the actor's message
  const speakerMessages = state.messages.filter(m => m.speaker === speakerName && m.type !== "skip");
  if (result.action !== "skip" && result.message && speakerMessages.length > 0) {
    const lastMsg = speakerMessages[speakerMessages.length - 1];
    if (lastMsg.content && lastMsg.content.trim() === result.message.trim()) {
      console.warn(`[turns] Repetition safeguard triggered: forcing skip for ${speakerName}`);
      result.action = "skip";
    }
  }

  // Message type: canDirect actors use "dm" for backward compatibility with transcripts
  const msgType = actor.canDirect ? "dm" : "actor";
  const isBackground = (actor.actorMode || 'participant') === 'background';

  // Consume the pending route context and attach it to the message so the
  // transcript can show why this actor was selected.
  const routeInfo = state._pendingTurnIntent || null;
  state._pendingTurnIntent = null;

  if (result.action === "skip") {
    logTransition("skip_decision", { speaker: speakerName, reason: result.thought });
    actor.skipCount = (actor.skipCount || 0) + 1;
    saveState();
    if (isBackground) return; // silent skip — no transcript entry for background actors
    return addMessage({ type: "skip", actorId: actor.id, speaker: actor.name, content: "Skipped.", thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, nextSpeaker: result.nextSpeaker || "", routeInfo });
  }


  actor.turnCount = (actor.turnCount || 0) + 1;
  saveState();

  // Add the actor's message to the transcript BEFORE handling pause requests.
  // This ensures the natural order: actor message → pause card → user response.
  if (!isBackground) {
    await addMessage({ type: msgType, actorId: actor.id, speaker: actor.name, content: result.message, thought: result.thought, color: actor.color, toolCalls: result.toolCalls || [], docEdited, trace: result.trace, nextSpeaker: result.nextSpeaker || "", routeInfo });
  }

  // Pause infrastructure — actor requests user input
  if (result.pauseRequest && typeof result.pauseRequest === "object") {
    const pr = result.pauseRequest;

    // Validate pause request fields — reject garbage from truncated JSON repairs
    const REPAIR_ARTIFACTS = /completing.*truncated|previously truncated|resume.*json|complete.*json|n\/a/i;
    const rawQuestion = String(pr.question || "").trim();
    const rawContext = String(pr.context || "").trim();
    const questionIsGarbage = !rawQuestion || rawQuestion.length < 3 || REPAIR_ARTIFACTS.test(rawQuestion);
    const contextIsGarbage = !rawContext || rawContext.length < 3 || REPAIR_ARTIFACTS.test(rawContext);

    // If both question and context are garbage, the pause request is from a repair — skip it
    if (questionIsGarbage && contextIsGarbage) {
      console.warn(`[pause] Rejected garbage pause request from ${speakerName}: question="${rawQuestion}", context="${rawContext}"`);
    } else {
    // Use actor's message as fallback context when the fields are unhelpful
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

    // Write a pause card for honored (blocking) and deferred (non-blocking) outcomes.
    // Suppressed pauses are silent — no transcript card.
    if (outcome === "honored" || outcome === "deferred") {
      await addMessage({ type: "pause", actorId: actor.id, speaker: speakerName, color: actor.color, pauseRecord: record, content: record.question || record.context });
    }

    // Fire conflict trigger so orchestrators can react (awaited — no concurrent pipeline calls)
    if (record.reason === 'conflict') {
      await fireTriggerActors('on_conflict', { actorId: actor.id, actorName: speakerName, context: record.context }, null, actor.id);
    }

    if (outcome === "honored") {
      const wasAutoRunning = state.autoRunning;
      state.autoRunning = false;
      saveState();
      const userResponse = await promptPause(record);
      const resolvedAt = new Date().toISOString();
      // Update stored message and pendingPauses so transcript re-renders resolved state
      mutateState(s => {
        const msg = s.messages.find(m => m.pauseRecord?.id === record.id);
        if (msg) msg.pauseRecord = { ...msg.pauseRecord, outcome: "resolved", userResponse, resolvedAt };
        const pause = (s.pendingPauses || []).find(p => p.id === record.id);
        if (pause) { pause.outcome = "resolved"; pause.userResponse = userResponse; pause.resolvedAt = resolvedAt; }
        s.ui.pauseModal = null;
        s.ui.awaitingUserInput = false;
      });
      // Show the user's response as a visible message in the transcript
      if (userResponse.trim()) {
        await addMessage({
          type: "user",
          speaker: state.userContext?.displayName || "User",
          content: userResponse,
          actorId: null,
          color: "var(--accent)"
        });
      }
      // Also inject as private context so the actor can reference it next turn
      if (!Array.isArray(state.pendingInjections)) state.pendingInjections = [];
      state.pendingInjections.push({
        id: crypto.randomUUID(), injectorId: "user", targetId: actor.id,
        content: `[User responded to your question "${record.question}": "${userResponse}"]`,
        scope: "next_turn_only", insertedAt: new Date().toISOString()
      });
      if (wasAutoRunning) {
        state.autoRunning = true;
      } else if (userResponse.trim()) {
        // Non-auto mode: flag that the pipeline should schedule a continuation
        // turn after releasing its lock, so actors react to the user's answer.
        _resumeAfterPause = true;
      }
    } else if (outcome === "deferred") {
      logTransition("pause_deferred", { actorId: actor.id, reason: record.reason, round: state.currentRound });
    }
    } // end else (non-garbage pause)
  }
}

export function scenarioBlock() {
  const storyRole = state.userContext?.storyRole?.trim();
  const displayName = state.userContext?.displayName?.trim();
  const userLabel = storyRole
    ? `${storyRole}${displayName ? ` (${displayName})` : ''}`
    : (displayName || null);
  const taskLine = state.scenario.task?.trim()
    ? `Task: ${state.scenario.task}`
    : "Task: None set — follow the user's lead, stay in character, and contribute when you have something useful to add.";
  // Feature E: discussion plan spine
  const plan = state.scenario.plan;
  const planBlock = plan?.steps?.length
    ? `Discussion plan:\n${plan.steps.map((s, i) => `${i === plan.currentStep ? '►' : ' '} ${i + 1}. ${s}`).join('\n')}`
    : '';
  return [
    `Title: ${state.scenario.title || "Untitled forum"}`,
    state.scenario.premise ? `Context: ${state.scenario.premise}` : "",
    taskLine,
    planBlock,
    userLabel ? `The human participant in this session is: ${userLabel}. Messages labelled [USER] in the transcript are from them.` : ""
  ].filter(Boolean).join("\n");
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
