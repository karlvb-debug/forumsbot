import { state } from '../state.js';
import { chatStructured } from '../api.js';
import { showBackgroundActivity, updateBackgroundActivity, hideBackgroundActivity } from '../streamingStore.js';
import { trimWords } from '../utils.js';
import { frag } from '../../prompts/index.js';

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
    try {
      const esc = escapeRegex(name);
      // Word boundary after the name so "@Al" can't match "@Alex".
      if (new RegExp(`@${esc}\\b`).test(lower)) return actor;
      // Bare-name patterns false-positive on short or common-word names
      // ("Al", "So"), so require at least 3 characters for these.
      if (name.length < 3) continue;
      // Name at message start or after sentence-end punctuation, followed by comma/colon/question
      if (new RegExp(`(?:^|[.!?]\\s+)${esc}[,?!:]`).test(lower)) return actor;
      // Explicit second-person cues: "you think, Name", "right, Name?", "thoughts, Name"
      if (new RegExp(`(?:you think|thoughts|right|agree)[,?\\s]+${esc}\\b`).test(lower)) return actor;
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

  // Dominance window: turns per speaker over the last 12 visible messages,
  // so a chatty actor pays a growing penalty instead of re-entering as soon
  // as it drops out of the 3-message recency window.
  const dominanceWindow = state.messages
    .filter(m => m.type === 'actor' || m.type === 'dm')
    .slice(-12);
  const turnShare = new Map();
  for (const m of dominanceWindow) {
    turnShare.set(m.speaker, (turnShare.get(m.speaker) || 0) + 1);
  }

  return candidates
    .filter(a => !alreadySpokeThisRound.has(a.id))
    .map(actor => {
      let score = 0;
      const name = actor.name.toLowerCase();
      if (lastContent.includes(name) && actor.name !== lastSpeaker) score += 3;
      if (!alreadySpokeThisRound.has(actor.id)) score += 1;
      if (recentSpeakers.includes(actor.name)) score -= 2;
      if (actor.name === lastSpeaker) score -= 3;
      score -= Math.min(3, Math.floor((turnShare.get(actor.name) || 0) / 2));
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
    const scored = scoreCandidates(available, alreadySpokeThisRound);
    return scored[0]?.actor || null;
  }
}

const INTENT_NEEDS = ['deepen', 'challenge', 'synthesize', 'broaden', 'redirect', 'decide', 'conclude'];

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    read: { type: 'string' },
    need: { type: 'string', enum: INTENT_NEEDS },
    speaker: { type: 'string' },
    nextSpeakers: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    confidence: { type: 'number' },
    stuck: { type: 'boolean' },
    expectedOutput: { type: 'string' }
  },
  required: ['need', 'speaker'],
  additionalProperties: false
};

const INTENT_SHAPE = 'Return JSON only: {"read":"<one sentence on the current state>","need":"<one need>","speaker":"<participant name or NONE>","nextSpeakers":["<optional: up to two participants to follow, in order>"],"rationale":"<one clause: why them>","confidence":<0..1>,"expectedOutput":"<optional turn directive>"}';
function getIntentSystem() { return frag('intent_system') + '\n' + INTENT_SHAPE; }

