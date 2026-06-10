# Forum — Codebase Review & Roadmap

A fresh, detailed review of the codebase (2026-06-10), followed by two roadmaps:
one for improving what exists, one for future additions. Complements `IDEAS.md`
(the feature backlog) — this document is about engineering health, system-level
verdicts, and sequencing.

**Verified baseline:** 342/342 tests pass, `npm run lint` clean, `npm run build`
works — but `npm ci` **fails on a clean checkout** and the last five CI runs on
`main` and the dev branch are **red**. `npx tsc --noEmit` also fails. Details in
Part 1.

## Status update (2026-06-10)

Landed on this branch (each with tests where applicable; suite now 364):

- **P0 complete:** `npm ci` fixed (eslint-plugin-react removed, lockfile
  regenerated), `tsc --noEmit` green and added to CI, doc rot fixed
  (§1.1 items 1–3).
- **P1:** SSRF redirect/DNS-rebinding guard + upstream stream cancellation in
  `server.js` with its first test suite (§1.2 items 2–3, §1.5 item 17.2 in
  part); multi-edit replace corruption fixed in the document writer;
  crash-loop escape hatch added to the error boundary; theme/density/accent
  persisted (§1.4 item 13).
- **P2 (agent report):** intent pass demoted to the `think` tier; @mention
  word-boundary + dominance penalty in speaker scoring; facilitator-directive
  de-escalation; scribe activity gate; grammar-constrained memory summarizer;
  auto-`extractOutcomes` on goal completion.

Second batch (same day, suite now 377):

- **Pipeline integration harness** (§1.5 item 19, adapted): the real turn
  loop — state, api, resolver, prompt assembly, result application — runs
  against a mock LM Studio with only `fetch` stubbed. Covers turn order,
  routing reasons, call counts, envelope schemas, result application,
  prompt-prefix stability, and byte-exact system-prompt snapshots per role.
  (A browser-level Playwright e2e remains open; module-level loop coverage
  is what the refactors below required.)
