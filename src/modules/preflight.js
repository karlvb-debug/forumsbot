import { state, logTransition } from './state.js';
import { chatCompletion } from './api.js';
import { trimWords } from './utils.js';

/**
 * Preflight Skip Router.
 *
 * Runs a compact (~50-token) LLM call to classify whether `actor` is likely
 * to skip this turn. The classifier returns a skip recommendation plus its
 * `confidence` in that recommendation (1.0 = certain, 0.0 = a guess). We honour
 * the skip only when the model recommends skipping AND is confident enough —
 * i.e. confidence >= `preflightThreshold` — so a confident "skip" is acted on
 * while a low-confidence one falls through to a full generation.
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
export async function preflightSkipCheck(actor, messages, scenario, opts = {}) {
  const { directlyAddressed = false, speakingMap = {}, actorCount = 1 } = opts;

  // Passthrough: router disabled or not enough context
  if (!state.settings.enablePreflightRouter) {
    return { shouldSkip: false, confidence: 1.0, reason: 'router disabled' };
  }
  if (!actor || actor.canDirect) {
    return { shouldSkip: false, confidence: 1.0, reason: 'director exempt' };
  }
  if (!messages || messages.length < 2) {
    return { shouldSkip: false, confidence: 1.0, reason: 'too early to route' };
  }

  // Directly addressed actors always speak — skip preflight entirely
  if (directlyAddressed) {
    return { shouldSkip: false, confidence: 1.0, reason: 'directly addressed' };
  }

  // Base threshold is the minimum confidence required to honour a skip.
  // It is adjusted by speaking-time share vs fair share:
  //   Over-represented actors (talked too much) get a LOWER bar → skip more easily.
  //   Under-represented actors get a HIGHER bar → harder to skip (keep them in).
  let threshold = state.settings.preflightThreshold ?? 0.35;
  if (actorCount > 1) {
    const totalWords = Object.values(speakingMap).reduce((a, b) => a + b, 0);
    if (totalWords > 0) {
      const actorWords = speakingMap[actor.id] || 0;
      const share = actorWords / totalWords;
      const fairShare = 1 / actorCount;
      // Scale factor: ~±0.15 at ±20% deviation from fair share. Subtracting means
      // over-represented actors (share > fairShare) get a lower confidence bar.
      const adjustment = (share - fairShare) * 0.75;
      threshold = Math.max(0.10, Math.min(0.65, threshold - adjustment));
    }
  }

  // Build a stripped-down context: last 3 messages + objective + actor name
  const recentLines = messages
    .slice(-3)
    .filter(m => m.type === 'actor' || m.type === 'dm' || m.type === 'user' || (m.type === 'system' && m.speaker === 'Moderator'))
    .map(m => `${m.speaker}: ${trimWords(m.content, 40)}`)
    .join('\n');

  // Find this actor's most recent message to detect repetition
  const lastActorMsg = [...messages].reverse().find(m => m.speaker === actor.name && m.type === 'actor');
  const lastActorLine = lastActorMsg ? trimWords(lastActorMsg.content, 50) : '';

  const system = [
    'You classify whether an AI discussion participant has something NEW and USEFUL to add right now.',
    'Answer with a single JSON object: {"skip":true|false,"confidence":0.0-1.0,"reason":"brief reason"}',
    'skip=true means the participant should yield the floor this turn.',
    'confidence = how certain you are about this recommendation (1.0 = completely certain, 0.0 = a pure guess). A confident skip should report a HIGH confidence.',
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
    logTransition('preflight_check', {
      actor: actor.name,
      shouldSkip: parsed.shouldSkip,
      confidence: parsed.confidence,
      reason: parsed.reason
    });

    // Apply threshold: only honour the skip if the model is confident enough in it.
    if (parsed.shouldSkip && parsed.confidence >= threshold) {
      logTransition('preflight_skip', {
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
      // Default when the model omits a number: a bare skip is treated as
      // reasonably confident (0.7) so it clears the default threshold (0.35),
      // preserving the "skip when the model says skip" behaviour.
      const confidence = Math.min(1, Math.max(0, Number(obj.confidence ?? (shouldSkip ? 0.7 : 0.8))));
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
    return { shouldSkip: true, confidence: 0.7, reason: text.slice(0, 80) };
  }
  // Default to speak (shouldSkip=false) for ambiguous text, "yes", "speak", etc.
  return { shouldSkip: false, confidence: 0.8, reason: text.slice(0, 80) };
}
