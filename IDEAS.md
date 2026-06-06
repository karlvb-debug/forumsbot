# Ideas & TODO

Running backlog of things worth doing, ranked roughly by impact within each
section. Each entry: one-line bottom-line, key files, rough size.

**Status legend:** `[ ]` idea / `[~]` in progress / `[x]` done / `[-]` decided
against. Add a date when status changes.

---

## Thinking & models

- [ ] **Three-mode thinking system (Real / Simulated / None).** Per-task mode
  registry + `judgmentModel` and `fastModel` slots so reasoning models drive
  judgment tasks while instruct models drive conversation. Strip `<think>`
  blocks, surface native reasoning into the thought slot, add a global
  `reasoning_effort` selector. Full design exists — Stages 0-5 with
  Sonnet/Opus split (see chat history). Files: `api.js`, `turns.js`,
  `memory.js`, `documentWriting.js`, `session.js`, `preflight.js`,
  `ConnectionPanel.jsx`, `constants.js`, `state.js`. Size: large (5 stages).
- [ ] **Per-actor `model` / `thinking` override.** Mirror the existing
  `actor.temperature` / `actor.maxTokens` pattern so one actor can use a
  thinking model while others don't. Small add once the three-mode system
  exists. Files: `state.js`, `constants.js`, `ActorsPanel.jsx`, `turns.js`.
  Size: small.
- [ ] **Try Qwen3-Embedding-0.6B as drop-in vs Nomic v1.5.** Empirical A/B on
  real session archives for fact dedup + chunk recall. No code change yet —
  just a measurement. Size: small.

## Orchestration & scheduling

- [ ] **Two-step intent pass + speaker scoring.** Each enabled actor emits a
  tiny `{desire_to_speak, target, intent, reason}` blob; orchestrator picks
  one based on score. Highest-ceiling architectural change — most other
  scheduling improvements fall out for free. Files: `turns.js` (round loop),
  new scheduler module. Size: large.
- [ ] **Addressee-driven next-speaker routing.** Regex/parse `@Name` or "Bob,
  what do you think?" in the latest message; bump that actor's priority.
  Cheap, big naturalness win even without the two-step pass. Files:
  `turns.js`. Size: small.
- [ ] **Backchannels.** `actor.backchannel: true` schema flag — when enabled
  the actor can emit a short acknowledgment ("Agreed.", "Hold on —")
  instead of a full paragraph. Drops max_tokens, skips full prompt context.
  Files: `schemas.js`, `turns.js`, `ActorsPanel.jsx`. Size: medium.
- [ ] **Dominance / participation balancing.** Track turns-per-actor, subtract
  a dominance penalty from the scheduler score so chatty actors don't
  monopolize. Trivial once intent-pass exists. Files: `turns.js`. Size: small.
- [ ] **Conversational repair.** When `openQuestions` has an entry that's
  stayed unanswered for N turns, nudge the next speaker to address it.
  Files: `turns.js`, `memory.js`. Size: small.
- [ ] **Adjacency-pair routing.** Question → answer, then control returns
  upward instead of cascading. Linguistic concept worth encoding as a
  scheduler rule. Files: `turns.js`. Size: small.

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
  plumbing existing data through to the UI. Files: `turns.js` (persist
  reason), `Transcript.jsx`. Size: small.
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
