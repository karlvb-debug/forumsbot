# Plan: Routing, Prompt, Validation & Context Features

**Status:** Ready for implementation
**Verified against:** `main` after the dead-code cleanup + merge (commit `3d3c8f6` line numbers; re-confirm by symbol name if files have moved).

This plan covers ten features drawn from AutoGen, Agnai, and CrewAI, plus the prose prompt-gaps. **Three items in the source lists were duplicates** and are consolidated here (planning pre-pass = CrewAI #12 = gap #8; validation retry = CrewAI #13 = gap #5). Each feature below is independent unless a dependency is noted, so they can ship in separate commits.

---

## Instructions for the implementing agent (read first)

This spec is detailed enough that the model/IDE is not the risk — the risk is an executor that drifts outside the named edits. Follow these rules; they matter more than speed.

1. **No refactors outside the named edits.** Implement only what each feature section specifies. Do **not** "improve while you're in there." This codebase has subtle prompt-budget/degradation logic and a mutable singleton-state pattern (`src/modules/state.js`); incidental cleanups silently change behaviour. If you spot a real bug outside scope, note it in your summary — do not fix it in the same commit.

2. **Anchor on symbol names, not line numbers.** Every line number here was verified against commit `3d3c8f6`, but **line numbers drift the moment you start editing**. Locate each edit by its function/const name (`resolveIntent`, `applyAiResult`, `buildPromptContext`, `askActor`, `scoreCandidates`, `getPromptBudget`, `INTENT_SCHEMA`, `buildActorSchema`, `normalizeState`) and treat the cited numbers as a starting hint only.

3. **Preserve byte-parity until a gate fires.** Every feature must leave existing sessions behaving **identically** until its new field/gate is actually used. Default prose, default state, and default control flow stay unchanged. When filling defaults, copy current wording verbatim — do not paraphrase existing prompt strings.

4. **Add a `normalizeState` default for every new state field.** New fields (`exampleDialogue`, `scenario.plan`, the extended `pendingInjections` entry shape, any schema additions) **must** get a default in `state.js` `normalizeState` (mirror the merge patterns at `state.js:85` and the actor block `288–326`), or loading an existing saved session will break. Test this explicitly (load a legacy state with the field absent → no throw, default present).

5. **Respect mode and cost gates.** The features that add API calls (E planning pre-pass, F/H retries, G emergency summarize) must honour their guards — `hasTask()`, `isRoleplayMode()`, `state.settings.turboMode`, and the over-budget / `isSummarizing` checks. Never run a paid pre-pass or retry unconditionally.

6. **One feature per commit, in the suggested order.** After each feature, run `npm run test` **and** `npm run build`, and only then commit and move on. Keep commits self-contained so any one can be reverted without unpicking the others.

7. **Prove parity on the cheap features first.** Implement and push **I → D → C → B** before touching anything that adds API calls (E) or edits the turn loop / memory (F, G, H). These four are low-risk and exercise the field-wiring, prompt-assembly, and schema patterns the later features reuse — they're the checkpoint for confirming the parity discipline above is being followed. Do not start E/F/G/H until the first four are green.

8. **Coordinate the schema and `askActor` touch-points.** F and H both extend `askActor`'s `options` — land F first so `options.correction` exists, then H adds `options.maxTokensOverride` alongside it. A and H both edit `INTENT_SCHEMA` — make those additions (`stuck`, optional `expectedOutput`) in a single coherent edit if doing them close together.

9. **If the prompt-editing registry (`PROMPT_EDITING_PLAN.md`) is being built in parallel,** author feature **I**'s prose as registry defaults rather than inline literals, so the wording isn't written twice. If this plan ships first, the registry work lifts them later.

---

## 0. Consolidated feature index

| ID | Feature | Source | Mode | Adds API calls? | Effort |
|----|---------|--------|------|-----------------|--------|
| **A** | Intent-pass retry with corrective feedback | AutoGen #2 | both | +0–1 per ambiguous turn | S |
| **B** | Authoritative typed `nextSpeaker` handoff (+ enum constraint) | AutoGen #3 | both | none | S (mostly exists) |
| **C** | Post-history persona reminder (last line before generation) | Agnai #6 | both, worded by mode | none | S |
| **D** | Per-actor `exampleDialogue` field | Agnai #7 | both | none | S |
| **E** | Planning pre-pass (3–5 step spine) | CrewAI #12 / gap #8 | **work only** (`scenario.task` gate) | +1 per session | M |
| **F** | Output guardrails + retry | CrewAI #13 / gap #5 | both | +0–1 per turn | M |
| **G** | Emergency mid-round context summarization | CrewAI #14 | both | +0–1 when over budget | M |
| **H** | Expected-output-per-turn + dynamic maxTokens | CrewAI #15 | both | none | M |
| **I** | Prose prompt-gaps (identity / anti-meta / memory caveat / loop `stuck` / anti-repetition / proactivity) | gaps #1–4,6,7 | mixed | none | S |

**Mode-gating helper.** Several features branch on roleplay vs. work mode. The existing signal is `state.scenario?.systems?.stageDirections?.enabled` (call it `stageDirectionsEnabled`) and `String(state.scenario?.task || '').trim()`. Define one helper near the top of `turns.js` and reuse it:

```js
// true = roleplay/story session; false = analytical/work session
function isRoleplayMode() {
  return !!state.scenario?.systems?.stageDirections?.enabled;
}
function hasTask() {
  return !!String(state.scenario?.task || '').trim();
}
```

---

## A. Intent-pass retry with corrective feedback

**Problem.** `resolveIntent()` (`turns.js:367`) matches the model's chosen speaker name case-insensitively (`turns.js:~441`):

```js
const matched = available.find(a => a.name.toLowerCase() === speakerName.toLowerCase());
return { actor: matched || null, conclude: false, data: state.lastIntent };
```

When a small model hallucinates a name or picks someone who already spoke, `matched` is `null` and the pick is **silently discarded** — routing falls through to deterministic scoring, losing the model's reasoning.

**Fix.** Wrap the `chatStructured` call in `resolveIntent` in a one-shot corrective retry. On a mismatch (name set, not `NONE`, no actor match) **or** a same-actor-as-last pick, re-ask once with an error message naming the valid options.

**Implementation** (`resolveIntent`, around the existing `chatStructured` call ~`turns.js:424`):

```js
const validNames = available.map(a => a.name);
let data, attempt = 0;
let correction = '';
while (attempt < 2) {                     // original + 1 retry
  const userMsg = correction ? `${user}\n\n${correction}` : user;
  data = await chatStructured(intentSystem, userMsg, INTENT_SCHEMA, {
    temperature: 0.2, maxTokens: 160, signal, tier: 'reason', purpose: 'intentPass',
  });
  const name = String(data?.speaker || '').trim();
  const isNone = !name || name.toUpperCase() === 'NONE';
  const matched = isNone ? null : available.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (isNone || matched) break;           // good (NONE is a valid answer)
  correction = `"${name}" is not a participant. Choose exactly one of: ${validNames.join(', ')} — or NONE. Return the name verbatim.`;
  attempt++;
  logWarning?.(`[intent] corrective retry: "${name}" not in roster`);
}
```

Keep the existing match/return logic after the loop unchanged. The retry only fires when the first pick is invalid, so cost is +0 on the common (valid) path.

**Mode:** both. **Risk:** low — terminal fallback (null → scoring) is preserved.

---

## B. Authoritative typed `nextSpeaker` handoff

**Already ~70% built.** `applyAiResult()` (`turns.js:2267–2282`) already prepends a valid `result.nextSpeaker` to the front of `state.turnQueue`, and `resolveNextSpeaker()` (`turns.js:478–485`) consumes it as the **tier-3 "handoff"** step *before* intent-pass and scoring. It has self-route and just-spoke loop guards. So it is already authoritative when the name is valid.

**Two gaps to close:**

1. **Constrain to an enum so the model can't misname.** In `schemas.js`, `buildActorSchema(actor, { allowNextSpeaker })` currently types `nextSpeaker` as a free string. Change it to an enum of current participant names plus `""`:

   ```js
   // in buildActorSchema, when allowNextSpeaker:
   nextSpeaker: { type: 'string', enum: [...enabledQueueActorNames, ''] },
   ```

   Thread the name list in from the caller (`askActor` already has `state.actors`). This makes typed handoff reliable on models that honor JSON-schema enums; the free-text fallback in `applyAiResult` still catches models that ignore the schema.

2. **Log dropped handoffs.** When `result.nextSpeaker` is set but matches no actor, it is silently ignored (`applyAiResult` else-branch never runs). Add a `logWarning` + a `state.diagnostics.parseFailures`-style note so misnamed handoffs are visible during tuning:

   ```js
   } else if (result.nextSpeaker && !targetActor) {
     logWarning?.(`[handoff] ${actor.name} named unknown nextSpeaker "${result.nextSpeaker}"`);
   }
   ```

**Confirm** `allowNextSpeaker` is enabled for participant actors when `allowDirectAddress !== false` (it is read at `applyAiResult:2274`); ensure `buildActorSchema` receives it for the participant path (`turns.js:~1758`).

**Mode:** both. **Risk:** low. Enum requires the valid-names list be passed into `buildActorSchema` everywhere it's called.

---

## C. Post-history persona reminder

**Goal.** Put a short "you are X" reminder as the **absolute last thing** the model reads before generating, since small models weight the prompt tail heavily and persona drifts on long transcripts.

**Insertion point (exact).** `buildPromptContext()` assembles the user block and joins blocks at `turns.js:2050`. The current tail order is (`turns.js:2041–2049`): `roleReminder` → `styleReminder` → turn instruction → `deferredNote` → `facilitatorDirective`. Add one more block **after `facilitatorDirective`** so it is last:

```js
// after facilitatorDirective, before the closing .join("\n\n")
const postHistoryReminder = kind === "actor" ? (() => {
  const bits = [actor.role && `${actor.name}, ${actor.role}`].filter(Boolean);
  const id = bits.length ? bits.join(' — ') : actor.name;
  return isRoleplayMode()
    ? `Stay in character as ${id}. Respond as them now — not about them.`
    : `You are ${id}. Answer in your own voice now.`;
})() : "";
```

Append `postHistoryReminder` to the returned array. Keep it ≤ ~20 words so it doesn't eat budget. **Note:** the budget-degradation ladder (§G / `turns.js:2061–2089`) trims *transcript/chunks*, never this tail block, so the reminder survives truncation — which is the point.

**Mode:** both, wording branches on `isRoleplayMode()`. **Risk:** low.

---

## D. Per-actor `exampleDialogue` field

**Goal.** Optional few-line sample of how a character speaks, for the model to imitate.

**Four edits (copy the `voice` field's wiring):**

1. **Default + normalize** — `state.js` actor normalization (`state.js:288–326`), insert after the `voice` line (~294):
   ```js
   exampleDialogue: actor.exampleDialogue || "",
   ```
   (Optional: add to `defaultState.actors` in `constants.js:170–201` if you want seeded examples; not required since normalize defaults it.)

2. **Type** — `src/types.ts` `Actor` interface (`types.ts:4–33`): add `exampleDialogue?: string;` (note: types.ts is already stale re: `maxTokens`/`cadence`, so this is best-effort).

3. **UI** — `ActorsPanel.jsx`, after the Voice field (`~311`), following the textarea pattern:
   ```jsx
   <Field label="Example dialogue" info="A few lines showing how this character talks. The model imitates the style.">
     <textarea rows={2} value={a.exampleDialogue || ''} onChange={(e) => updateActor(a.id, 'exampleDialogue', e.target.value)} />
   </Field>
   ```

4. **Inject into the prompt** — in `askActor`, participant system array (`turns.js:~1667`) and researcher (`~1587`), add after the voice/persona lines:
   ```js
   actor.exampleDialogue ? `How ${actor.name} speaks:\n${actor.exampleDialogue}` : "",
   ```

**Mode:** both. **Risk:** low.

---

## E. Planning pre-pass  ⭐  (work mode only)

**Goal.** One AI call at session start turns the task into a 3–5 step plan; each round the current step is injected so the group knows what phase it's in.

**Gate.** Run **only** when `hasTask()` is true and not `turboMode`. Pure roleplay (no `scenario.task`) skips it entirely — this is the mode guard from the compatibility analysis.

**State.** Add to `defaultState.scenario` (`constants.js`):
```js
plan: { steps: [], currentStep: 0, generatedAt: "" },   // discussion spine
```
(Add a normalize default in `state.js` scenario block.)

**Generator** (new fn in `turns.js`):
```js
export async function generateDiscussionPlan() {
  if (!hasTask() || state.settings.turboMode) return;
  if (state.scenario.plan?.steps?.length) return;   // already planned
  const system = "You produce a short discussion plan: 3–5 ordered phases that take a group from the task to a decision. Each phase is a short imperative clause.";
  const user = [
    `Task:\n${state.scenario.task}`,
    state.scenario.doneWhen ? `Done when:\n${state.scenario.doneWhen}` : '',
    state.scenario.premise ? `Context:\n${state.scenario.premise}` : '',
  ].filter(Boolean).join('\n\n');
  const schema = { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 } }, required: ['steps'], additionalProperties: false };
  const res = await chatStructured(system, user, schema, { temperature: 0.3, maxTokens: 200, tier: 'reason', purpose: 'planningPrePass' });
  mutateState(s => { s.scenario.plan = { steps: res.steps || [], currentStep: 0, generatedAt: new Date().toISOString() }; });
}
```

**Trigger.** Call `await generateDiscussionPlan()` once when a session first starts running — at the top of the run loop / `_runRound` before the first turn (guard with the `steps.length` check so it's one-shot).

**Inject.** In `buildPromptContext`, add a `planBlock` near `scenarioBlock` (top of the context so it frames everything):
```js
const planBlock = (state.scenario.plan?.steps?.length) ? (() => {
  const { steps, currentStep } = state.scenario.plan;
  const lines = steps.map((s, i) => `${i === currentStep ? '→' : ' '} ${i + 1}. ${s}`).join('\n');
  return `### Discussion plan (current phase marked →)\n${lines}`;
})() : "";
```

**Advance.** MVP: advance `currentStep` by one at each round boundary (in `_runRound` round-end, capped at `steps.length - 1`). Stretch: let `judgeGoal` or the Director advance it when the current phase is satisfied (reuse the existing round-end judge call rather than adding one).

**Mode:** work only. **Risk:** medium — keep the advance logic dead simple for MVP; the plan is guidance, not control flow.

---

## F. Output guardrails + retry

**Problem.** After `askActor` returns (`turns.js:~850`), the result goes straight to `applyAiResult` (`~888`) with **no message-quality check**. Empty/garbage messages are accepted; only JSON-truncation has a repair path (`api.js:665–699`).

**Fix.** Between `askActor` and `applyAiResult`, validate `result.message` and, on failure, re-ask the actor **once** with a concrete error. Cheap checks for MVP (no extra API call unless validation fails):

```js
function validateActorOutput(result, actor, { expectedOutput } = {}) {
  const msg = String(result?.message || '').trim();
  if (!msg && result?.action !== 'skip') return 'empty';
  if (msg && msg.length < 2) return 'too_short';
  if (/^(certainly|sure|okay|as an ai)\b/i.test(msg) && msg.length < 25) return 'filler_only';
  // optional, stretch: pinned-fact contradiction check (costs a judge call — gate behind a setting)
  return null;
}
```

Retry wrapper (mirror the api.js truncation-retry style — one attempt, corrective user suffix):
```js
let result = await askActor(actor, signal, onStream, twoPhase, options);
const problem = validateActorOutput(result, actor, options);
if (problem) {
  logWarning?.(`[guardrail] ${actor.name} output failed: ${problem} — retrying once`);
  const fix = {
    empty: 'Your last reply was empty. Say something substantive now.',
    too_short: 'Your last reply was too short to be useful. Expand it.',
    filler_only: 'Your last reply was filler with no content. Make a concrete point.',
  }[problem];
  result = await askActor(actor, signal, onStream, twoPhase, { ...options, correction: fix });
}
```

`askActor` needs to accept `options.correction` and append it to the user/context block (one line, end of `buildPromptContext` input or as an extra system line). Log failures into `state.diagnostics.parseFailures` (reuse the existing array, `api.js:713`).

**Mode:** both (JSON/quality is mode-agnostic). **Risk:** medium — keep validators conservative so you don't loop on legitimate terse replies; the skip action must bypass the empty check.

---

## G. Emergency mid-round context summarization

**Problem.** Summarization only runs at cycle/round boundaries (`turns.js:907–912`, `1084–1085`). Between those, a long turn can push the prompt over budget, and the degradation ladder (`turns.js:2061–2089`) responds by **hard-dropping transcript/chunks/KB** — losing content rather than compressing it. There is **no mid-round emergency path**.

**Fix.** Add a pre-turn pressure check in the turn loop (before `askActor`, ~`turns.js:833`): if the last prompt came in near budget and there are un-summarized turns, run a summarize of the **oldest** messages first, then build the prompt.

```js
const budget = getPromptBudget();                       // turns.js:1833
const last = state.contextInfo?.lastPromptTokens || 0;
if (state.memory.enabled && !state.settings.turboMode &&
    last > budget * 0.9 && state.memory.turnsSinceSummary > 0) {
  logWarning?.('[context] emergency summarize — prompt near budget');
  await summarizeMemory('emergency', null, { signal: _sessionController?.signal });
  state.memory.turnsSinceSummary = 0;
}
```

`summarizeMemory` (in `memory.js`) already supports a mode argument (`"cycle"`/`"round"`); add an `"emergency"` mode that compresses the oldest N messages into the shared summary and marks them archived, so the degradation ladder has less to drop. This is a **safety net**, fire-and-await before the turn rather than fire-and-forget.

**Mode:** both. **Risk:** medium — guard against re-entrancy (don't trigger if `state.memory.isSummarizing`), and cap to one emergency per turn.

---

## H. Expected-output-per-turn + dynamic maxTokens

**Goal.** Let the Director/router set a concrete expectation for the next actor's turn ("list three risks", "write the full section") and raise the token cap when long output is genuinely needed — addressing your note that maxTokens is currently a hard per-actor limit with no per-turn override.

**Two parts:**

1. **Per-turn directive injection.** The Director already has CAP-1 prompt injections (`pendingInjections`, consumed in `buildPromptContext`). Extend the injection shape with optional `expectedOutput` and `maxTokens`:
   ```js
   // pendingInjections entry: { targetActorId, text, expectedOutput?, maxTokens? }
   ```
   In `buildPromptContext`, when an injection targets this actor, render `expectedOutput` as a directive near `intentHint`:
   ```js
   directive.expectedOutput ? `THIS TURN, produce: ${directive.expectedOutput}` : ""
   ```
   The intent pass (§A) can also emit it: add an optional `expectedOutput` string to `INTENT_SCHEMA` (`turns.js:340`) and stash it on `state.lastIntent`, injected via the existing `intentHint` block.

2. **Dynamic maxTokens.** Today each path uses `actor.maxTokens || <default>` (director/manager `|| 600` at `turns.js:1536/1582`; researcher/participant `|| null` at `1649/1763`). Add an `options.maxTokensOverride` to `askActor` and use it ahead of the actor default:
   ```js
   const cap = options.maxTokensOverride ?? actor.maxTokens ?? <pathDefault>;
   ```
   Source the override from the directive's `maxTokens` (or a heuristic: if `expectedOutput` mentions "full/document/section/list of N", bump to e.g. `Math.max(cap, 1500)`). For document-writing turns this is what lets a writer exceed the conversational default.

**Mode:** both. **Risk:** medium — make sure an unbounded override can't blow the context budget; clamp to `min(override, settings.maxTokens-derived ceiling)`.

---

## I. Prose prompt-gaps (small, high-leverage)

These are pure wording changes. They can land as **direct edits now**; when the prompt-editing registry from `PROMPT_EDITING_PLAN.md` is built, move them into fragments. Each is mode-aware where noted.

| Gap | Where | Change |
|-----|-------|--------|
| **Identity framing** | actor system headers already say `You are ${name}` (`turns.js:1456/1547/1588/1668`). **Verify** `roleReminder` (`buildPromptContext`, ~`turns.js:2041`) doesn't still say "Reminder —"; if it does, change to "You are ${name}…". | mostly done — verify only |
| **Anti-meta-commentary** | turn-instruction block (`turns.js:2043–2047`) **and** post-history reminder (§C) | add: `Do not narrate your role ("As a {role}, I would…") — just speak/act.` (more important in roleplay) |
| **Memory incompleteness caveat** | `memoryBlock()` (`turns.js:~2160`) | prepend: `(This memory is a partial digest — if something needed isn't here, ask or proceed with a stated assumption.)` |
| **Loop detection `stuck`** | `INTENT_SCHEMA` (`turns.js:340`) + `resolveIntent` | add `stuck: { type: 'boolean' }`; when `true`, prefer `need: 'redirect'`/`'decide'` or conclude, and surface a Director nudge. Universal. |
| **Anti-repetition** | turn-instruction block | mode-conditional: work → `Don't restate what was just said; add something new.` roleplay → `Don't repeat the previous beat verbatim; move it forward.` |
| **Proactivity** | turn-instruction block | mode-conditional: work → `Push the discussion toward a decision.` roleplay → `Move the scene forward.` |

The thought-field guidance gap (#7 in the earlier list) is **already naturally gated** — the thought instruction is only emitted for `think`/`reason` tiers, so fast-tier roleplay characters never see it. No change needed beyond confirming that gating still holds in the current `buildSchemaPromptLine`.

**Mode:** mixed (table). **Risk:** low. **Tie-in:** these are exactly the fragments the registry (`PROMPT_EDITING_PLAN.md` §2) would own; coordinate so prose isn't written twice.

---

## Cross-cutting changes

- **New state fields:** `scenario.plan` (§E); extend `pendingInjections` entry shape (§H); add `exampleDialogue` to actors (§D). All need a `state.js normalizeState` default so existing saved sessions migrate cleanly (the settings/actor merge pattern at `state.js:85` / `288–326`).
- **Schema edits (`schemas.js`):** `nextSpeaker` enum (§B); `INTENT_SCHEMA` gains `stuck` and optional `expectedOutput` (§A/§H).
- **`askActor` signature:** gains `options.correction` (§F) and `options.maxTokensOverride` (§H). Both optional, default no-op.
- **`logWarning`** is already imported in `turns.js` — reuse it for A/B/F/G diagnostics rather than inventing a new channel.

---

## Test plan

**Automated (Vitest):**
- §A: stub `chatStructured` to return a bogus speaker first, valid second → assert one retry fired and the valid actor is returned; assert no retry when first pick is valid or `NONE`.
- §B: `buildActorSchema` with `allowNextSpeaker` → assert `nextSpeaker.enum` contains exactly the enabled queue names + `""`. Feed `applyAiResult` an unknown `nextSpeaker` → assert it's ignored and logged, queue unchanged.
- §D/§E/§H: `normalizeState` on a legacy saved state (no `exampleDialogue`, no `scenario.plan`) → assert defaults appear, no throw.
- §E: `generateDiscussionPlan` no-ops when `scenario.task` empty; populates `steps` (3–5) when set.
- §F: `validateActorOutput` truth table (empty / too_short / filler / valid / skip-action bypass).
- §G: with `lastPromptTokens > budget*0.9` and `turnsSinceSummary>0`, assert emergency summarize is invoked once; not invoked under turbo or when `isSummarizing`.

**Manual:**
- Work-mode session with a task → confirm a plan appears, current phase marked, advances per round.
- Roleplay session (stageDirections on, no task) → confirm **no** plan block, post-history reminder reads the in-character variant, example-dialogue text reaches the prompt (check the trace `_lastPromptParts`).
- Small/local model: force a hallucinated speaker name and confirm the intent retry corrects it (watch the warn status).
- Long session: drive transcript near budget and confirm an emergency summarize fires before content is hard-dropped.

---

## Suggested commit order

1. **I** (prose gaps — verify roleReminder, add anti-meta/caveat/repetition/proactivity, `stuck` flag) — smallest, no new state.
2. **D** (exampleDialogue field) — isolated, adds the actor-field + normalize pattern the later features reuse.
3. **C** (post-history reminder) — one block in `buildPromptContext`.
4. **B** (nextSpeaker enum + dropped-handoff logging) — schema change, low risk.
5. **A** (intent retry) — localized to `resolveIntent`.
6. **F** (guardrail retry) — needs `askActor` `options.correction`.
7. **H** (expected-output + dynamic maxTokens) — needs `askActor` `options.maxTokensOverride` + injection-shape extension.
8. **E** (planning pre-pass) — new state + generator + injection + advance.
9. **G** (emergency summarization) — needs the `memory.js` `"emergency"` mode; do last since it touches the turn loop and memory.

Each commit should keep defaults byte-identical for existing sessions (no behavioural change until the feature's gate/field is actually used), and re-run `npm run test` + `npm run build` before pushing.

---

## Dependencies & sequencing notes

- **F and H both extend `askActor`'s `options`** — land F first so the `options.correction` plumbing exists, then H adds `maxTokensOverride` alongside it.
- **A, H both touch `INTENT_SCHEMA`** — coordinate the `stuck` + `expectedOutput` additions in one schema edit if doing them close together.
- **I overlaps the prompt-editing registry** (`PROMPT_EDITING_PLAN.md`): if that plan is implemented first, author these prose changes *as registry defaults* instead of inline literals. If I ships first, the registry work just lifts them.
- **E's advance logic** can reuse the round-end `judgeGoal` call rather than adding a per-round API call — prefer that once the MVP round-counter version works.