async function resolveIntent(eligible, alreadySpokeThisRound, signal, allCandidates = null) {
  const available = eligible.filter(a => !alreadySpokeThisRound.has(a.id));
  if (!available.length) return null;

  // Show full roster (including spoke actors) so the model can make informed choices,
  // e.g. 'deepen' can re-select the strongest contributor even if they already spoke.
  const rosterActors = allCandidates || available;

  const activityId = showBackgroundActivity(
    'Director is reading the room',
    'Deciding what the discussion needs next…',
    'var(--accent)'
  );
  try {
    const sc = state.scenario || {};
    const mem = state.memory || {};

    // Count recent turns per actor so the model can balance participation
    const recentTurns = new Map();
    state.messages.slice(-20).forEach(m => {
      if (m.type !== 'skip' && m.type !== 'management') {
        const a = rosterActors.find(r => r.name === m.speaker);
        if (a) recentTurns.set(a.id, (recentTurns.get(a.id) || 0) + 1);
      }
    });

    const roster = rosterActors.map(a => {
      const spokeFlag = alreadySpokeThisRound.has(a.id) ? ' [spoke this round]' : '';
      const turns = recentTurns.get(a.id) || 0;
      const turnsLabel = turns > 0 ? ` [${turns} recent]` : ' [silent]';
      const aim = trimWords(String(a.goal || a.role || 'participant'), 14);
      return `- ${a.name} (${a.role || 'participant'}) — ${aim}${spokeFlag}${turnsLabel}`;
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

    // Only trust the cached progress while doneWhen is still set — clearing the
    // criteria mid-session orphans the cache until the next judge pass.
    const g = sc.doneWhen?.trim() ? state.discussion?.goal : null;
    const progressLine = g?.progressPct > 0
      ? `Progress: ~${g.progressPct}% — ${
          g.verdict === 'blocked' ? `BLOCKED: ${g.verdictReason}` : g.verdictReason
        }`
      : '';

    const goalBlock = [
      sc.task ? `Task: ${sc.task}` : '',
      sc.doneWhen ? `Done when: ${sc.doneWhen}` : '',
      progressLine,
      mem.sharedSummary ? `Where things stand: ${trimWords(String(mem.sharedSummary), 60)}` : '',
      openQ.length ? `Open questions: ${openQ.join('; ')}` : ''
    ].filter(Boolean).join('\n');

    const routingBias = (() => {
      if (!g) return '';
      if (g.progressPct >= 80) return "[Close to completion — favour 'decide' or 'conclude' unless a genuine unmet criterion remains]";
      if (g.verdict === 'blocked' && (g.blockedRounds || 0) >= 1) {
        return "[Discussion is stuck — favour 'redirect' or 'challenge' to break the deadlock]";
      }
      return '';
    })();

    const user = [
      routingBias,
      goalBlock,
      goalBlock ? '' : null,
      `Participants:\n${roster}`,
      '',
      `Recent discussion:\n${recent || '(nothing said yet)'}`,
      '',
      'What does the discussion need next, and who is best placed to provide it?'
    ].filter(v => v !== null && v !== '').join('\n');

    const validNames = rosterActors.map(a => a.name);
    let data;
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const userMsg = correction ? `${user}\n\n${correction}` : user;
        // 'think' tier (main chat model), not 'reason': routing a speaker is a
        // small classification task, and the reason tier can route to a heavy
        // dedicated reasoning model — measured at ~9s per pass on ~41% of
        // turns. The enum schema + corrective retry keep small models reliable.
        data = await chatStructured(getIntentSystem(), userMsg, INTENT_SCHEMA, {
          temperature: 0.2, maxTokens: 160, signal, tier: 'think', purpose: 'intentPass'
        });
      } catch (err) {
        console.warn('[resolver] intent pass failed, using fallback:', err.message);
        return null;
      }

      const name = String(data?.speaker || '').trim();
      const isNone = !name || name.toUpperCase() === 'NONE';
      const matched = isNone ? null : rosterActors.find(a => a.name.toLowerCase() === name.toLowerCase());
      if (isNone || matched) break;
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

    // For 'deepen', allow re-selecting an actor who already spoke this round
    const lookupPool = need === 'deepen' ? rosterActors : available;
    const matched = lookupPool.find(a => a.name.toLowerCase() === speakerName.toLowerCase());
    // Mini-plan: queue valid follow-up speakers at the front of the turn
    // queue so the next resolveNextSpeaker calls take the free 'handoff'
    // path instead of re-running this (LLM) pass for every turn.
    const followUps = Array.isArray(data?.nextSpeakers)
      ? data.nextSpeakers
          .map(n => available.find(a => a.name.toLowerCase() === String(n).trim().toLowerCase()))
          .filter((a, i, arr) => a && a.id !== matched?.id && arr.findIndex(x => x?.id === a.id) === i)
          .slice(0, 2)
      : [];
    if (matched && followUps.length) {
      const ids = followUps.map(a => a.id);
      state.turnQueue = [...ids, ...state.turnQueue.filter(id => !ids.includes(id))];
      state.lastIntent.plannedNext = followUps.map(a => a.name);
    }

    updateBackgroundActivity(activityId, {
      detail: matched
        ? `Needs to ${need || 'continue'} → ${matched.name}${followUps.length ? ` (then ${followUps.map(a => a.name).join(', ')})` : ''}`
        : `Suggested ${speakerName} (not in roster).`
    });
    return { actor: matched || null, conclude: false, data: state.lastIntent };
  } finally {
    hideBackgroundActivity(activityId);
  }
}

export async function resolveNextSpeaker(candidates, { signal, alreadySpokeThisRound = new Set() } = {}) {
  if (!candidates.length) return null;
  const eligible = candidates.filter(a => !alreadySpokeThisRound.has(a.id));
  if (!eligible.length) return null;
  if (eligible.length === 1) return { actor: eligible[0], reason: 'only-one' };

  const mentionTarget = state.ui?.mentionTarget;
  if (mentionTarget) {
    state.ui.mentionTarget = null;
    const target = eligible.find(a => a.id === mentionTarget);
    if (target) return { actor: target, reason: 'mention' };
  }

  const lastMsg = state.messages
    .filter(m => m.type !== 'skip' && m.type !== 'management')
    .slice(-1)[0];
  if (lastMsg?.content) {
    const addressed = detectAddressedActor(lastMsg.content, eligible, lastMsg.speaker);
    if (addressed) return { actor: addressed, reason: 'addressed' };
  }

  if (state.turnQueue.length) {
    const handoffId = state.turnQueue[0];
    const handoff = eligible.find(a => a.id === handoffId);
    if (handoff) {
      state.turnQueue.shift();
      return { actor: handoff, reason: 'handoff' };
    }
  }

  const intentMode = state.settings?.intentPass || 'auto';

  if (intentMode === 'always') {
    const intent = await resolveIntent(eligible, alreadySpokeThisRound, signal, candidates);
    if (intent) {
      if (intent.actor) return { actor: intent.actor, reason: 'intent', intent: intent.data };
      if (intent.conclude) return null;
    }
  }

  const scored = scoreCandidates(eligible, alreadySpokeThisRound);
  const top = scored[0];
  const second = scored[1];
  if (top && (!second || top.score - second.score >= 2)) {
    return { actor: top.actor, reason: 'score' };
  }

  if (eligible.length > 1 && top) {
    if (intentMode === 'off') {
      const routed = await tinyRouter(eligible, alreadySpokeThisRound, signal);
      if (routed === null) return null;
      if (routed) return { actor: routed, reason: 'router' };
    } else if (intentMode === 'auto') {
      const intent = await resolveIntent(eligible, alreadySpokeThisRound, signal, candidates);
      if (intent) {
        if (intent.actor) return { actor: intent.actor, reason: 'intent', intent: intent.data };
        if (intent.conclude) return null;
      }
    }
  }

  if (top) return { actor: top.actor, reason: 'recency' };

  return null;
}

export { resolverCandidates };
