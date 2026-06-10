/**
 * turns/actorPrompt.js — capability-composed system-prompt assembly for actor
 * turns. Replaces the four near-duplicate prompt branches that previously
 * lived inline in askActor (pipeline.js).
 *
 * Design:
 *  - An actor has ONE base role (director > manager > researcher >
 *    participant, by precedence) that sets the framing fragments.
 *  - Capabilities beyond the base role contribute additive fragments instead
 *    of being silently shadowed (e.g. a Manager who canResearch now actually
 *    receives the research instructions and tool access).
 *  - Cross-role concerns (background-mode decorator, schema prompt line,
 *    roster section) are built once, here.
 *
 * The system prompt for a given actor + settings must stay byte-stable across
 * turns — per-turn content belongs in the user message (see pipeline.js).
 * Snapshot tests in pipeline.integration.test.js pin each role's output.
 */
import { state } from '../state.js';
import { isJsonSchemaSupported } from '../api.js';
import { isQueueActor } from '../utils.js';
import { buildActorSchema, buildSchemaPromptLine } from '../schemas.js';
import { buildNarrativeDmInstruction, buildRoleplayContextLine, buildRoleplayStyleBlock } from '../storyMode.js';
import { frag } from '../../prompts/index.js';
import { getMcpTools, BUILT_IN_TOOL_NAMES } from '../tools.js';
import { globalStyleInstruction } from './config.js';
import { relationshipBlock } from './prompt.js';

export function primaryRole(actor) {
  if (actor.canDirect) return 'director';
  if (actor.canManageCast) return 'manager';
  if (actor.canResearch) return 'researcher';
  return 'participant';
}

// Previously copy-pasted four times in pipeline.js.
function backgroundPrefix(actor, nextActor) {
  if ((actor.actorMode || 'participant') !== 'background') return '';
  const nextLabel = nextActor
    ? `The next scheduled actor is: **${nextActor.name}** (${nextActor.role || 'participant'}).`
    : 'No next actor determined yet.';
  return `BACKGROUND MODE: Your response will NOT appear in the transcript. Only your promptInjections, manageActors, nextSpeaker, and privateMessages fields take effect. Omit or leave "message" blank.\n${nextLabel}\n\n`;
}

function rosterSection(role, sysCfg) {
  if (role === 'director') {
    const label = sysCfg.stageDirectionsEnabled ? 'Current cast' : 'Current actor roster';
    const lines = state.actors
      .map(a => `- ${a.name} (${a.role || (sysCfg.stageDirectionsEnabled ? 'Character' : 'Participant')})${a.enabled ? '' : (sysCfg.stageDirectionsEnabled ? ' [offstage]' : ' [disabled]')}`)
      .join('\n');
    return `### ${label}\n${lines}`;
  }
  if (role === 'manager') {
    const lines = state.actors
      .map(a => `- ${a.name} (${a.role || 'Participant'})${a.enabled ? '' : ' [disabled]'}`)
      .join('\n');
    return `### Current actor roster\n${lines}`;
  }
  return '';
}

function directorSections(actor, ctx) {
  const { sysCfg, showThoughts, forceSpeak, schemaLine, researcherToolsEnabled } = ctx;
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

  return [
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
    schemaLine,
    'The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.',
    "",
    researcherToolsEnabled
      ? frag('director_web_tools', {
          thoughtField: showThoughts ? 'thought field' : 'JSON thought field',
          researchSuffix: showThoughts ? ', so you can synthesize and resolve discrepancies with fresh ground truth' : '',
          searchExample: showThoughts
            ? '{"thought":"I should look up the latest specs. [SEARCH: latest local LLM benchmarks 2026]","action":"speak","message":""}'
            : '{"thought":"[SEARCH: latest local LLM benchmarks 2026]","action":"speak","message":""}'
        })
      : "",
    ...mcpToolsSections(ctx)
  ];
}

function managerSections(actor, ctx) {
  const { showThoughts, forceSpeak, schemaLine } = ctx;
  return [
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
    schemaLine,
    'All manageActors sub-arrays are optional — omit any you don\'t need. The JSON is transport only; put natural dialogue only inside message.',
    (!showThoughts) ? frag('thoughts_disabled') : "",
    // Composition: a manager who can research previously lost all research
    // instructions to role shadowing. Append the tool fragments additively.
    ...(actor.canResearch ? managerResearchSections(ctx) : []),
    ...mcpToolsSections(ctx),
    frag('security_transcript')
  ];
}

function managerResearchSections(ctx) {
  const { showThoughts, researcherToolsEnabled } = ctx;
  if (!researcherToolsEnabled) return [];
  return [
    frag('researcher_mandatory_tools'),
    showThoughts
      ? frag('researcher_tool_instruction_thoughts')
      : frag('researcher_tool_instruction_no_thoughts'),
  ];
}

// The actor's GRANTED MCP tools (computed in buildTurnPlan), rendered as
// additive instructions for any role — participants included. Sorted,
// single-line descriptions — the section must stay byte-stable across turns
// (grants and the available list only change between sessions/reconnects),
// per the prefix-stability contract above.
function mcpToolsSections(ctx) {
  const tools = (ctx.mcpTools || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!tools.length) return [];
  const lines = tools.map((t) => {
    const desc = String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return `- \`[TOOL: ${t.name} {...}]\`${desc ? ` — ${desc}` : ''}`;
  });
  return [
    frag('mcp_tools_available'),
    ...lines,
    frag('mcp_tools_example', { toolName: tools[0].name }),
  ];
}