- **KV-cache prompt restructure** (agent report rec. #1): prompt sections
  stability-sorted; goal progress + plan step moved out of the prompt head
  into a post-transcript block; per-turn intent hints moved from the system
  prompt to the user tail; high-confidence intent selection no longer swaps
  skip-rule fragments. Each actor's system prompt is now byte-stable across
  turns — verified by harness tests.
- **Capability-composed askActor** (agent report rec. #3): new
  `turns/actorPrompt.js` owns system-prompt assembly; the four-way fork and
  4× duplicated background block are gone; a Manager who `canResearch` now
  actually receives research instructions and tool access. Byte-exact role
  snapshots prove single-capability prompts are unchanged.
- **Round Cost telemetry** (agent report rec. #2, first half): per-round
  LLM call/token/error aggregates in `diagnostics.roundCallStats` plus a
  Telemetry card with a calls-per-round sparkline. The "then cut" half —
  per-round intent mini-plans, two-stage scribe judge — remains open.

Third batch (same day, suite now 393):

- **Intent mini-plan** (agent report rec. #2, second half): the intent pass
  can return up to two follow-up speakers, validated and queued so the rest
  of the round routes via the free handoff path — at most one routing call
  per round instead of one per ambiguous turn.
- **Two-stage scribe judge** (rec. #2): a ~60-token fast-tier recordability
  gate runs before the reason-tier draft call; negative gates consume the
  transcript marker, gate errors fail open.
- **Document semantic retrieval** (Part 2 verdict + IDEAS): over-budget
  reference docs now contribute embedding-ranked paragraph excerpts instead
  of top-of-file truncation; per-content-hash doc vectors and a per-round
  rendered-section cache preserve KV-prefix stability; full fallback chain
  to the even split.
- **Versioned state migrations** (§1.3 item 9): `modules/migrations.js`
  scaffold with `schemaVersion` stamping; objective→task and
  autoStop.goal→doneWhen moved as the proving case; remaining inline
  migrations move incrementally as touched.

Fourth batch — MCP tools, Phase 1 (same day, suite now 417):

- **MCP host in the proxy** (`mcpHost.js`): servers declared in an optional
  `mcp.config.json` (stdio or HTTP transport) are connected lazily; their
  tools are namespaced `mcp:<server>.<tool>`, listed via `GET /api/mcp/tools`,
  and executed through the existing `/api/tool-execute` route with the same
  untrusted-content wrapping and size cap as `web_read`. The config file is
  the only way to add servers — no UI or API write path.
- **Generic `[TOOL: name {json}]` text-tag protocol**: extends the
  grammar-compatible tag approach; only registry-known names ever execute.
  The parser handles both raw and envelope-escaped arg forms (tags live
  inside the JSON thought string, so quotes arrive escaped — JSON.parse is
  used as the boundary oracle).
- **Client tool registry** (`modules/tools.js`): MCP tools discovered at
  connect time feed both the parser allowlist and an additive
  "additional tools" prompt section for research-capable actors (director /
  manager+research / researcher), KV-prefix-stable.
- Phase 2 (per-actor `toolGrants`, editor UI, migration) and Phase 3
  (intent-routing boost, tool-call telemetry) remain open.

Two corrections to this report from implementation:

- §1.2-1: a top-level error boundary **already existed** in `main.jsx` (missed
  in review). What was missing — and is now added — is the crash-loop escape
  hatch (clear saved state & reload).
- §1.3-6: the selector-equality fix is **unsafe as written**: state is mutated
  in place, so a selector returning `s.messages` can see an unchanged array
  reference after an in-place edit and skip a needed re-render. It must wait
  for (or be coupled with) immutable-update discipline in `mutateState`
  callers. Re-classified to Phase 3.

---

## Part 1 — Key improvements

Ordered by severity within each section. Sizes: S (< 1 day), M (1–3 days),
L (1–2 weeks).

### 1.1 Broken right now (P0)

| # | Problem | Evidence | Fix | Size |
|---|---|---|---|---|
| 1 | **`npm ci` fails → CI is red on every branch.** `eslint-plugin-react@^7.37.5` is still in `package.json` (devDependencies) and its peer range (`eslint ^3–^9.7`) conflicts with `eslint@10.4.1`. CLAUDE.md explicitly documents this plugin as "intentionally absent" — it was never removed from the manifest. | `package.json:64`; last 5 workflow runs on `ci.yml` concluded `failure`; local `npm ci` reproduces the ERESOLVE error | Remove `eslint-plugin-react` from `package.json`, regenerate `package-lock.json`, confirm `npm ci && npm test && npm run lint && npm run build` green | S |
| 2 | **`tsc --noEmit` errors** (TS5101: `baseUrl` deprecated under TypeScript 6.x) — and typecheck is not in CI at all, so TS regressions in the `.ts` files go unnoticed. | `tsconfig.json:15`; `.github/workflows/ci.yml` runs only lint/test/build | Drop `baseUrl` (use `"paths": {"@/*": ["./src/*"]}`), add `npx tsc --noEmit` as a CI step | S |
| 3 | **Documentation rot.** README's architecture section lists `src/modules/preflight.js` (doesn't exist), describes `turns.js` as a monolith (it's now `turns/` submodules), and names hooks as `.js` (they're `.ts`). CONTRIBUTING.md hardcodes "All 342 tests". CLAUDE.md names a stale dev branch. | `README.md:201-214`, `CONTRIBUTING.md:24`, `CLAUDE.md:7` | One docs pass; stop hardcoding test counts | S |

### 1.2 Robustness & correctness (P1)

1. **No React error boundary.** A single render error white-screens the app —
   and because state is rehydrated from localStorage at boot, a poison message
   or corrupt state entry could crash-loop with no way out short of clearing
   site data. Add a top-level boundary with a "reset UI state / export state"
   escape hatch, plus per-panel boundaries so one broken inspector panel can't
   take down the transcript. (`App.jsx` has no boundary; no
   `componentDidCatch`/`ErrorBoundary` anywhere.) **Size: S–M**

2. **SSRF gap in `web_read`.** `isBlockedUrl()` validates only the *initial*
   URL; the fetch then uses `redirect: "follow"` (`server.js:289-293`), so a
   public URL that 302-redirects to `http://127.0.0.1:1234/...` or
   `http://192.168.x.x/...` sails through the blocklist. DNS rebinding
   (public hostname resolving to a private IP) is also unchecked. Fix: follow
   redirects manually with a per-hop `isBlockedUrl` check, and resolve DNS +
   verify the resulting IP before fetching. Low-stakes for a localhost-only
   tool, but it's the one real security hole and it's cheap to close.
   **Size: S**

3. **Streaming proxy doesn't cancel upstream.** In `proxyChat`
   (`server.js:167-170`), when the browser disconnects mid-stream the
   `for await` loop keeps draining LM Studio — the local model keeps
   generating tokens nobody will see. Abort the upstream fetch on
   `res.on('close')`. **Size: S**

4. **Stop conditions for a dead backend.** During auto-run, if LM Studio goes
   away, every turn burns 3 retries with countdown waits before failing, every
   round. Add a circuit breaker: after N consecutive transport failures, stop
   the auto loop with a clear toast instead of grinding. (`turns/pipeline.js:189-210`)
   **Size: S**

5. **Schema-support cache is per-session.** `_schemaSupportByModel`
   (`api.js:165`) re-probes `response_format` support on every reload — one
   wasted failing request per model per session. Persist it in
   `state.settings` keyed by model id. **Size: S**

### 1.3 Architecture (P1–P2)

6. **Re-render storm: no selector equality in the store bridge.**
   `useForumState` (`useForumState.ts:24-27`) subscribes every component to a
   global version counter — *every* `mutateState`/`saveState` anywhere
   re-renders *every* subscribed component, regardless of whether its slice
   changed. `React.memo` on `MessageCard` absorbs most of the damage in the
   transcript, but the inspector panels, topbar, and composer all re-run on
   every status tick during generation. Fix without changing architecture:
   `useSyncExternalStoreWithSelector` (ships with React as
   `use-sync-external-store/with-selector`) with shallow equality. **Size: M**

7. **Layering rule isn't enforced — and is already violated.** The documented
   rule is "components never import modules directly, only hooks." Violations:
   `Composer.jsx:6` (turns), `ActorsPanel.jsx:5` (db), `ConnectionPanel.jsx:5`
   (api), `PromptViewerPanel.jsx:3` (turns), `LibraryPanel.jsx:4` (blueprints).
   Decide the real rule (pure helpers like `renderMarkdown`/`BLUEPRINTS` are
   probably fine; side-effectful modules are not), then **enforce it
   mechanically** with ESLint `no-restricted-imports` per directory so it
   can't drift again. **Size: S–M**

8. **`saveState()` is called too often and serializes everything.** The whole
   state tree is `JSON.stringify`-ed to localStorage; hot paths call it
   directly and repeatedly (e.g. `setAutoStopStatus` → `saveState` on every
   status message, `evaluateAutoStopAfterRound` calls it 4×). The quota
   fallback (`state.js:371-391`) sheds diagnostics arrays — evidence the
   ceiling is real. Plan: (a) make *all* persistence go through one debounced
   write path; (b) move the large append-only arrays (`diagnostics.apiCallLogs`,
   `transitions`, `parseFailures`) out of the localStorage blob into IndexedDB
   where messages/chunks/sessions already live. Longer-term verdict in Part 2.
   **Size: M**

9. **`normalizeState` is a 340-line migration funnel** (`state.js:46-342`)
   mixing defaults, normalization, and ~8 generations of legacy migrations
   (mode→systems, document→documents[], dm→actor, objective→task,
   on_every_turn→cadence…). Every load pays every migration, forever, and no
   migration is individually testable. Replace with a versioned pipeline:
   `state.schemaVersion: number` + ordered `migrations[]`, each a tested pure
   function; `normalizeState` keeps only shape-defaulting. Old migrations can
   then be retired on a schedule. **Size: M**

10. **`askActor` is a 360-line four-way fork** (`turns/pipeline.js:796-1156`).
    The director/manager/researcher/participant branches each hand-assemble a
    system prompt, and the `BACKGROUND MODE` prefix block is copy-pasted four
    times (lines 895-903, 940-948, 1007-1015, 1133-1141), as is the schema
    line and trigger-block suffix. Replace with composable role profiles: a
    declarative list of prompt sections per role, one assembly function, one
    background-mode decorator. This is the highest-leverage refactor in the
    pipeline — it makes prompt logic testable and makes the next role (writer?
    devil's advocate?) a data change instead of a fourth copy. **Size: M–L**

11. **Concurrency control is scattered across five mechanisms:**
    `_pipelineActive` + `_stopFlag` + `abortController`/`_sessionController`
    (pipeline.js), the `scheduleChat`/`scheduleEmbed` promise chains (api.js),
    `memory.isSummarizing` (memory.js), `busy` (uiStore), and a 50 ms
    `setTimeout` to resume after pause (`pipeline.js:38-46`). It works — the
    code is visibly careful — but every new feature must thread all five, and
    the comments admit prior races. Consolidate into one small run-controller
    (states: `idle → running(turn|round|auto) → stopping`) that owns the
    AbortController and emits events the UI subscribes to. **Size: L**

12. **Two JSON-repair stacks doing the same job.** `api.js` has truncation
    detection + resume-retry (`chatJson`), while `memory.js` has its own
    `parseMemoryJson`/`repairTruncatedJson`/`extractBalancedObjects` stack —
    and the memory summarizer still uses *prompt-and-pray*
    (`chatCompletion` + hand parsing) even though grammar-constrained
    `chatStructured` exists and works (judgeGoal uses it). Migrate
    `summarizeMemory` and `extractOutcomes` to `chatStructured` with a real
    schema, then collapse the repair helpers into one utility. Bonus: fixes the
    IDEAS-documented "summarizer hits token cap and gets truncated" failure
    mode at the root. **Size: M**

### 1.4 UI & UX (P2)

13. **Theme/density/accent are not persisted** — plain `useState` in
    `App.jsx:82-84`; every reload resets to dark/comfy/amber. Move into
    `state.ui` (one-liner each) or localStorage. **Size: S**

14. **Transcript has no virtualization** (`Transcript.jsx:445-473`). Memoized
    cards keep CPU sane, but the DOM grows unboundedly — IDEAS documents a
    218-message session, and every message renders sanitized markdown,
    thought blocks, and action buttons. Add windowing (e.g. `virtua`, or
    manual “render last N + sentinel” since scroll-to-bottom is the dominant
    mode). **Size: M**

15. **Accessibility pass.** Modals are plain `div.modal-overlay` (no
    `role="dialog"`, no focus trap, no focus restore — `App.jsx:452-461`);
    message actions are icon-only buttons with `title` rather than
    `aria-label`; the global Enter-to-continue handler (`App.jsx:168-184`)
    fires generation from any non-editable focus target, which will surprise
    keyboard/screen-reader users. **Size: M**

16. **`index.css` is a 2,954-line monolith.** Tokens/variables are good, but
    discoverability suffers. Optional: split by component area; or adopt CSS
    modules for new components only. Cosmetic, lowest priority. **Size: M**

### 1.5 Testing & CI (P1)

17. **Coverage map has the wrong shape: the riskiest code is the least
    tested.** Well-covered: utils, schemas, memory helpers, state
    normalization, session helpers, registry. Untested: **pipeline
    orchestration** (`runRound`, `runAutoLoop`, `evaluateAutoStopAfterRound`,
    retry/abort paths), **server.js** (0 tests — including the SSRF guard and
    SSE proxy), **db.js** (IndexedDB), all **components** (0 tests),
    telemetry, blueprints, storyMode, the three TS stores. Priorities:
    1. Pipeline integration tests with a mocked `api.js` — assert turn order,
       stop conditions, goal-judge verdict handling, abort mid-round.
    2. `server.js` endpoint tests with a stub upstream (node:test + fetch) —
       lock down `isBlockedUrl`, `cleanBaseUrl`, CSRF, the static-path guard.
    3. `fake-indexeddb` for db.js.
    4. Component smoke tests (@testing-library/react) for Transcript +
       Composer + one inspector panel.
    **Size: L (incremental)**

18. **CI gaps:** no typecheck step, no coverage reporting, single Node
    version, and (until #1 is fixed) it doesn't even install. Target workflow:
    `npm ci` → `tsc --noEmit` → lint → test (with coverage artifact) → build,
    on Node 20 + 22. An `electron-builder` smoke job can be a later nightly.
    **Size: S**

19. **No end-to-end harness.** The app's core loop (compose → resolve speaker
    → stream → parse envelope → apply result → memory cycle) is only ever
    exercised by hand against a live LM Studio. A tiny mock LM Studio (one
    file: OpenAI-compatible `/v1/chat/completions` with canned SSE) +
    Playwright would make the full loop regression-testable and unlock CI
    confidence for refactors #10/#11. **Size: L**

### 1.6 Distribution (P3)

20. **Electron packaging ships the world.** `package.json` `build.files`
    includes `node_modules/**` wholesale (minus two excludes) — dev
    dependencies and all. Fix the files list / rely on electron-builder's
    pruning; verify installer size before/after. Also missing: CSP on the
    served app, app menu, code signing, and any update story (the
    `Launch Forum.command` does `git pull` — fine for dev, not an update
    mechanism). **Size: M**

---

## Part 2 — System verdicts: replace, refactor, or keep

Explicit calls on the load-bearing systems, with plans where replacement is
warranted.

| System | Verdict | Why & plan |
|---|---|---|
| **State layer** (mutable global + version-counter store + `useSyncExternalStore`) | **Keep, harden** | The three-store split (stateStore / useForumState / uiStore) is clean, framework-agnostic, and well-understood. A Redux/Zustand rewrite would churn all 23k lines for marginal gain. Plan: add selector equality (#6), enforce layer boundaries with lint (#7), single debounced persistence path (#8). Revisit only if selector bailout proves insufficient. |
| **localStorage persistence** | **Replace (gradually) with IndexedDB** | Whole-tree JSON into a ~5 MB synchronous store, with quota fallbacks already shedding data, is the weakest storage decision in the app — especially when IndexedDB infrastructure (db.js, stores, fallbacks) already exists and holds messages/chunks/sessions. Plan: Phase A — move diagnostics arrays out of the blob (small, immediate relief). Phase B — persist the full state object to an IndexedDB `app-state` store with a localStorage mirror only for the tiny boot-critical settings (baseUrl, model, theme). Keep `normalizeState` as the single rehydration gate. |
| **`normalizeState` migration funnel** | **Refactor** | Versioned migration pipeline (#9). Not urgent, but every new migration added to the current funnel raises the cost of eventually doing this. |
| **`askActor` prompt assembly** | **Refactor** | Role-profile composition (#10). The four-way duplication is the main source of prompt drift between roles (e.g. researcher gets `security_directive`, manager gets `security_transcript`, participants get both styles — currently impossible to see at a glance). |
| **Pipeline concurrency** (flags + chains + timeouts) | **Refactor** | One run-controller state machine (#11). Do this *after* the e2e harness (#19) exists — it's exactly the kind of change that needs loop-level regression coverage. |
| **JSON envelope parsing/repair** (utils `parse*` family, memory repair, api truncation retry) | **Consolidate** | One repair utility + structured-output-by-default (#12). The grammar-constrained path (`response_format: json_schema`) is the right primary mechanism; hand parsing should be the fallback, not a parallel system. |
| **DuckDuckGo HTML scraping** (`server.js` web_search) | **Replace with a provider interface** | Scraping `html.duckduckgo.com` with cheerio selectors breaks silently the day the markup changes, and there's no signal when it does. Plan: `searchProviders = { ddg, searxng, brave }` behind one interface; DDG stays the zero-config default; SearXNG (self-hosted) and Brave (API key) as opt-ins; surface provider failures as a visible tool-result error rather than "No results". Dovetails with the MCP plan in IDEAS.md, which would eventually make search just another MCP tool. |
| **server.js** (zero-dependency proxy) | **Keep** | Right-sized for the job. Fix the redirect/DNS SSRF hop check (#2) and upstream cancellation (#3); add tests (#17.2). Don't add Express. |
| **Markdown rendering** (marked + DOMPurify, strict allowlists) | **Keep** | Correctly sanitized at every `dangerouslySetInnerHTML` site (all go through `renderMarkdown`). No action beyond optional per-message memoization. |
| **Memory system** (summarize → chunk → embed → recall) | **Keep, tune** | Architecture is sound (incremental summary + hybrid recall + model-mismatch detection is genuinely good). Needed: structured-output summarizer (#12), chunk-store retention policy (it grows forever — add archive cap + compaction pass), auto fact-compaction trigger (IDEAS already specifies it: fire `compactPinnedFacts` at >60 facts), and the open-question dedup from IDEAS. `getAllChunks()` per turn is fine to ~1k chunks; revisit with a real local vector index only if sessions get an order of magnitude longer. |
| **Electron shell** | **Keep, polish** | Security posture is right (contextIsolation on, nodeIntegration off, external links to system browser). Packaging hygiene + CSP (#20). |
| **CSS monolith** | **Keep** | Annoying, not harmful. Split opportunistically. |

---

## Part 3 — Improvement roadmap

Sequenced so each phase de-risks the next. Estimates assume one developer.

### Phase 0 — Stop the bleeding (1–2 days)
1. Remove `eslint-plugin-react`, regenerate lockfile, get CI green (#1).
2. Fix `tsconfig.json` `baseUrl` deprecation; add `tsc --noEmit` to CI (#2, #18).
3. Docs pass: README architecture section, CONTRIBUTING test count, CLAUDE.md branch (#3).
4. Persist theme/density/accent (#13).

### Phase 1 — Robustness floor (1–2 weeks)
5. Top-level + per-panel error boundaries with safe-mode reset (#1.2-1).
6. SSRF redirect/DNS hop checks + upstream stream cancellation + auto-run circuit breaker (#1.2-2/3/4).
7. server.js endpoint test suite (#17.2) — written against the fixes above.
8. Single debounced persistence path; diagnostics arrays → IndexedDB (#8, Phase A of storage plan).
9. ESLint `no-restricted-imports` layer enforcement (#7).
10. Selector equality in `useForumState` (#6).

### Phase 2 — Testability, then the big refactors (3–6 weeks)
11. Mock LM Studio + Playwright e2e harness (#19) — *prerequisite for 12–14*.
12. Pipeline integration tests with mocked api (#17.1); fake-indexeddb db tests; component smoke tests.
13. `askActor` → role-profile prompt composition (#10).
14. Structured-output summarizer/outcomes + unified JSON repair (#12).
15. Versioned state migrations (#9).
16. Transcript virtualization (#14) and accessibility pass (#15).

### Phase 3 — Structural investments (quarter horizon)
17. Run-controller state machine replacing scattered concurrency flags (#11).
18. IndexedDB-backed full state persistence (storage plan Phase B).
19. Incremental TypeScript migration: `utils` → `schemas` → `db` → `memory` first (pure, well-tested modules), `checkJs: true` once the noise is manageable.
20. Memory retention: chunk compaction, auto fact-compaction, open-question dedup.
21. Electron packaging hygiene, CSP, signing (#20).
22. Coverage reporting + Node 20/22 matrix in CI.

---

## Part 4 — Future additions roadmap

Builds on `IDEAS.md` (which remains the fine-grained backlog); this is the
strategic sequencing. Horizon 1 items are deliberately small and compounding;
Horizon 2 items each open a new capability; Horizon 3 are directional bets.

### Horizon 1 — Compounding quality-of-life (next 4–6 weeks, parallel to Phase 1–2)
- **Per-actor model override** (IDEAS) — the API already accepts `model`;
  thread it through `askActor`. Unlocks heterogeneous casts (fast model for
  banter actors, reasoning model for the director) — the single biggest
  quality/cost lever for local multi-actor sessions.
- **Auto fact-compaction trigger + memory correction UI** (IDEAS) — directly
  addresses the documented 129-pinned-facts failure mode.
- **"Why did this actor speak?" chip + persisted intent log** (IDEAS) — the
  routing data already exists on `state.lastIntent`; surfacing it makes the
  orchestration debuggable by users, and the event-sourced intent log enables
  later replay tooling.
- **Force-ask / @-mention affordances** (IDEAS) — composer chips + actor
  context menu; routing support already exists.
- **Session Outcome synthesis doc** (IDEAS) — one pass that turns
  outcomes/anchors/open questions into a shareable document; highest
  user-visible payoff per unit effort.
- **Devil's Advocate preset + sycophancy detector** (IDEAS) — preset is a
  blueprint entry; detector reuses the embedding infra.
- **Library/Sessions panel unification** (IDEAS has the full design) — one
  browse-and-preview surface for blueprints / saved setups / sessions, with
  per-item export.

### Horizon 2 — New capabilities (quarter)
- **MCP client integration** (IDEAS has the architecture; endorse it).
  `src/modules/mcp.js`, per-session server configs, tool blocks injected into
  prompts as text-tags, generalized tag interception in the turn loop. This
  subsumes the bespoke web_search/web_read path over time and is the natural
  home for the pluggable-search replacement (Part 2). Sequence *after* the
  askActor refactor (#10) so tool blocks compose cleanly.
- **Multi-backend support.** Today the app is LM Studio-shaped (its `/api/v0`
  extended endpoints power model info/loading). Abstract a backend interface:
  generic OpenAI-compatible (llama.cpp server, vLLM), Ollama (native API for
  model listing/loading), and optionally cloud providers behind an explicit
  opt-in (the privacy stance of "fully local" is a feature — keep it the
  loud default). Most of the work is isolating the `/api/v0` enrichments
  behind capability detection, which `pingConnection` half-does already.
- **Document semantic retrieval** (IDEAS) — embedding-ranked top-k of
  document paragraphs replacing the even-cap allocation; biggest remaining
  retrieval upgrade.
- **Session replay & diffing.** With the intent log persisted (Horizon 1) and
  sessions event-sourced in IndexedDB, add a replay scrubber: step through a
  session turn by turn, inspect each prompt/verdict. Pairs with the existing
  fork-at-message feature into a proper branch-compare view.
- **Benchmark/eval harness.** Scripted scenario + fixed seed + mock-or-real
  model → scored transcript (parse-failure rate, skip rate, alignment,
  outcome extraction success). Turns the IDEAS "empirical measurements"
  section into repeatable CI-adjacent tooling, and gives every prompt-fragment
  edit a regression check.

### Horizon 3 — Directional bets (6+ months, pick deliberately)
- **Narrative systems:** dynamic narrative branching with actor voting; Lore
  Synthesizer for worldbuilding sessions (both sketched in IDEAS). These push
  the product toward the "Narrative/Simulation" pillars the app's own actors
  identified.
- **Shared sessions:** export today is JSON files; the step-change is
  read-only session publishing (static HTML export of a transcript +
  outcomes) and later live spectating over the local network. Multi-*user*
  editing is a large lift — treat as research, not commitment.
- **Plugin surface:** once MCP (tools) + prompt registry (prose) + blueprints
  (configs) are stable, a packaged "scenario pack" format (blueprint + prompt
  overrides + documents + MCP config) becomes a community-shareable unit —
  the highest-leverage growth feature if the project goes public.
- **Voice mode:** local STT (whisper.cpp) in, per-actor TTS out. Pure
  presentation-layer addition once the streaming store is stable; high demo
  value for the simulation/roleplay pillars.

### Explicitly not recommended
- **Redux/Zustand rewrite** — the current store is sound; fix re-render
  granularity instead (#6).
- **Express/framework on the server** — zero-dependency proxy is a feature.
- **Raw-message RAG second recall channel** — IDEAS already evaluated and
  rejected it; nothing in this review changes that.
- **Cloud-by-default inference** — local-first is the product's identity;
  any cloud backend must stay opt-in and clearly labeled.
