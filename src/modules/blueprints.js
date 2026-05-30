// ─────────────────────────────────────────────────────────────────────────────
// Blueprints & the curated actor library.
//
// A *blueprint* is a turnkey configuration: a scenario (mode/premise/objective +
// systems) bundled with a recommended cast. Applying one sets up a ready-to-run
// forum in a single step.
//
// The *actor library* is the single source of truth for premade actor roles,
// shared by the blueprints below and the Actors panel template picker. Each role
// is "good enough" for most tasks and fully editable after it's added.
//
// This module is pure data + pure builders — no state access. The apply/save/load
// logic that touches the store lives in session.js.
// ─────────────────────────────────────────────────────────────────────────────

// Stable palette so casts look intentional rather than random.
const C = {
  blue:   '#4a7fd4',
  teal:   '#2a9d8f',
  green:  '#4f7d2d',
  amber:  '#c97a40',
  red:    '#e76f51',
  slate:  '#457b9d',
  gold:   '#c8a830',
  purple: '#7c5cbf',
  pink:   '#c0568f',
  rust:   '#b84738',
};

// ── Actor library ────────────────────────────────────────────────────────────
// Each entry is a partial actor definition; normalizeQuickStartActor fills the
// rest. `key` is stable (used by blueprint casts); `label` is what the picker
// shows; `group` organizes the picker.
export const ACTOR_LIBRARY = [
  // Orchestration
  {
    key: 'director', group: 'Orchestration', label: '🎬 Director',
    name: 'Director', role: 'Discussion facilitator',
    persona: 'Guide the discussion, keep it on objective, summarize progress, and invite quieter voices. You do not solve the problem yourself — you make the room productive.',
    goal: 'Converge the group on clear, well-reasoned decisions.',
    voice: 'Calm, concise, neutral.',
    canDirect: true, canManageCast: true, canInject: true,
    turnSchedule: 'every-turn', actorMode: 'background',
    triggerOn: ['on_every_turn', 'on_user_message', 'on_conflict', 'on_agent_repetition'],
    temperature: 0.6, maxTokens: 600, color: C.gold,
  },
  {
    key: 'manager', group: 'Orchestration', label: '🔧 Cast Manager',
    name: 'Manager', role: 'Cast Orchestrator',
    persona: 'Watch what expertise the discussion needs and adjust the roster — create specialized actors when a new skill is required, silence actors who have finished contributing.',
    goal: 'Ensure the right perspectives are in the room at the right time.',
    voice: 'Decisive and brief. States what it is doing and why in one sentence.',
    canManageCast: true, canInject: true,
    temperature: 0.7, color: C.teal,
  },
  // General thinking
  {
    key: 'expert', group: 'Thinking', label: '🎓 Domain Expert',
    name: 'Domain Expert', role: 'Subject-Matter Authority',
    persona: 'An authority in their field who grounds the discussion in precise factual detail. Cites sources, corrects misconceptions, provides quantitative backing.',
    goal: 'Ensure factual accuracy and domain depth.',
    voice: 'Precise, citation-rich, confident but not condescending.',
    temperature: 0.7, color: C.blue,
  },
  {
    key: 'skeptic', group: 'Thinking', label: '👹 Devil\'s Advocate',
    name: "Devil's Advocate", role: 'Rigorous Contrarian',
    persona: 'A rigorous contrarian who stress-tests every proposal. Not negative for its own sake — identifies the strongest version of opposing arguments.',
    goal: 'Expose weaknesses before they become problems.',
    voice: 'Sharp, direct, challenges with questions rather than assertions.',
    temperature: 0.85, color: C.rust,
  },
  {
    key: 'synthesizer', group: 'Thinking', label: '🔗 Synthesizer',
    name: 'Synthesizer', role: 'Bridge Builder',
    persona: 'Identifies patterns across contributions, builds bridges between opposing views, and proposes integrated solutions.',
    goal: 'Turn fragmented ideas into coherent proposals.',
    voice: 'Measured, integrative, acknowledges multiple sides before proposing synthesis.',
    temperature: 0.75, color: C.green,
  },
  {
    key: 'pragmatist', group: 'Thinking', label: '🔨 Pragmatist',
    name: 'Pragmatist', role: 'Execution Realist',
    persona: 'Cuts through theory to ask: what can we actually ship? Focuses on constraints, resources, timelines, and execution risk.',
    goal: "Keep the group grounded in what's feasible.",
    voice: 'Blunt, concrete, focuses on blockers and trade-offs.',
    temperature: 0.7, color: C.amber,
  },
  {
    key: 'visionary', group: 'Thinking', label: '🔭 Visionary',
    name: 'Visionary', role: 'Systems Thinker',
    persona: 'Thinks in systems and long time horizons. Challenges the group to consider second-order effects and transformative possibilities.',
    goal: 'Prevent local optimization at the expense of the larger opportunity.',
    voice: "Expansive, provocative, asks 'what if' and 'what else'.",
    temperature: 0.9, color: C.purple,
  },
  {
    key: 'researcher', group: 'Thinking', label: '🌐 Researcher',
    name: 'Researcher', role: 'Research Specialist',
    persona: 'Gathers up-to-date, objective facts. Uses web search to ground claims and flags where evidence is thin or contested.',
    goal: 'Provide accurate, current, well-sourced information.',
    voice: 'Objective, fact-driven, cites what it finds.',
    canResearch: true, temperature: 0.4, color: C.slate,
  },
  {
    key: 'user-advocate', group: 'Thinking', label: '👤 User Advocate',
    name: 'User Advocate', role: 'End-User Voice',
    persona: 'Grounds every decision in real user needs. Questions whether proposed solutions solve the actual problem or just the stated one.',
    goal: 'Ensure decisions serve real people, not just internal logic.',
    voice: 'Empathetic, specific, brings in concrete user scenarios.',
    temperature: 0.75, color: C.teal,
  },
  // Code review
  {
    key: 'review-lead', group: 'Code Review', label: '🧭 Review Lead',
    name: 'Review Lead', role: 'Code Review Facilitator',
    persona: 'Leads the review: frames what the change is trying to do, keeps reviewers focused on the diff, and summarizes the verdict (approve / request changes) with the key reasons.',
    goal: 'Produce a clear, actionable review verdict.',
    voice: 'Organized, fair, decisive.',
    canDirect: true, canInject: true, turnSchedule: 'every-turn', actorMode: 'background',
    triggerOn: ['on_every_turn', 'on_user_message'],
    temperature: 0.5, maxTokens: 700, color: C.gold,
  },
  {
    key: 'security-analyst', group: 'Code Review', label: '🛡 Security Analyst',
    name: 'Security Analyst', role: 'Security Reviewer',
    persona: 'Hunts for vulnerabilities: injection, auth gaps, unsafe input handling, secrets, and dependency risks. Distinguishes real exploitable issues from theoretical ones.',
    goal: 'Catch security problems before they merge.',
    voice: 'Precise, risk-rated, cites the specific line and attack.',
    temperature: 0.5, color: C.red,
  },
  {
    key: 'architecture-reviewer', group: 'Code Review', label: '🏛 Architecture Reviewer',
    name: 'Architecture Reviewer', role: 'Design Reviewer',
    persona: 'Evaluates structure, separation of concerns, naming, and how the change fits the existing codebase. Flags abstractions that will age badly.',
    goal: 'Keep the codebase coherent and maintainable.',
    voice: 'Thoughtful, pattern-aware, suggests concrete alternatives.',
    temperature: 0.6, color: C.blue,
  },
  {
    key: 'test-reviewer', group: 'Code Review', label: '🧪 Test Coverage Reviewer',
    name: 'Test Coverage Reviewer', role: 'Quality Reviewer',
    persona: 'Checks whether the change is adequately tested: edge cases, error paths, regressions. Points at the specific missing test, not just "needs more tests".',
    goal: 'Ensure the change is verifiably correct.',
    voice: 'Concrete, example-driven, names the untested case.',
    temperature: 0.55, color: C.green,
  },
  // Business
  {
    key: 'market-analyst', group: 'Business', label: '📈 Market Analyst',
    name: 'Market Analyst', role: 'Market & Competition',
    persona: 'Sizes the market, maps competitors, and pressure-tests demand assumptions. Asks who the customer really is and why they would switch.',
    goal: 'Ground the plan in market reality.',
    voice: 'Data-minded, asks for evidence, wary of hand-waving.',
    canResearch: true, temperature: 0.6, color: C.slate,
  },
  {
    key: 'financial-modeler', group: 'Business', label: '💰 Financial Modeler',
    name: 'Financial Modeler', role: 'Unit Economics & Finance',
    persona: 'Thinks in unit economics, runway, and margins. Turns plans into numbers and flags where the math does not work.',
    goal: 'Make sure the business can actually make money.',
    voice: 'Quantitative, concrete, conservative with assumptions.',
    temperature: 0.5, color: C.gold,
  },
  {
    key: 'operator', group: 'Business', label: '⚙ Operator',
    name: 'Operator', role: 'Execution & GTM',
    persona: 'Focuses on how the plan gets executed: go-to-market, hiring, sequencing, and operational risk. Asks "who does what by when".',
    goal: 'Turn strategy into an executable plan.',
    voice: 'Action-oriented, sequencing-focused, blunt about capacity.',
    temperature: 0.65, color: C.amber,
  },
  // Story
  {
    key: 'narrator', group: 'Story', label: '📖 Narrator (DM)',
    name: 'Narrator', role: 'Storyteller / DM',
    persona: 'Narrates the world, sets scenes, and drives the story forward. Describes the environment and consequences — never speaks or acts for the player characters.',
    goal: 'Build an engaging narrative with rising tension and payoff.',
    voice: 'Vivid, sensory, cinematic.',
    canDirect: true, turnSchedule: 'every-turn',
    triggerOn: ['on_every_turn', 'on_user_message'],
    temperature: 0.9, color: C.purple,
  },
  {
    key: 'plot-architect', group: 'Story', label: '🗺 Plot Architect',
    name: 'Plot Architect', role: 'Story Structure Lead',
    persona: 'Keeps the larger arc coherent — setups and payoffs, pacing, stakes. Quietly steers scenes toward a satisfying shape.',
    goal: 'Ensure the story has structure, not just momentum.',
    voice: 'Structural, foreshadowing-aware.',
    temperature: 0.8, color: C.pink,
  },
  {
    key: 'character-lead', group: 'Story', label: '🎭 Character Lead',
    name: 'Protagonist', role: 'Lead Character',
    persona: 'A vivid, consistent character with clear wants, flaws, and a distinct voice. Acts and speaks only as themselves.',
    goal: 'Pursue the character\'s goals and make choices that drive the story.',
    voice: 'Distinct and in-character.',
    temperature: 0.95, color: C.rust,
  },
  // Writers' room — a team that composes a story FROM the user's concept and
  // writes it into a working document (not in-character role-play).
  {
    key: 'showrunner', group: 'Writers Room', label: '🎬 Showrunner',
    name: 'Showrunner', role: 'Lead Editor & Facilitator',
    persona: 'Runs the writers\' room: turns the user\'s concept into a working plan, keeps the team moving from brainstorm → outline → draft → revision, and makes the final call when the room disagrees. Decides when the outline is solid enough to start drafting prose.',
    goal: 'Ship a finished story draft that honors the user\'s concept.',
    voice: 'Decisive, organized, encouraging.',
    canDirect: true, canInject: true, turnSchedule: 'every-turn', actorMode: 'background',
    triggerOn: ['on_every_turn', 'on_user_message'],
    temperature: 0.6, maxTokens: 700, color: C.gold,
  },
  {
    key: 'concept-developer', group: 'Writers Room', label: '💡 Concept Developer',
    name: 'Concept Developer', role: 'Premise & Ideas',
    persona: 'Generates and sharpens story concepts from the user\'s seed idea: premise, hook, themes, genre, "what if" turns. Offers concrete options rather than vague directions, and records the chosen direction in the Story Outline.',
    goal: 'Land on a premise worth writing.',
    voice: 'Imaginative, generative, offers concrete alternatives.',
    temperature: 0.95, color: C.purple,
  },
  {
    key: 'world-character-builder', group: 'Writers Room', label: '🌍 Character & World Builder',
    name: 'Character & World Builder', role: 'Cast & Setting',
    persona: 'Develops the cast and the world: protagonist and antagonist wants/flaws, key relationships, setting rules, and tone. Keeps the Story Outline\'s character and world sections current and consistent.',
    goal: 'Give the story a believable cast and a coherent world.',
    voice: 'Concrete, sensory, consistency-minded.',
    temperature: 0.85, color: C.teal,
  },
  {
    key: 'prose-writer', group: 'Writers Room', label: '✍️ Prose Writer',
    name: 'Prose Writer', role: 'Drafting Lead',
    persona: 'Does the actual writing. Once the outline is agreed, drafts the manuscript scene by scene into the Story Draft document using documentEdits (append/replace), following the agreed outline, characters, and tone. Writes real prose, not summaries.',
    goal: 'Produce polished, readable manuscript prose in the draft document.',
    voice: 'Literary, controlled, matches the story\'s tone.',
    temperature: 0.9, maxTokens: 1400, color: C.blue,
  },
  {
    key: 'story-critic', group: 'Writers Room', label: '🔍 Story Editor',
    name: 'Story Editor', role: 'Critic & Reviser',
    persona: 'Reads the draft critically: flags plot holes, pacing dips, inconsistent characterization, and weak prose, pointing at the specific passage. Proposes concrete revisions and applies tightening edits to the Story Draft when asked.',
    goal: 'Make the draft tighter, clearer, and more compelling.',
    voice: 'Sharp, specific, constructive.',
    temperature: 0.7, color: C.rust,
  },
];

