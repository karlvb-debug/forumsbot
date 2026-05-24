import { state, logTransition } from './state.js';
import { chatCompletion } from './api.js';
import { trimWords } from './utils.js';

/**
 * Preflight Skip Router.
 *
 * Runs a compact (~50-token) LLM call to classify whether `actor` is likely
 * to skip this turn. If the classifier predicts skip (confidence below
 * `preflightThreshold`), returns { shouldSkip: true } without doing a full
 * generation.
 *
 * Falls through immediately (shouldSkip: false) when:
 *   - enablePreflightRouter is false
 *   - actor is the DM / Director
 *   - fewer than 2 messages exist (nothing to route yet)
 *   - classifier call fails for any reason
 *
 * @param {object} actor        – the actor object from state.actors
 * @param {object[]} messages   – recent messages array (already sliced)
 * @param {object} scenario     – state.scenario
 * @returns {Promise<{ shouldSkip: boolean, confidence: number, reason: string }>}
 */
export async function preflightSkipCheck(actor, messages, scenario) {
  // Passthrough: router disabled or not enough context
  if (!state.settings.enablePreflightRouter) {
    return { shouldSkip: false, confidence: 1.0, reason: 'router disabled' };
  }
  if (!actor || actor.isDirector) {
    return { shouldSkip: false, confidence: 1.0, reason: 'director exempt' };
  }
  if (!messages || messages.length < 2) {
    return { shouldSkip: false, confidence: 1.0, reason: 'too early to route' };
  }

  const threshold = state.settings.preflightThreshold ?? 0.35;

  // Build a stripped-down context: last 3 messages + objective + actor name
  const recentLines = messages
    .slice(-3)
    .filter(m => m.type === 'actor' || m.type === 'dm' || m.type === 'user')
    .map(m => `${m.speaker}: ${trimWords(m.content, 40)}`)
    .join('\n');

  // Find this actor's most recent message to detect repetition
  const lastActorMsg = [...messages].reverse().find(m => m.speaker === actor.name && m.type === 'actor');
  const lastActorLine = lastActorMsg ? trimWords(lastActorMsg.content, 50) : '';

  const system = [
    'You classify whether an AI discussion participant has something NEW and USEFUL to add right now.',
    'Answer with a single JSON object: {"skip":true|false,"confidence":0.0-1.0,"reason":"brief reason"}',
    'skip=true means the participant should yield the floor this turn.',
    'Critically: if the participant\'s last message already covered the same point they would make now, skip=true.',
    'Be concise. Do not add any text outside the JSON.'
  ].join('\n');

  const user = [
    `Participant: ${actor.name} (${actor.role || 'Participant'})`,
    `Objective: ${trimWords(scenario?.objective || '', 30)}`,
    lastActorLine ? `${actor.name}'s last message: "${lastActorLine}"` : '',
    `Recent conversation:\n${recentLines}`,
    `Does ${actor.name} have something NEW and DIFFERENT to contribute — not a restatement of their last message?`
  ].filter(Boolean).join('\n\n');

  try {
    const raw = await chatCompletion(system, user, {
      temperature: 0.1,
      maxTokens: 60,
      signal: null  // preflight runs outside the main abort controller
    });

    const parsed = parsePreflightResponse(raw);

    // Log the decision regardless of outcome
    logTransition('preflight_check', null, null, {
      actor: actor.name,
      shouldSkip: parsed.shouldSkip,
      confidence: parsed.confidence,
      reason: parsed.reason
    });

    // Apply threshold: only skip if model confidence is below threshold
    if (parsed.shouldSkip && parsed.confidence <= threshold) {
      logTransition('preflight_skip', null, null, {
        actor: actor.name,
        confidence: parsed.confidence,
        reason: parsed.reason
      });
      return { shouldSkip: true, confidence: parsed.confidence, reason: parsed.reason };
    }

    return { shouldSkip: false, confidence: parsed.confidence, reason: parsed.reason };
  } catch (err) {
    // Never block a turn due to preflight failure — fail open
    console.warn('[preflight] Classifier call failed, passing through:', err.message);
    return { shouldSkip: false, confidence: 1.0, reason: `preflight error: ${err.message}` };
  }
}

/**
 * Parse the classifier response. Handles:
 *   - JSON: {"skip": true, "confidence": 0.2, "reason": "..."}
 *   - Plain text: "yes", "no", "skip", "speak"
 */
export function parsePreflightResponse(raw) {
  const text = (raw || '').trim();

  // Try JSON first
  try {
    // Strip code fences if present
    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    const obj = JSON.parse(cleaned);
    if (typeof obj === 'object' && obj !== null) {
      const skipVal = obj.skip ?? obj.should_skip ?? obj.shouldSkip;
      const shouldSkip = skipVal === true || String(skipVal).toLowerCase() === 'true';
      const confidence = Math.min(1, Math.max(0, Number(obj.confidence ?? (shouldSkip ? 0.2 : 0.8))));
      const reason = String(obj.reason || obj.message || '').slice(0, 120);
      return { shouldSkip, confidence, reason };
    }
  } catch {
    // fall through to plain-text parse
  }

  // Plain-text fallback: look for skip/no keywords meaning "skip", or yes/speak meaning "contribute"
  const lower = text.toLowerCase();
  const isSkip = lower.startsWith('skip') || lower.startsWith('no') || lower.includes('"skip":true');
  if (isSkip) {
    return { shouldSkip: true, confidence: 0.2, reason: text.slice(0, 80) };
  }
  // Default to speak (shouldSkip=false) for ambiguous text, "yes", "speak", etc.
  return { shouldSkip: false, confidence: 0.8, reason: text.slice(0, 80) };
}
