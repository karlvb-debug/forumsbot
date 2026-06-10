/**
 * turns/config.js — stateless config helpers, pure formatters, and message/queue utilities.
 * No pipeline state, no streaming, no prompt assembly.
 */
import { RECENT_MESSAGE_LIMIT } from '../constants.js';
import { state, saveState } from '../state.js';
import { chatStructured } from '../api.js';
import { cleanStoredMessage, normalizeSpeakingOrderStrategy, isQueueActor } from '../utils.js';
import { putMessage } from '../db.js';

// ── System settings ──────────────────────────────────────────────────────────

export function resolveSystemSettings() {
  const sys = state.scenario?.systems || {};
  return {
    stageDirectionsEnabled:   sys.stageDirections?.enabled            ?? false,
    stageDirectionsIntensity: sys.stageDirections?.intensity           ?? 'moderate',
    stageDirectionsMaxShare:  sys.stageDirections?.maxTokenShare       ?? 0.2,
    alignmentStrictness:      sys.alignment?.strictness               ?? 'moderate',
    turnStrategy:             normalizeSpeakingOrderStrategy(sys.turnRouting?.strategy),
    allowDirectAddress:       sys.turnRouting?.allowDirectAddress     ?? true,
    dmRole: (() => {
      const director = state.actors?.find(a => a.canDirect && a.enabled);
      return director?.directorMode || sys.dmRole?.role || 'facilitator';
    })(),
    get dmNarrates() { return this.dmRole === 'narrator'; },
  };
}

export function isRoleplayMode() {
  return !!state.scenario?.systems?.stageDirections?.enabled;
}

export function hasTask() {
  return !!String(state.scenario?.task || '').trim();
}

export function resolveActorThinkingTier(actor) {
  const t = actor?.thinkingTier;
  if (t === 'fast' || t === 'think' || t === 'reason') return t;
  if (actor?.canDirect || actor?.canWriteDocuments) return 'reason';
  if (state.scenario?.systems?.stageDirections?.enabled) return 'fast';
  return 'think';
}

export function globalStyleInstruction() {
  if (state.settings?.globalStyleEnabled === false) return "";
  const prompt = String(state.settings?.globalStylePrompt || "").trim();
  return prompt ? `GLOBAL STYLE: ${prompt}` : "";
}

export function validateActorOutput(result) {
  const msg = String(result?.message || '').trim();
  if (result?.action === 'skip') return null;
  if (!msg) return 'empty';
  if (msg.length < 2) return 'too_short';
  if (/^(certainly|sure|okay|as an ai)\b/i.test(msg) && msg.length < 25) return 'filler_only';
  return null;
}

// ── Pause policy ─────────────────────────────────────────────────────────────

const PAUSE_POLICY_DEFAULTS = {
  sponsor:      { allowedReasons: ["decision", "conflict"], maxPausesPerRound: 1, deferMode: true },
  collaborator: { allowedReasons: ["decision", "conflict", "question", "clarification", "information"], maxPausesPerRound: 2, deferMode: true },
  observer:     { allowedReasons: [], maxPausesPerRound: 0, deferMode: true },
};

export function resolvePolicy(userContext) {
  const base = PAUSE_POLICY_DEFAULTS[userContext?.interactionMode] || PAUSE_POLICY_DEFAULTS.collaborator;
  return { ...base, ...(userContext?.pausePolicy || {}) };
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Planning ──────────────────────────────────────────────────────────────────

const PLAN_SCHEMA = {
  type: 'object',
  properties: { steps: { type: 'array', items: { type: 'string' } } },
  required: ['steps'],
  additionalProperties: false
};

export async function generateDiscussionPlan(signal) {
  const task = String(state.scenario?.task || '').trim();
  if (!task) return null;
  const actors = state.actors.filter(a => a.enabled).map(a => `${a.name} (${a.role})`).join(', ');
  const doneWhen = String(state.scenario?.doneWhen || '').trim();
  const system = 'You are a discussion planner. Given a task, completion criteria, and cast, produce a short ordered plan of 3-5 steps that efficiently leads to completion. Each step is one sentence describing what the group should produce or decide — not just "discuss X". The final step must be the concrete action that satisfies the "Done when" criteria. Return JSON only.';
  const user = `Task: ${task}\nDone when: ${doneWhen || 'not specified'}\nParticipants: ${actors}\n\nProduce 3-5 discussion steps. The final step must describe the concrete action that satisfies the "Done when" criteria.`;
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

// ── Message / queue helpers ───────────────────────────────────────────────────

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

export function participantCycleCount() {
  return Math.max(1, state.actors.filter(a => a.enabled && isQueueActor(a)).length);
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
  if (missing.length) state.turnQueue.push(...missing);

  if (!state.turnQueue.length) buildTurnQueue();

  const mentionTarget = state.ui?.mentionTarget;
  if (mentionTarget) {
    state.ui.mentionTarget = null;
    const target = state.actors.find(a => a.enabled && a.id === mentionTarget);
    if (target) {
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
