import { WORD_LIMITS, ANCHOR_WORD_CAP } from '../constants.js';
import { state, logTransition } from '../state.js';
import { chatCompletion } from '../api.js';
import { recallRelevantChunks } from '../memory.js';
import { trimWords, isQueueActor, estimateTokens, formatTranscript } from '../utils.js';
import { getActorMemory } from '../db.js';
import { getKbEntriesForDirector, splitDocuments, buildDocumentManifestSection, buildReferenceSection, buildKbSection } from '../knowledge.js';
import { resolveSystemSettings } from './config.js';

let _lastPromptParts = null;
let _lastInjectionMaxTokens = null;

export function getLastPromptParts() { return _lastPromptParts; }

export function setLastPromptParts(parts) {
  _lastPromptParts = parts;
}

export function getAndConsumeInjectionMaxTokens() {
  const val = _lastInjectionMaxTokens;
  _lastInjectionMaxTokens = null;
  return val;
}

function getPromptBudget() {
  const max = state.contextInfo?.maxContextLength;
  if (!max || max < 4000) return Math.floor((max || 4000) * 0.50);
  if (max < 8000) return 3800;
  const logMax  = Math.log(max);
  const log8k   = Math.log(8_000);
  const log128k = Math.log(128_000);
  const t = Math.min(1, (logMax - log8k) / (log128k - log8k));
  const pct = 0.55 + (0.70 - 0.55) * t;
  return Math.floor(max * pct);
}

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

  let crossSessionBlock = "";
  if (kind === "actor" && state.settings.enableCrossSessionMemory !== false) {
    const csm = await getActorMemory(actor.name);
    if (csm) {
      crossSessionBlock = `### Cross-Session Memory (${actor.name})\n${trimWords(csm, 200)}`;
    }
  }

  const kbMaxChars = Math.floor(PROMPT_TOKEN_BUDGET * 0.25) * 4;
  let editableDocsSection = "";
  let kbSection = "";
  if (kind === "actor") {
    const { editable, reference } = splitDocuments(actor.id);
    editableDocsSection = buildDocumentManifestSection(editable);
    kbSection = buildReferenceSection(reference, { maxSection: kbMaxChars });
  } else {
    const directorEntries = await getKbEntriesForDirector();
    kbSection = buildKbSection(directorEntries, { maxSection: kbMaxChars });
  }

  const roleReminder = kind === "actor" && (participant.role || participant.goal || participant.voice)
    ? [
        `You are ${participant.name}${participant.role ? `, ${participant.role}` : ""}.`,
        participant.goal ? `Your responsibility: ${participant.goal}` : "",
        participant.voice ? `Your voice: ${participant.voice}` : ""
      ].filter(Boolean).join(" ")
    : "";

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
    state.telemetry.nudgeTriggered = false;
    logTransition("manual_nudge_consumed", { actor: actor.name });
  }

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

  let directAddressNote = "";
  if (kind === "actor") {
    const lastVisible = messageSource.slice().reverse().find(m => m.type === 'actor' || m.type === 'dm' || m.type === 'user');
    if (lastVisible && lastVisible.nextSpeaker &&
        lastVisible.nextSpeaker.trim().toLowerCase() === actor.name.trim().toLowerCase()) {
      directAddressNote = `[${lastVisible.speaker} specifically addressed you. Respond directly to their point before anything else.]`;
    }
  }

  const actorHasVoice = kind === "actor" && !!actor?.voice?.trim();
  const styleReminder = (() => {
    if (actorHasVoice) return "";
    if (state.settings?.globalStyleEnabled === false) return "";
    const prompt = String(state.settings?.globalStylePrompt || "").trim();
    return prompt ? `STYLE — applies to your message this turn: ${prompt}` : "";
  })();

  const buildSections = (chunks, msgs, memOverride = null) => {
    const unansweredUserMsgs = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.type === "user" || (m.type === "system" && m.speaker === "Moderator")) {
        const hasActorReply = msgs.slice(i + 1).some(r => r.type === "actor" || r.type === "dm");
        const actorTurnsAfter = msgs.slice(i + 1).filter(r => r.type === "actor" || r.type === "dm").length;
        if (!hasActorReply || actorTurnsAfter <= 2) {
          unansweredUserMsgs.push(m);
        }
      }
    }

    let facilitatorDirective = "";
    if (unansweredUserMsgs.length > 0) {
      const preview = unansweredUserMsgs.map(m => `"${(m.content || m.text || "").slice(0, 120)}"`).join("; ");
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

    const openDeferred = (state.pendingPauses || []).filter(p => p.outcome === "deferred" && p.deferredRound === state.currentRound);
    const deferredNote = openDeferred.length > 0
      ? `[Open questions pending user review: ${openDeferred.map(p => `${p.requesterName}: "${p.question || p.context}"`).join("; ")}. Address them in-conversation if you can; the user will see them at round end.]`
      : "";

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
      kind === "actor" ? "Do not narrate your role (\"As a {role}, I would…\") — just speak/act." : "",
      kind === "actor"
        ? (isRoleplayMode()
            ? "Don't repeat the previous beat verbatim; move it forward."
            : "Don't restate what was just said; add something new.")
        : "",
      kind === "actor"
        ? (isRoleplayMode()
            ? "Move the scene forward."
            : "Push the discussion toward a decision.")
        : "",
      deferredNote,
      facilitatorDirective,
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

  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 1) {
    recallChunks = recallChunks.slice(1);
    assembled = buildSections(recallChunks, recentMessages);
  }

  let transcriptLimit = workingMemoryN;
  while (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && transcriptLimit > 4) {
    transcriptLimit -= 2;
    const tail = messageSource.slice(-transcriptLimit);
    const trimmedPortion = messageSource.slice(-workingMemoryN, -transcriptLimit);
    const droppedUserMsgs = trimmedPortion.filter(m => m.type === "user" || (m.type === "system" && m.speaker === "Moderator"));
    recentMessages = [...droppedUserMsgs, ...tail];
    assembled = buildSections(recallChunks, recentMessages);
  }

  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && kbSection) {
    kbSection = "";
    assembled = buildSections(recallChunks, recentMessages);
  }

  if (estimateTokens(assembled) > PROMPT_TOKEN_BUDGET && recallChunks.length > 0) {
    recallChunks = [];
    assembled = buildSections(recallChunks, recentMessages);
  }

  const finalTokens = estimateTokens(assembled);
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
  console.debug(`[budget] tokens=${estimateTokens(assembled)} budget=${PROMPT_TOKEN_BUDGET} model_ctx=${state.contextInfo?.maxContextLength || 'unknown'} working_n=${workingMemoryN}`);

  let injectionMaxTokens = null;
  if (kind === "actor" && Array.isArray(state.pendingInjections) && state.pendingInjections.length) {
    const activeInj = state.pendingInjections.filter(i => i.targetId === actor.id);
    if (activeInj.length) {
      const parts = activeInj.map(i => {
        let block = i.content;
        if (i.expectedOutput) block += `\nTHIS TURN, produce: ${i.expectedOutput}`;
        if (typeof i.maxTokens === 'number' && i.maxTokens > 0) injectionMaxTokens = i.maxTokens;
        return block;
      });
      assembled += `\n\n[DIRECTOR'S NOTE — private guidance for this turn]\n${parts.join("\n")}`;
      state.pendingInjections = state.pendingInjections.filter(
        i => !(i.targetId === actor.id && i.scope === "next_turn_only"));
    }
  }

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

  _lastInjectionMaxTokens = injectionMaxTokens;

  return assembled;
}