function researcherSections(actor, ctx) {
  const { showThoughts, forceSpeak, schemaLine, researcherToolsEnabled } = ctx;
  return [
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
    ...mcpToolsSections(ctx),
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
    schemaLine,
    'The JSON is transport only. Put natural public dialogue/briefs only inside message; do not make message itself JSON.',
    frag('researcher_user_msg'),
    frag('security_directive')
  ];
}

function participantSections(actor, ctx) {
  const { sysCfg, showThoughts, skipAllowed, schemaLine, researcherToolsEnabled } = ctx;
  const contextLine = sysCfg.stageDirectionsEnabled
    ? buildRoleplayContextLine(showThoughts, state.actors.some(a => a.canDirect && a.enabled))
    : frag('participant_context_analytical');

  return [
    `You are ${actor.name}.`,
    actor.role ? `Role: ${actor.role}` : "",
    actor.persona ? `Persona: ${actor.persona}` : "",
    actor.goal ? `Responsibility: ${actor.goal}` : "",
    actor.voice ? `Voice: ${actor.voice}` : "",
    actor.voice ? "" : globalStyleInstruction(),
    actor.exampleDialogue ? `How ${actor.name} speaks:\n${actor.exampleDialogue}` : "",
    "LENGTH: Match response length to the turn. Reactions, questions, and redirects: 2–3 sentences. Proposals, analysis, and synthesis: as long as needed, no padding.",
    relationshipBlock(actor),
    contextLine,
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
    schemaLine,
    sysCfg.stageDirectionsEnabled
      ? 'The JSON is transport only. ' + frag('participant_markdown_stageDirections')
      : 'The JSON is transport only. ' + frag('participant_markdown_analytical'),
    (state.userContext?.interactionMode !== "observer")
      ? 'All of the above fields are part of a single JSON object. You may also add optional fields like "pauseRequest", "pinFact", "anchor", etc. alongside the required fields in that same object. ' + frag('participant_handoff')
      : "",
    frag('security_directive'),
    "",
    researcherToolsEnabled
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
    })(),
    ...mcpToolsSections(ctx)
  ];
}

const ROLE_BUILDERS = {
  director: directorSections,
  manager: managerSections,
  researcher: researcherSections,
  participant: participantSections,
};

/**
 * Build the complete turn plan for an actor: system prompt, output schema,
 * tool access, roster section, and token budget — everything askActor needs
 * besides the (per-turn) user context.
 */
export function buildTurnPlan(actor, { sysCfg, showThoughts, forceSpeak, skipAllowed, tierModel, nextActor = null } = {}) {
  const role = primaryRole(actor);
  const stageDir = sysCfg.stageDirectionsEnabled;
  // Built-in web tools are governed by canResearch (legacy boolean, drives the
  // researcher fragments); MCP tools come solely from the actor's grant list,
  // intersected with what the proxy actually has connected right now.
  const toolsAllowed = !!actor.canResearch && state.settings.toolsEnabled && !stageDir;
  const grantSet = new Set(Array.isArray(actor.toolGrants) ? actor.toolGrants : []);
  const grantedMcpTools = (grantSet.size && state.settings.toolsEnabled && !stageDir)
    ? getMcpTools().filter((t) => grantSet.has(t.name))
    : [];
  const grantedTools = [
    ...(toolsAllowed ? BUILT_IN_TOOL_NAMES : []),
    ...grantedMcpTools.map((t) => t.name),
  ];
  const validSpeakerNames = state.actors
    .filter(a => a.enabled && a.id !== actor.id && isQueueActor(a))
    .map(a => a.name);
  const schemaOptions = {
    showThoughts,
    hasEditable: false,
    stageDirections: stageDir,
    allowNextSpeaker: sysCfg.allowDirectAddress,
    forceSpeak,
    validSpeakerNames,
  };
  const schemaLine = buildSchemaPromptLine(actor, { ...schemaOptions, schemaActive: isJsonSchemaSupported(tierModel) });

  const ctx = {
    sysCfg,
    showThoughts,
    forceSpeak,
    skipAllowed,
    schemaLine,
    researcherToolsEnabled: toolsAllowed,
    mcpTools: grantedMcpTools,
  };
  const system = backgroundPrefix(actor, nextActor)
    + ROLE_BUILDERS[role](actor, ctx).filter(Boolean).join("\n");

  return {
    role,
    system,
    schema: buildActorSchema(actor, schemaOptions),
    toolsAllowed,
    // Full executable-tool allowlist for this actor's turn — built-ins (via
    // canResearch) plus granted MCP tools. askActor passes this to chatJson
    // so execution matches what the prompt advertised.
    grantedTools,
    rosterSection: rosterSection(role, sysCfg),
    includePrivateThoughts: role === 'director' && !!actor.canSeeThoughts,
    baseMaxTokens: (role === 'director' || role === 'manager')
      ? (actor.maxTokens || 1200)
      : (actor.maxTokens || null),
  };
}
