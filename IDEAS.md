# Ideas & TODO

Running backlog of things worth doing, ranked roughly by impact within each
section. Each entry: one-line bottom-line, key files, rough size.

**Status legend:** `[ ]` idea / `[~]` in progress / `[x]` done / `[-]` decided
against. Add a date when status changes.

---

## Thinking & models

- [x] **Three-mode thinking system (fast / think / reason).** (2026-06) Fully
  landed. Engine: `fast` (no thought — roleplay actors, tinyRouter, fact
  distill), `think` (JSON thought, default participants), `reason` (director,
  intent pass, goal judge, memory summary, document writer; routes to
  `settings.reasoningModel` when set). Native `<think>…</think>` /
  `reasoning_content` stripped from all completion paths and routed to thought
  slot. `resolveModelTier`, `extractNativeThinking`, `resolveActorThinkingTier`.
  UI: Connection panel `Reasoning model` selector, actor card `Thinking` chip
  (auto/fast/think/reason). API call logs now carry `tier` + `purpose` fields
  for diagnostics. Tested (223 tests). Remaining future: `reasoning_effort`
  passthrough; live `<think>` streaming during generation.
- [ ] **Per-actor `model` override.** `actor.thinkingTier` (reason→reasoning
  model) now exists; a full per-actor `model` slot (mirroring
  `actor.temperature`/`actor.maxTokens`) is still open — thread `model` into the
  `chatJson` options at the askActor call sites (the API already accepts it).
  Files: `state.js`, `constants.js`, `ActorsPanel.jsx`, `turns.js`. Size: small.
- [ ] **Try Qwen3-Embedding-0.6B as drop-in vs Nomic v1.5.** Empirical A/B on
  real session archives for fact dedup + chunk recall. No code change yet —
  just a measurement. Size: small.

## Orchestration & scheduling

- [~] **Two-step intent pass + speaker scoring.** (2026-06) Director-side
  variant landed: `resolveIntent` in `turns.js` is a grounded reasoning pass
  (reads the room against task / doneWhen / open questions / shared summary →
  `{read, need, speaker, rationale, confidence}`) that replaces the bare
  `tinyRouter` on the ambiguous path. `settings.intentPass` = `off` / `auto`
  (ambiguous-only, default) / `always` (every turn). Result recorded on
  `state.lastIntent` and surfaced live via background activity. Remaining
  (Sonnet-friendly): (a) UI control for `intentPass` — Telemetry or Goal panel;
  (b) prime the chosen actor's prompt with the resolved `need` in `askActor`;
- [ ] **Persist intent pass results to the message log.** `state.lastIntent`
  is currently ephemeral — it shapes the next turn but isn't recorded anywhere
  durable. Appending each intent result as a `type: "intent"` message (hidden
  from the transcript UI but present in the log and debug exports) would give
  a complete audit trail: why each actor was chosen, what the discussion was
  judged to need, confidence over time. Inspired by Temporal's event-sourcing
  model — the execution history becomes the source of truth, not just derived
  state. Enables: replay analysis, "why did this actor speak?" chip (already
  in the UX backlog), and future session-diff tooling.
  Files: `turns.js` (`resolveIntent`), `state.js`, `Transcript.jsx` (filter
  intent messages from display). Size: small.
  (c) per-actor desire blobs as an alternative scoring input; (d) fold the
  dominance/participation penalty (next item) into the intent prompt.
- [x] **Addressee-driven next-speaker routing.** (2026-06) `detectAddressedActor`
  in `turns.js` parses `@Name` and `"Name,"` / `"Name?"` patterns in the latest
  message; `state.ui.mentionTarget` handles explicit @-mention routing from the
  composer. Both are checked as priority steps 1–2 in `resolveNextSpeaker`.
- [ ] **Devil's Advocate actor preset.** Built-in actor template pre-configured
  to adversarially challenge whatever the group is converging on. Key addition:
  wire the intent pass so the Director routes to it specifically when
  `need === 'challenge'` or when consecutive turns show high cosine similarity
  (sycophancy signal). Files: actor preset list / `blueprints.js`, `turns.js`
  (intent routing hint in `askActor`). Size: small.
- [ ] **External shock injection.** Director action (or user button) that fires a
  crisis scenario mid-session via `pendingInjections` — "the market just
  collapsed, does your plan survive?" Fits the existing injection system; needs a
  UI affordance (button in Scenario panel or Composer). Files: `turns.js`,
  `ScenarioPanel.jsx` or `Composer.jsx`. Size: small.
- [ ] **Backchannels.** `actor.backchannel: true` schema flag — when enabled
  the actor can emit a short acknowledgment ("Agreed.", "Hold on —")
  instead of a full paragraph. Drops max_tokens, skips full prompt context.
  Files: `schemas.js`, `turns.js`, `ActorsPanel.jsx`. Size: medium.
- [ ] **Dominance / participation balancing.** Track turns-per-actor, subtract
  a dominance penalty from the scheduler score so chatty actors don't
  monopolize. Trivial once intent-pass exists. Files: `turns.js`. Size: small.
- [ ] **Conversational repair.** When `openQuestions` has an entry that's
  stayed unanswered for N turns, nudge the next speaker to address it.