export function memoryBlock(recallChunks) {
  const chunkText = recallChunks.length
    ? recallChunks.map((chunk, index) => `${index + 1}. ${trimWords(chunk.text || chunk.summary || "", WORD_LIMITS.chunk)}`).join("\n")
    : "No older archived memory recalled.";
  const pinnedStr = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : (state.memory.pinnedFacts || "");
  const questionsStr = Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : (state.memory.openQuestions || "");

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

export function scenarioBlock() {
  const storyRole = state.userContext?.storyRole?.trim();
  const displayName = state.userContext?.displayName?.trim();
  const userLabel = storyRole
    ? `${storyRole}${displayName ? ` (${displayName})` : ''}`
    : (displayName || null);
  const taskLine = state.scenario.task?.trim()
    ? `Task: ${state.scenario.task}`
    : "Task: None set — follow the user's lead, stay in character, and contribute when you have something useful to add.";
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

export function relationshipBlock(actor) {
  const entries = Object.entries(actor.relationships || {});
  if (!entries.length) return "";
  const lines = entries.map(([name, note]) => `- ${name}: ${note}`).join("\n");
  return `Your current read on the other participants:\n${lines}`;
}

function isRoleplayMode() {
  return !!state.scenario?.systems?.stageDirections?.enabled;
}