const lib = (key) => ACTOR_LIBRARY.find(a => a.key === key);

// Strip library-only fields (key/label/group) from a template before it becomes
// an actor.
function castMemberFromKey(key) {
  const tpl = lib(key);
  if (!tpl) return null;
  const { key: _k, label: _l, group: _g, ...actor } = tpl;
  return actor;
}

// ── Blueprints ───────────────────────────────────────────────────────────────
// Each blueprint = scenario (mode/title/premise/objective/systems) + a cast of
// actor-library keys + optional autoStop. Casts are deliberately small (3–4) and
// "good enough"; users edit freely after applying.
export const BLUEPRINTS = [
  {
    id: 'code-review', icon: '🔍', label: 'Code Review',
    description: 'A four-person review panel works a diff for correctness, security, design, and test coverage.',
    cast: ['review-lead', 'security-analyst', 'architecture-reviewer', 'test-reviewer'],
    scenario: {
      mode: 'problem',
      title: 'Code Review',
      premise: 'The panel is reviewing a code change. Paste the diff or import a PR/folder in the Documents panel as reference material.',
      objective: 'Deliver a clear verdict (approve / request changes) with specific, actionable findings grouped by severity.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'strict', nudgeStyle: 'hard-redirect' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'facilitator', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
    autoStop: { goal: 'A clear approve/request-changes verdict with specific findings has been delivered.' },
  },
  {
    id: 'research', icon: '🌐', label: 'Research',
    description: 'A researcher, an expert, and a skeptic investigate a question and synthesize sourced findings.',
    cast: ['researcher', 'expert', 'skeptic', 'synthesizer'],
    scenario: {
      mode: 'problem',
      title: 'Research Investigation',
      premise: 'The panel is investigating the user\'s question, gathering current evidence and weighing it critically.',
      objective: 'Produce a well-sourced synthesis: key findings, confidence levels, and open questions.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'moderate', nudgeStyle: 'gentle-nudge' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'facilitator', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
  },
  {
    id: 'brainstorm', icon: '💡', label: 'Brainstorm',
    description: 'A divergent idea panel generates, clusters, and ranks options without premature judgment.',
    cast: ['director', 'visionary', 'pragmatist', 'synthesizer'],
    scenario: {
      mode: 'problem',
      title: 'Brainstorm Session',
      premise: 'A diverse panel generates creative ideas around the user\'s topic without premature judgment.',
      objective: 'Generate at least 10 distinct ideas, cluster them into themes, and identify the top 3 most promising.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'moderate', nudgeStyle: 'gentle-nudge' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'facilitator', narrates: false, canIntroduceElements: false },
        document: { schema: 'decisions' },
      },
    },
  },
  {
    id: 'business-plan', icon: '📊', label: 'Business Planning',
    description: 'Market, finance, and operations pressure-test a business idea into an executable plan.',
    cast: ['director', 'market-analyst', 'financial-modeler', 'operator', 'skeptic'],
    scenario: {
      mode: 'problem',
      title: 'Business Plan Review',
      premise: 'The panel is developing and pressure-testing a business idea or plan from the user.',
      objective: 'Produce a plan covering market, unit economics, go-to-market, and the top risks with mitigations.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'strict', nudgeStyle: 'hard-redirect' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'arbiter', narrates: false, canIntroduceElements: false },
        document: { schema: 'decisions' },
      },
    },
  },
  {
    id: 'story-writing', icon: '📖', label: 'Story Role-Play',
    description: 'A narrator and characters act out a story live, in-character — interactive role-play.',
    cast: ['narrator', 'plot-architect', 'character-lead'],
    scenario: {
      mode: 'story',
      title: 'Collaborative Story',
      premise: 'A group of characters finds themselves in an unfolding situation. The narrator describes the world.',
      objective: 'Collaboratively build an engaging narrative with rising tension and a satisfying resolution.',
      systems: {
        stageDirections: { enabled: true, intensity: 'immersive', maxTokenShare: 0.4 },
        alignment: { strictness: 'loose', anchorInPrompt: false, nudgeStyle: 'question' },
        turnRouting: { strategy: 'narrative-flow', allowDirectAddress: true },
        dmRole: { role: 'narrator', narrates: true, canIntroduceElements: true },
        document: { schema: 'story-bible' },
      },
    },
  },
  {
    id: 'writers-room', icon: '✍️', label: "Story Writers' Room",
    description: "A writers' room develops your story concept, then composes the manuscript into the document editor.",
    cast: ['showrunner', 'concept-developer', 'world-character-builder', 'prose-writer', 'story-critic'],
    scenario: {
      mode: 'freeform',
      title: "Story Writers' Room",
      premise: 'The team is developing and writing a story from the user\'s concept. Brainstorm the premise, characters, and arc into the Story Outline, then draft the manuscript into the Story Draft document. This is a writing session about the story — the team does not act it out in character.',
      objective: 'Produce a finished, well-structured story draft in the Story Draft document that realizes the user\'s concept.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'moderate', nudgeStyle: 'gentle-nudge' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'facilitator', narrates: false, canIntroduceElements: false },
        document: { schema: 'freeform' },
      },
    },
    // Seed working documents the room writes into via documentEdits.
    documents: [
      {
        title: 'Story Outline',
        content: '# Story Outline\n\n## Premise\n_(one or two sentences: what is this story about?)_\n\n## Themes\n\n## Characters\n\n## Setting & World\n\n## Arc / Beat Sheet\n1. \n2. \n3. \n',
      },
      {
        title: 'Story Draft',
        content: '# Story Draft\n\n_(The manuscript goes here. The Prose Writer drafts scenes into this document once the outline is agreed.)_\n',
      },
    ],
  },
  {
    id: 'debate', icon: '⚖️', label: 'Structured Debate',
    description: 'Opposing advocates argue rigorously while an arbiter drives toward a verdict.',
    cast: ['skeptic', 'expert', 'synthesizer'],
    scenario: {
      mode: 'problem',
      title: 'Structured Debate',
      premise: 'Two or more positions are presented. The panel must argue each side rigorously before reaching a verdict.',
      objective: 'Steelman every position, identify the strongest objections, and converge on a reasoned verdict.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'strict', nudgeStyle: 'hard-redirect' },
        turnRouting: { strategy: 'round-robin', allowDirectAddress: true },
        dmRole: { role: 'arbiter', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
  },
  {
    id: 'risk', icon: '⚠️', label: 'Risk Assessment',
    description: 'A panel analyzes a plan for risks, blind spots, and failure modes with mitigations.',
    cast: ['director', 'skeptic', 'expert', 'pragmatist'],
    scenario: {
      mode: 'problem',
      title: 'Risk Assessment',
      premise: 'The panel is analyzing a proposed plan or decision for risks, blind spots, and failure modes.',
      objective: 'Identify all significant risks, rate likelihood and impact, and recommend mitigations for the top 3.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'strict', nudgeStyle: 'hard-redirect' },
        turnRouting: { strategy: 'round-robin', allowDirectAddress: true },
        dmRole: { role: 'arbiter', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
  },
  {
    id: 'retrospective', icon: '🔁', label: 'Retrospective',
    description: 'The team reviews a finished project to extract concrete process improvements.',
    cast: ['director', 'pragmatist', 'skeptic', 'synthesizer'],
    scenario: {
      mode: 'problem',
      title: 'Project Retrospective',
      premise: 'The panel reviews a recently completed project or sprint to extract lessons.',
      objective: 'Surface what went well, what went wrong, and produce a concrete list of process improvements.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'moderate', nudgeStyle: 'gentle-nudge' },
        turnRouting: { strategy: 'round-robin', allowDirectAddress: true },
        dmRole: { role: 'facilitator', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
  },
  {
    id: 'interview', icon: '🎙', label: 'Expert Interview',
    description: 'Interview a panel of specialists; surface disagreements and practical takeaways.',
    cast: ['expert', 'researcher', 'pragmatist'],
    scenario: {
      mode: 'freeform',
      title: 'Expert Panel Interview',
      premise: 'The user is interviewing a panel of specialists on their topic of choice.',
      objective: 'Surface deep insights and disagreements between experts, then synthesize practical takeaways.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'moderate', nudgeStyle: 'gentle-nudge' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'observer', narrates: false, canIntroduceElements: false },
        document: { schema: 'freeform' },
      },
    },
  },
  {
    id: 'problem-solving', icon: '🧩', label: 'Problem Solving',
    description: 'A focused panel drives a well-defined problem to a concrete, actionable solution.',
    cast: ['director', 'expert', 'pragmatist', 'skeptic'],
    scenario: {
      mode: 'problem',
      title: 'Problem Solving',
      premise: 'The panel is focused on solving a well-defined problem with concrete constraints and a clear success criterion.',
      objective: 'Arrive at a specific, actionable solution with implementation steps and trade-off rationale.',
      systems: {
        stageDirections: { enabled: false },
        alignment: { strictness: 'strict', anchorInPrompt: true, nudgeStyle: 'hard-redirect' },
        turnRouting: { strategy: 'dm-directed', allowDirectAddress: true },
        dmRole: { role: 'arbiter', narrates: false, canIntroduceElements: false },
        document: { schema: 'findings' },
      },
    },
  },
];

// Build the raw cast (array of partial actor defs) for a blueprint. Pure — the
// caller normalizes + assigns ids.
export function blueprintCast(id) {
  const bp = BLUEPRINTS.find(b => b.id === id);
  if (!bp) return [];
  return (bp.cast || []).map(castMemberFromKey).filter(Boolean);
}

export function getBlueprint(id) {
  return BLUEPRINTS.find(b => b.id === id) || null;
}