- [ ] **Pending-reply queue (soft addressee routing).** When an actor
  addresses another by name in their message, record it in
  `state.pendingAddressees` (populated in `applyAiResult`, drained when
  the addressed actor speaks). Pass the queue as context to the intent
  pass so the addressed actor gets a scheduling boost without a hard
  override — other actors can still interject. After N turns with no
  response, escalate to a forced route. Note: self-nomination (`wantsToReply`
  flag) was considered and rejected — non-speaking actors don't execute,
  so there is nowhere to write the flag. Passive inference from the
  speaking actor's output is the only viable signal.
  Files: `turns.js` (`applyAiResult`, `resolveIntent` context block),
  `state.js`, `constants.js`. Size: small.
  Files: `turns.js`, `memory.js`. Size: small.
- [ ] **Adjacency-pair routing.** Question → answer, then control returns
  upward instead of cascading. Linguistic concept worth encoding as a
  scheduler rule. Files: `turns.js`. Size: small.

## Session-analysis findings (2026-06-07)

Observations from a 41-round, 218-message debug export where Muse / Architect
/ Skeptic brainstormed use-cases for the app itself. No Director turns (was
effectively on-call). 14 summarisation cycles; 129 pinned facts; 100 API calls;
0 parse failures.

### Bugs found & fixed

- [x] **Suppressed pauses still bloated the transcript.** 102 of 116 actor
  turns generated a `type:"pause"` message even though `pausePolicy.allowedReasons`
  was empty. The `addMessage` call in `applyAiResult` was unconditional — now
  gated on `allowed`. Suppressed records still go to `pendingPauses` for
  diagnostics. Impact: in the wild this added ~88% extra context overhead every
  turn.
- [x] **`_pendingTurnIntent` leaked on early-exit turns.** When `runNextTurn`
  returned false (stop-flag, auto-stop, error), `_pendingTurnIntent` was not
  cleared; the stash carried stale routing info into the next session start.
  Fixed: `state._pendingTurnIntent = null` on break.
- [x] **API call logs missing `tier`/`purpose` fields.** All 100 logged calls
  showed `tier: null`, `purpose: null` — can't diagnose thinking-tier behavior
  from diagnostics. Fixed: `tier` + `purpose` now threaded from every
  `chatJson` / `chatStructured` / `chatCompletion` call site into the log
  entries in `_chatCompletionDirect` and `chatStream`.

### Things to act on

- [ ] **Pinned facts hit 129 — need auto-compaction trigger.** Without an
  embedding model the semantic dedup misses rewording. At 100+ facts the context
  overhead is significant even before embedding costs. Add: fire
  `compactPinnedFacts` automatically when `pinnedFacts.length > 60` (or a
  configurable threshold). Files: `memory.js`, `constants.js`. Size: small.
- [ ] **Director silence warning.** The Director actor (canDirect) spoke 0
  times in 41 rounds; it was effectively on-call but users won't notice. Surface
  a warning banner in the Inspector when a `canDirect` actor hasn't spoken in >5
  rounds. Files: `ActorsPanel.jsx`. Size: trivial.
- [ ] **pausePolicy UI — allowedReasons is hidden.** The default empty
  `allowedReasons: []` means all pause requests are suppressed silently, which
  was the right behavior in the observed session but is invisible to users. Add
  a short explanation + toggle in the Actors panel or AutoStop settings (e.g.,
  "Allow actor pauses" checkbox). Files: `AutoStopPanel.jsx` or
  `ActorsPanel.jsx`. Size: small.

### Conversation content (Five Pillars taxonomy)

The actors organically produced a sophisticated use-case taxonomy worth
preserving as a reference for the app's own description:

**Five functional pillars:**
1. **Narrative** — collaborative storytelling, lore generation, worldbuilding
2. **Simulation** — scenario modeling (market crash, diplomacy, crisis drills)
3. **Generation** — creative / generative output (music, design, fiction)
4. **Augmentation** — user-facing skill coaching, tutoring, reflective mirror
5. **Interaction Dynamics** — self-reflective bias identification, group process

**Meta-pillar:** Personalized Experience Design — the overarching optimisation
goal that each of the five pillars serves. Use cases described as coordinates
in a 3D design space (function × tension × value-alignment), modified by
boundary conditions.

Specific vetted use cases that emerged: Gamified Skill Acquisition, Scenario
Simulation, Generative Worldbuilding, Cultural/Societal Simulation,
Metacognitive Coaching, Self-Reflective Bias Identification.

## Session-analysis findings (2026-06-08, run 2)

6-actor brainstorming session, 69 messages, model `gemma-4-e4b-uncensored`
(4096-token context), LM Studio. 15 t/s average. 0 parse failures on the
actors that completed; 2 parse-fail skips.

### Bugs / action items

- [ ] **Thought field bleeds into message on non-compliant models.** ~10 messages
  start mid-word (`n to feed`, `gh—how about`). Raw completions confirm the model
  splits a word across the `thought`/`message` JSON field boundary. No extraction
  bug — the model generates it wrong. Mitigation: when `showThoughts: false`,
  remove `thought` from the actor schema entirely (or cap it to ~40 chars) so
  the model can't burn the field budget before `message`. Files: `schemas.js`,
  `turns.js` (`buildActorSchema`). Size: small.
- [ ] **Pause storm despite `allowedReasons: []`.** Session had 29 pause messages
  with `pausePolicy.allowedReasons: []` set — all reasons should be suppressed.
  The June-07 fix gated `addMessage` on `allowed`, but this session suggests a
  remaining path. Investigate whether empty `allowedReasons` is treated as
  "allow none" or "allow all defaults" at the enforcement site.
  Files: `turns.js` (`applyAiResult` pause path). Size: small.
- [ ] **Persona breaks not caught by output guardrail.** Several turns produced
  meta-commentary instead of in-character speech: `"Anya will speak next."`,
  `"Here is the completed JSON object."`, `"My mandate is to…"`, `"the directive
  implies I should assume…"`. These pass the `validateActorOutput` length/filler
  check. Add a fast regex gate for common meta-commentary signals before the
  retry. Files: `turns.js` (`validateActorOutput`). Size: trivial.

### Observations (no action needed)

- Intent pass quality: last intent had `confidence: 0.9`, correctly routing to
  IdeaSparker to challenge the CoE/Velocity binary with a third path.
  `expectedOutput` was specific and useful — the feature is working.
- Plan stepped correctly through all 4 stages over the session.
- Memory healthy: 30 pinned facts, coherent shared summary, open questions
  correctly tracked.
- Model note: `gemma-4-e4b-uncensored` doesn't support `response_format:
  json_schema` (grammar-constrained JSON); falls back to code-fence output.
  Schema enforcement is nil on this model — persona collapses and field-boundary
  errors are expected. Recommend `google/gemma-4-12b-qat` for better compliance.

## Session-analysis findings (2026-06-08, run 3)

6-actor brainstorm, **model: `google/gemma-4-12b-qat`**, 18 messages, 3 rounds,
8 t/s average. Same cast as run 2. Major quality jump over the 4B.

### Comparison vs 4B (run 2)

| Metric | 4B (run 2) | 12B (run 3) |
|---|---|---|
| Parse failures | 2 (hard skips) | 1 (regex fallback recovered) |
| Pause storm | 29 messages | 0 |
| Mid-word truncation | ~10 messages | 0 |
| Persona breaks | Several | 0 |
| Content quality | Fragmented | Coherent, on-topic |

### Remaining issues

- [ ] **Thought field overflow still happens at 12B.** One parse failure: Business
  Innovator wrote a 2367-char `thought` and hit `max_tokens` before reaching the
  `message` field — identical failure mode to run 2, just rarer. Priority fix:
  when `showThoughts: false`, remove the `thought` field from the schema entirely
  (or cap at ~40 chars). Files: `schemas.js`, `turns.js` (`buildActorSchema`).
  **Size: small. Should land before MCP work.**
- [ ] **Intent pass firing too often.** 7 intent-pass calls for 17 actor turns
  (~41% of turns). Each adds ~9s latency. The `auto` threshold may be too
  broad — check the ambiguity signal in `resolveIntent`. Files: `turns.js`. Size:
  small.
- [ ] **Summarizer hits token cap on 3 of 4 calls.** 1600-token ceiling reached
  each time (one at 2918 — the planner). Summarizer is being cut off. Consider
  raising `maxTokens` for `reason`-tier summarizer calls, or chunking the output.
  Files: `turns.js`, `memory.js`. Size: small.
- [ ] **One summarizer call still shows `tier: null`.** The June-07 tier-logging
  fix didn't cover this call site. Files: `turns.js`. Size: trivial.

### Observations (no action needed)

- Intent pass: `need: "challenge"`, confidence 0.85, correctly routing to Muse
  for creative pushback. Feature is working well.
- Context pressure: 85% (3498/4096) by round 3. Expected for a 4096-context
  model; not a bug.
- Token speed down to 8 t/s from 15 t/s (4B) — expected for a 3× larger model.

### Brainstormed ideas from this session

The actors were brainstorming features for the app itself. Ideas worth keeping:

- [ ] **Dynamic Narrative Branching.** In story sessions, actors vote on which
  story path to take based on their persona and goals — majority or
  confidence-weighted vote decides the next narrative beat. Variant: a "Live
  Prompt Engineering" panel where the user adjusts actor voting weights in
  real-time as the story unfolds. Files: `turns.js` (new vote-collection pass),
  new UI chip. Size: medium.
- [ ] **Lore Synthesizer / Living Mythos.** For world-building sessions: ingest
  disconnected user notes, synthesize them into a consistent timeline/encyclopedia,
  then identify "narrative voids" (gaps in user detail) and fill them with
  generated legends, rumors, or lost records that feel organic rather than
  placeholder. Distinct from the existing document system — it's generative
  gap-filling, not just storage. Files: new `lore.js` module, `DocumentsPanel.jsx`
  (new tab or scribe mode). Size: large.
- (Note: **Adversarial Perspective Injection** and the three-tier
  Proposal→Challenge→Arbitration hierarchy are covered by the Devil's Advocate
  preset + existing Director arbitration. The "Logic Stress Test" variant is
  just a blueprint with opposing-goal actors — doable today with no code change.)

## Memory & context

- [ ] **Decision memory.** New `state.memory.decisions: []` collection
  populated by the summarizer (separate from `pinnedFacts` /
  `openQuestions`). Anchors future turns and feeds output synthesis. Files:
  `constants.js`, `state.js`, `memory.js`, `turns.js`. Size: medium.
- [ ] **Memory correction.** UI affordance to mark a chunk or fact as wrong
  so it stops being recalled. Addresses the "sleeper cell" hallucination
  propagation problem. Files: `memory.js`, `MemoryPanel.jsx` (or new). Size:
  medium.
- [ ] **Bipartite write control on shared memory.** Gate writes to
  `pinnedFacts` / `openQuestions` behind a `verified` flag so claimed vs
  ground-truth facts are distinguishable. Files: `memory.js`, `state.js`.
  Size: small.
- [ ] **Open-question dedup via embeddings.** Reuse the fact-dedup path
  (`memory.js:386`) for open questions; also detect when transcript has
  answered a stale question. Files: `memory.js`. Size: small.
- [-] **Raw-message RAG as second recall channel.** Evaluated and skipped —
  current chunk-summary recall covers thematic queries; no concrete failure
  mode justifies the cost yet. Revisit if verbatim recall becomes a need.

## Detection & quality signals

- [ ] **Sycophancy detector (cosine sim ≥0.95).** Embed each turn, compare
  to previous; when threshold crossed in a debate context, inject an
  anti-echo system hint into the next actor's prompt. Uses existing
  embedding infrastructure. Files: `turns.js`, `telemetry.js`. Size: small.
- [ ] **State hashing for stuck-loop detection.** Hash recent state
  (messages + summary + facts); if the hash recurs, force termination.
  Catches loops that alignment scoring misses. Files: `turns.js`,
  `telemetry.js`. Size: small.
- [ ] **Character-drift telemetry.** Embed each actor's persona once; embed
  their recent outputs; surface drift score and optionally auto-fire the
  style reminder more aggressively when it dips. Files: `telemetry.js`,
  `turns.js`. Size: medium.

## Tools & MCP

forumsbot as an **MCP client** — actors can call real tools (web search, file
read, SQLite memory, RAG) during a turn. LM Studio stays as the inference
backend unchanged; MCP is an execution layer underneath the existing text-tag
system.

Architecture: session config declares which MCP servers to connect to → on
session start forumsbot opens connections and fetches tool lists → available
tools are auto-appended to each actor's system prompt as text-tag examples
(local models understand `[SEARCH: query]` better than raw JSON tool schemas)
→ when an actor emits a recognized tag the turn loop intercepts it, calls the
MCP server, injects `[Tool result: …]`, and re-runs the turn.

Use cases that motivated this:
- Large codebase: filesystem MCP + embeddings RAG server
- Epic roleplay campaign: `@modelcontextprotocol/server-sqlite` for persistent
  queryable world-state and character memory
- Research session: Brave/Exa search MCP + fetch MCP for live web access
- Any session: expose the forumsbot KB store as a custom MCP server so actors
  can query the session's own document base

Practical note: tool-use reliability scales with model capability. Gemma-4 will
be erratic; a larger Qwen3 or Mistral with grammar-constrained output will work
much better. The text-tag interface is intentionally low-bar to fit small
models.

- [ ] **`src/modules/mcp.js` — MCP client core.** Connect to configured MCP
  servers (stdio or HTTP/SSE transport via `@modelcontextprotocol/sdk`), list
  tools, execute calls, surface errors as injected context. Size: medium.
- [ ] **Session MCP config.** Per-session array of server configs (similar to
  actor configs). UI: "Tools" section in Scenario or Connection panel showing
  enabled servers + their discovered tool names. Size: medium.
- [ ] **Tool injection into system prompts.** Auto-append "Available Tools"
  block to each actor prompt listing only the tools from connected servers,
  formatted as text-tag examples with parameter descriptions. Files:
  `turns.js` (`buildActorPrompt`). Size: small.
- [ ] **Turn loop tag interception.** Generalize the existing `[SEARCH:]` /
  `[READ:]` intercept in `applyAiResult` to route any `[TOOLNAME: args]` block
  through the MCP call registry. Result injected before re-run. Files:
  `turns.js`. Size: medium.
- [ ] **Preset server bundles.** Named bundles the user can toggle per session
  type — "Research" (search + fetch), "Roleplay" (SQLite memory), "Codebase"
  (filesystem + RAG). Lowers config friction. Size: small.

## Documents

- [ ] **Document semantic retrieval.** Replace the even-cap per-doc
  allocation in `buildKbSection` with embedding-ranked top-k of doc
  paragraphs. Biggest remaining embedding upgrade — documents grow
  unbounded today. Files: `knowledge.js`, possibly new chunk store for
  docs. Size: medium-large.

## UX & debugging

- [ ] **Output synthesis ("Session Outcome" doc).** On-demand and
  session-end pass that produces a structured doc: decisions, open
  questions, dissent, recommended next steps. Ties together documents +
  pinned facts + open questions. Highest user-visible payoff of all the UX
  items. Files: new module, `session.js`, `DocEditorStage.jsx`. Size:
  medium.
- [ ] **"Why did this actor speak?" chip.** The director already emits a
  routing reason; surface it as a tiny ℹ chip on each message. Mostly
  plumbing existing data through to the UI. For intent-routed turns this is
  now backed by `state.lastIntent` (read / need / rationale / confidence) —
  richer than a bare reason string. Files: `turns.js` (persist reason +
  lastIntent onto the message), `Transcript.jsx`. Size: small.
- [ ] **Force-ask UI ("Ask this actor").** Right-click an actor in the
  inspector → "Ask next." Or `@Alice` chip in the composer. Pairs with
  addressee-driven routing. Files: `ActorsPanel.jsx`, `Composer.jsx`,
  `turns.js`. Size: small.
- [ ] **Show actor goals on Director roster line.** Append `actor.goal` to
  the roster entries the Director sees, so its `nextSpeaker` and
  `promptInjections` decisions are better informed without dumping full
  personas. Files: `turns.js:1251`. Size: trivial.
- [ ] **Suggest objective when scenario.objective is empty.** One-shot LLM
  call after the first user message that proposes an objective; surface
  as an editable chip ("Suggested: X — Use / Edit / Dismiss"). Files:
  `turns.js`, new UI. Size: small.

## Research reading list

Reading that would inform the next round of design — not code work, just
reading. Top three are the most directly applicable to features above.

- [ ] **Lost in the Middle** (Liu et al., 2023) — positional attention in
  long contexts; justifies our style-reminder-at-tail and would inform
  placement of anti-sycophancy hints and recall results.
- [ ] **Towards Understanding Sycophancy in Language Models** (Sharma et
  al., Anthropic, 2023) — quantifies the failure mode that the sycophancy
  detector targets. Validates the cosine-sim threshold idea.
- [ ] **A Simplest Systematics for the Organization of Turn-Taking** (Sacks
  / Schegloff / Jefferson, 1974) — short paper. The actual rule set behind
  the addressee-routing idea.
- [ ] **Generative Agents** (Park et al., 2023) — canonical memory /
  reflection / planning paper. Informs how far to push actor believability.
- [ ] **Improving Factuality and Reasoning through Multiagent Debate** (Du
  et al., 2023) — empirical case for/against debate features.
- [ ] **Structured output research** — Outlines, llguidance,
  lm-format-enforcer, LM Studio structured output. Affects `chatStructured`
  reliability.
- [ ] **AutoGen GroupChatManager source** — prior art on speaker selection
  that survived iteration.
- [ ] **Letta (ex-MemGPT) source** — tiered memory + paging design more
  polished than ours.

## Empirical measurements on our own system

Things we should know but don't, that need running the app rather than
reading papers.

- [ ] **What cosine threshold actually catches fact duplicates?** Dump a
  session's pinned facts, look at sim values clustering real duplicates vs
  distinct. Validates the 0.88 we use today and the proposed 0.95 for
  sycophancy.
- [ ] **At what session length does our local model degrade?** Same
  scenario at 20 / 50 / 100 / 200 turns; rate coherence. Justifies
  summarization-aggressiveness tuning quantitatively.
- [ ] **Embedding model A/B.** Nomic v1.5 vs Qwen3-Embedding-0.6B on a
  fixed set of recall queries against a real session archive. Settles the
  model question with data.

---

## UI audit — panel by panel

Running notes from auditing the Inspector panels for (a) controls bound to
dead/removed systems, and (b) live systems with no UI control.

### Documents panel — layout density, two open items

Phase 1 + 2 + 3 shipped (2026-06): scribeMode selector in header, pending
badge, Writer Queue, unified list + filter chips, content preview, search,
drag-reorder, bulk select/delete, file/folder/clipboard import.

Remaining:
- [ ] DocRow main row is still dense (chevron, type badge, title input, word
  count, version, AI badge, preview btn, expand btn, toggle). Switch to
  fixed-grid columns with clear regions for title / meta / actions when
  revisiting the panel.
- [ ] Expanded settings mix inline (toggles, dropdown) and vertical (textareas)
  layouts inconsistently. Pick one rhythm.

### Sessions panel — same UX problems as Library, plus hidden behavior

All handlers live, no dead UI. Same browse + preview problems as
Library. Plus several pieces of hidden behavior the user can't see.

Hidden behavior:
- [ ] Sessions auto-save every round during auto-run (`turns.js:875`)
  and on tab close (`App.jsx:178, 204`). UI implies manual saves
  required.
- [ ] 20-session cap (`session.js:1045-1051`) silently evicts the
  oldest. No warning at 18/19/20.
- [ ] No name dialog on save — sessions take `scenario.title`. With
  the recent neutralize fix, default is "Untitled forum" — multiple
  sessions become indistinguishable.
- [ ] `_currentSessionId` tracked but never surfaced. Users can't
  tell which row in the list is their working state.

Footguns:
- [ ] Loading a session = immediate state replacement, no confirm
  modal. Auto-save covers the loss but users don't know.
- [ ] "Save current" button label implies manual saves are required.
  Rename to "Save now" + add auto-save indicator.
- [ ] "Load preset" is the import button but the label conflicts
  with Library's "preset/setup" terminology. Rename to "Import…".

Missing UI:
- [ ] "Save as new" — `saveCurrentSession` always overwrites; no
  deliberate branch. Fork-from-message exists in transcript but is
  not discoverable from here.
- [ ] Per-session export ("⇩" on each row) so users can export
  without first loading.
- [ ] Bulk export / import for full backup.
- [ ] Search / filter.
- [ ] Session preview before load (same as Library).
- [ ] Auto-save indicator ("last saved 30s ago").
- [ ] "Current" badge on the row matching `_currentSessionId`.
- [ ] Optional user-given name override (beyond scenario.title).

Strategic option — merge Library + Sessions:
- [ ] Both panels are variations of "saved state you can load back."
  Setup-only vs full-session is a category, not a separate panel.
  Consider unifying under a single Library panel with tabs:
  Blueprints / Setups / Sessions / Import-Export. Same browse +
  preview pattern across all three; shared export/import utility.
  Reduces duplicated UI logic.

### Library panel — wiring is fine, interface needs a total rethink

All four handlers (apply blueprint, save / apply / delete config) are
live. No dead UI. The problem is the **interface design** — it's
deeply inconvenient for what should be the discovery-and-reuse hub.

Current pain points:
- Blueprint dropdown shows icon + label + actor count only. To see
  what a blueprint contains (premise, objective, cast, systems,
  seeded docs), you have to apply it.
- Description appears only after selection, and only the one-line
  `description` field. Premise / objective / systems config / cast
  roster all hidden.
- No grouping. 11 blueprints in one dropdown. They split cleanly into
  Problem-Solving / Story / Hybrid but the UI doesn't show that.
  `ACTOR_LIBRARY` already has a `group` field used elsewhere —
  BLUEPRINTS doesn't.
- Apply is one-click destructive with only a plain text confirm.
- Saved setups have the same lack of preview (name + date + count).
- Saved setups can't be edited in place — Apply or Delete only.
- No export / import — saved setups are localStorage-only, can't be
  shared or backed up.
- No search / filter.
- Two different concepts (curated blueprints, personal saves) share
  one panel without clear separation.

Redesign — browse + preview pattern (Sublime / Notion / Figma style):

Phase 1 — minimum viable rethink (biggest win):
- [ ] Add `group` field to `BLUEPRINTS` entries (mirrors
  `ACTOR_LIBRARY` pattern). Two natural groups: Problem-Solving,
  Story; Hybrid for outliers like Debate.
- [ ] Replace blueprint dropdown with grouped card/row list.
- [ ] Preview pane (below list, or modal on narrow viewports) showing
  premise, objective, full cast roster with personas + colors,
  systems summary, seeded docs.
- [ ] Apply button at bottom of preview with explicit "will replace X
  / will keep Y" callout.
- [ ] Same row + preview pattern for saved setups.
- [ ] Tab switch at top: Blueprints / Saved / Import/Export.

Phase 2 — convenience:
- [ ] "Update from current state" button on saved setups.
- [ ] Export saved setup as JSON (clipboard + file).
- [ ] Import setup from JSON (paste or file).
- [ ] Search bar across both blueprints and saved setups.
- [ ] Visual cast preview — actor color swatches inline with cast.

Phase 3 — power features (only if needed):
- [ ] Side-by-side compare between two blueprints.
- [ ] Tag-based filtering beyond two groups.
- [ ] Saved setup version history.

### Goal panel — clean and fully wired, small targeted improvements

All controls bind to live consumers — no dead UI. The panel is small
and focused. Findings are missing UI, one misleading hint, and a
documentation gap.

Bug-ish:
- [ ] Misleading hint under the Goal field claims "LLM judge checks
  this after each round" but the engine at `turns.js:925` checks
  `roundsRun % 2 === 0` — every other round. Either fix the hint or
  make the cadence configurable.

Missing UI for live state:
- [ ] `settings.turnDelay` (auto-run pacing seconds, consumed at
  `turns.js:818`) — orphan from Connection audit. Belongs here next
  to auto-stop. After landing, consider renaming the panel to
  "Auto-run & Goal".
- [ ] Manual reset button for `autoStop.roundsRun`. Counter resets
  automatically on stop / goal change / "Use objective" but has no
  manual control.
- [ ] Surface `judgeGoal` confidence (0-1, computed at
  `turns.js:1009`) when verdicts run. Currently only the reason
  string flows through `setAutoStopStatus`.
- [ ] Goal / verdict history. Each `judgeGoal` call clobbers
  `autoStop.status` — no trail of past judgments or past goals.

Documentation / UX:
- [ ] Two-goal confusion: `scenario.objective` shapes behavior and
  alignment; `autoStop.goal` only triggers stop. Engine seeds goal
  from objective when blank (`state.js:239-240`). The "Use objective"
  chip hints at the relationship but doesn't explain it. Add a
  one-line hint under "Goal to reach".
- [ ] Stop Conditions disclosure mixes LLM judge (expensive) with
  deterministic conditions (skip / max rounds). Could group "Smart"
  vs "Hard" stops.
- [ ] Add "(model call)" hint on the judge toggle and Check Goal Now
  button (same caveat as Memory panel).

### Telemetry panel — earns its slot but ships three dead displays

Verdict: **keep, don't merge away**. The alignment dial + skip rate
are genuinely useful for long sessions, and the routing/perf settings
are real knobs. But the panel currently shows 3 dead values, displays
the alignment percentage 4 times, and visualizes the same history
data twice — the live signal is buried in redundancy.

Cut:
- [ ] Drift row — `telemetry.drift` is **never written** anywhere in
  the codebase. Always renders `+0.00`.
- [ ] Mem Dups tile — reads `diagnostics.warnings.filter(category ===
  'memory_dup')`. **No logWarning call uses that category.** The only
  warning ever logged is from `telemetry.js:85` with category
  `"embeddings"`. Permanently 0.
- [ ] Aligned tile in Session Health grid — duplicates the main dial
  number (also shown in the header badge and implied by the sparkline).
- [ ] Tension grid — redundant with spark bars (same data, different
  visual). Pick one.

Add — data we already collect but don't surface:
- [ ] Context usage tile: `contextInfo.lastPromptTokens` /
  `maxContextLength`. Already shown in Topbar; reinforce here as
  pacing indicator.
- [ ] Parse failures count: `diagnostics.parseFailures.length` —
  signals model fighting the JSON schema.
- [ ] Embedding probe status: `ui.embeddingProbeResult` — gates the
  dial's embedding mode, worth reinforcing.
- [ ] Per-actor skip rate breakdown — aggregate is fine; per-actor
  catches "Alice never speaks" situations.
- [ ] If `includeTraces` is on, surface recent API call count /
  average latency from `diagnostics.apiCallLogs`.

Relocate (optional):
- [ ] `roundSnapshotEnabled` and `enablePreflightRouter` (+ its orphan
  threshold) are performance toggles, not telemetry. Consider moving
  to Connection's Generation tuning disclosure.
- [ ] `gravitySensitivity` and `includeTraces` stay here — both are
  alignment- or diagnostics-flavored.

### Memory panel — well-wired but missing controls for live engine state

All controls are bound to live consumers — no dead UI. The findings
here are missing UI for state the engine actively uses, plus several
UX gaps.

Missing UI for live state:
- [ ] `memory.enabled` toggle — used at 5 sites in `turns.js`
  (lines 702, 830, 1595, 1751, 1858) and `memory.js:126` to gate
  summarization, recall, and archiving. Default true. No UI to turn
  memory off without editing state directly. Add a top-level toggle.
- [ ] `outcomes.rationale` and `outcomes.rejectedOptions` are
  populated by `extractOutcomes` (`memory.js:606-607`), used in
  `formatCurrentOutcomes()` which feeds re-extraction, but absent from
  the Outcomes tab. User sees 4 of 6 outcome categories.
- [ ] `turnsSinceSummary` tracked at `turns.js:703-705`, not shown.
  Useful diagnostic for the Archive card.
- [ ] `outcomes.lastExtractedAt` stored, never displayed. Show as
  "Last extracted: HH:MM" near the Outcomes tab.
- [ ] `enableCrossSessionMemory` setting lands here (relocated from
  Connection panel orphan).

UX issues:
- [ ] Pending pinned facts have no preview before Save — black box.
  Show the pending list as a sub-list or under a Review disclosure.
- [ ] Open Questions are terminal: only remove. Add edit / mark
  answered / convert-to-fact affordances.
- [ ] No way to view archived chunk contents. Add a "View archive"
  disclosure listing recent chunks for debugging recall issues.
- [ ] Facts tab is overloaded (Pinned Facts + Open Questions +
  Archive). Rename or split.
- [ ] Outcomes tab uses newline-split textareas for arrays. Inconsistent
  with the chevron-list pattern used elsewhere.
- [ ] Anchors architecture quirk: pending lives in
  `memory.pendingAnchors`, approved lives in top-level `state.anchors`.
  Costs nothing to harmonize.
- [ ] Add "(model call)" hint on Summarize / Extract / Rebuild /
  Compact buttons so users know they fire LLM requests.

### Participation panel — small surface, one prompt/enforcement mismatch

Every control binds to a live consumer. No dead UI, no missing UI for
live fields. One real prompt-vs-engine mismatch:

- [ ] `allowedReasons` UI offers 5 checkboxes, but the actor prompt at
  `turns.js:1467-1470` only knows the coarse sponsor / non-sponsor
  split. Custom subsets get silently suppressed by the enforcement at
  `turns.js:2103` — the actor was never told. Rebuild `allowedDesc`
  from `policy.allowedReasons` instead of the mode default. Small fix.
- [ ] Add a small "(remembered across sessions)" hint under Display
  name to surface the parallel localStorage persistence
  (`forum_user_context`). Currently invisible.
- [ ] "Reset to mode default" button for allowed reasons — after
  customizing there's no quick way back.
- [ ] Pause History never empties. Add a Clear button. Optional:
  collapse by default in a `<details>`.

### Actors panel — fully wired but has one real bug and several gaps

Every control on the panel maps to a live consumer in the engine — no
dead UI. The findings here are a bug, a few missing controls for state
that exists, and small UX quibbles.

**Bug to fix:**
- [ ] Reset memory button uses `a.id` as the key
  (`ActorsPanel.jsx:500`), but cross-session actor memory is keyed by
  `actor.name` (`turns.js:1118, 1123, 1603`). The button clears
  in-state `actor.thoughts` but the distilled DB record persists across
  sessions. One-char fix: `putActorMemory(a.name, '')`. Add a
  confirmation modal while in there.

Live state with no UI:
- [ ] Color picker for `actor.color`. Set on create from
  `DEFAULT_COLORS`, never editable after. Surface in the Identity row
  with `<input type="color">`. Size: trivial.
- [ ] "View memory" disclosure for `actor.thoughts`. Currently only
  resettable, never viewable. Helpful for debugging "why is this actor
  stuck on X?". Size: small.
- [ ] Surface cross-session distilled memory from the `actor-memory`
  store. No way today for the user to see what's accumulated. Pair it
  with the View memory disclosure. Size: small.
- [ ] `actor.skipCount` is tracked but invisible. Show next to the
  stats badge (`Nt · Nw · Ns`). Useful for spotting silent actors.
  Size: trivial.

UX quibbles:
- [ ] `canSeeThoughts` chip should be conditional on `canDirect` — it's
  gated as director-only at `turns.js:1172`. Toggling it on a regular
  actor does nothing.
- [ ] `canManageCast` similarly pairs with `canDirect` in practice.
  Consider grouping or gating.
- [ ] Add confirmation modal for Remove actor (one-click destructive).
- [ ] Permission chips are a flat row of 6. As `actor.model` /
  `actor.thinking` and other capabilities land (three-mode thinking),
  sub-group into Role / Capabilities / Visibility.
- [ ] `actor.expanded` is UI state living on the data model and
  persisting to localStorage. Move to local component state. Minor.
- [ ] Authority badge isn't shown in the collapsed actor header — only
  permission icons + stats. For tuning authority, the value isn't
  visible at a glance.

### Scenario panel — exposes live engine surface but ships dead state

The panel's controls all bind to live systems. The problem is in the state
*around* it: four fields are still in defaults, blueprints, normalization,
the AI Assistant guide, and types — but the engine has no reader for them.
Significant cleanup opportunity.

Dead state to remove:
- [ ] `systems.alignment.nudgeStyle` — extracted to `sysCfg` at
  `turns.js:25`, never read. Behavior comes from `alignmentStrictness`
  alone (strict→hard-redirect, moderate→question, loose→soft). Touch:
  `constants.js`, `state.js`, `blueprints.js`, `session.js` (blueprint
  catalog + AI Assistant guide), `utils.js`, `types.ts`, tests.
- [ ] `systems.alignment.anchorInPrompt` — extracted at `turns.js:24`,
  never read. Anchor injection uses `state.anchors[]` directly. Same
  touch list as above.
- [ ] `systems.dmRole.narrates` — superseded by derived
  `get dmNarrates()` at `turns.js:39`. Field still written by every
  blueprint and the AI Assistant guide. Remove.
- [ ] `systems.dmRole.canIntroduceElements` — already removed from
  `resolveSystemSettings`. Still written by blueprints. Remove.
- [ ] Consider deprecating `systems.dmRole.role` entirely: panel writes
  `actor.directorMode` instead, and `dmRole.role` is read only as
  fallback when no director actor exists. Either keep as legacy seed or
  remove.

UI changes:
- [ ] Reorder cards: Core Context (title/premise/objective) above
  Systems. Currently the most fundamental fields sit at the bottom.
- [ ] Mild redundancy: Director Behavior selector also lives on the
  Director actor card. Could collapse to one or accept the redundancy.

### Connection panel — healthy, missing some homes for orphans

All controls in the panel are bound to live systems. No dead-code UI to
remove. Adds/relocations:

- [ ] Add seed controls (`settings.seed` + `settings.seedEnabled`) to the
  Generation tuning disclosure — pure generation tuning, currently
  orphaned in state with no UI. `api.js:103` `applySamplingParams` already
  honors them. Size: trivial.
- [ ] Relocate `settings.preflightThreshold` to Telemetry panel next to
  its companion toggle `enablePreflightRouter`. Currently orphaned.
- [ ] Relocate `settings.enableCrossSessionMemory` to Memory panel.
  Currently orphaned.
- [ ] Relocate `settings.turnDelay` to Goal panel (auto-run section).
  Currently orphaned.
- [ ] Reserve placement for `judgmentModel`, `fastModel`,
  `reasoningEffort` controls below the embedding-model row when the
  three-mode thinking system ships.
- [ ] Consider promoting Streaming + Global style toggles out of the
  Generation tuning disclosure (neither is really "advanced tuning").
  Mild UX quibble, not urgent.

---

## Done (recent)

- [x] **Wire up the toast notification system** (2026-06) — Toaster
  component, CSS, three trigger points. Commit `90e3e92`.
- [x] **Simplify memory** (2026-06) — collapsed dual delta+rewrite paths
  into one incremental summary. Commit `e9ee467`.
- [x] **Simplify document system** (2026-06) — dropped per-actor
  visibility, LCS line attribution, water-fill char allocator. Commit
  `8463cca`.
- [x] **Neutralize default scenario** (2026-06) — title/premise/objective
  defaults emptied so they stop steering actors into a council frame.
  Director goal made procedural. Commit `123e1a7`.
- [x] **Narrator-mode director skip rules** (2026-06) — added narrator
  branch so the Director opens the scene instead of skipping on turn 1.
  Commit `c123c7b`.
- [x] **Show thoughts on skipped turns** (2026-06) — skip render path now
  includes the thought block. Commit `5655ab1`.
- [x] **Addressee-driven next-speaker routing** (2026-06) — `detectAddressedActor`
  parses `@Name` and `"Name,"` / `"Name?"` patterns; `state.ui.mentionTarget`
  handles @-mention routing from the composer. Steps 1–2 in `resolveNextSpeaker`.
- [x] **Documents panel Phase 1 + 2 + 3** (2026-06) — scribeMode selector,
  pending badge, Writer Queue UI, unified list + filter chips, content preview,
  search, drag-reorder, bulk select/delete, file/folder/clipboard import.
- [x] **Routing, Prompt, Validation & Context plan** (2026-06) — all 9 features
  shipped: intent-pass retry (A), nextSpeaker enum (B), post-history persona
  reminder (C), per-actor exampleDialogue (D), planning pre-pass (E), output
  guardrails + retry (F), emergency mid-round summarization (G), expected-output
  + dynamic maxTokens (H), prose prompt-gaps / stuck flag (I).
  `FEATURE_IMPLEMENTATION_PLAN.md` deleted.
