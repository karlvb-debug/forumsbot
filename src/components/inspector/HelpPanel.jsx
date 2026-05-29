import React, { useState } from 'react';

function HelpSection({ id, title, openId, setOpenId, children }) {
  const isOpen = openId === id;
  return (
    <div>
      <button
        onClick={() => setOpenId(isOpen ? null : id)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 0,
          padding: '10px 0 8px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--fg-dim)',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && (
        <div style={{ padding: '4px 0 16px' }}>
          <div style={{ fontSize: 12.5 }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function HelpPanel() {
  const [openId, setOpenId] = useState('start');

  return (
    <div>
      {/* Getting Started */}
      <HelpSection id="start" title="Getting Started" openId={openId} setOpenId={setOpenId}>
        <p style={{ marginBottom: 8 }}>
          Forum runs AI personas called <strong>actors</strong> who discuss a topic together in a
          structured transcript. Each actor is a separate LLM call with its own personality, goal,
          and voice.
        </p>
        <p style={{ marginBottom: 8 }}>
          <strong>Before your first session:</strong> Open the <strong>Connection</strong> panel,
          enter your LM Studio URL, pick a Chat model, and click <strong>Ping</strong> to verify
          the connection.
        </p>
        <p style={{ marginBottom: 8 }}>
          <strong>Then set up your session:</strong>
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>Open <strong>Scenario</strong> — fill in Title, Premise, and Objective.</li>
          <li>Open <strong>Actors</strong> — review the default cast or edit them.</li>
          <li>
            <strong>Run:</strong> press <strong>Next</strong> (one turn), <strong>Round</strong>{' '}
            (all actors once), or <strong>Auto</strong> (continuous). Stop with the{' '}
            <strong>Stop</strong> button or <strong>Esc</strong>.
          </li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          See the <strong>Keyboard Shortcuts</strong> section below for the full list.
        </p>
      </HelpSection>

      {/* Keyboard Shortcuts */}
      <HelpSection id="shortcuts" title="Keyboard Shortcuts" openId={openId} setOpenId={setOpenId}>
        <table className="shortcut-legend">
          <tbody>
            <tr><td><kbd>Alt</kbd>+<kbd>N</kbd></td><td>Next turn — the next actor speaks</td></tr>
            <tr><td><kbd>Alt</kbd>+<kbd>R</kbd></td><td>Full round — every enabled actor speaks once</td></tr>
            <tr><td><kbd>Alt</kbd>+<kbd>A</kbd></td><td>Auto mode — run continuously until a stop condition</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Stop generation (also dismisses dialogs)</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Command palette</td></tr>
            <tr><td><kbd>Alt</kbd>+<kbd>I</kbd></td><td>AI assistant</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>Search transcript</td></tr>
            <tr><td><kbd>Enter</kbd></td><td>Send your message (in the composer)</td></tr>
          </tbody>
        </table>
      </HelpSection>

      {/* Topbar */}
      <HelpSection id="topbar" title="Topbar" openId={openId} setOpenId={setOpenId}>
        <p style={{ marginBottom: 8 }}>
          The topbar contains the primary run controls and quick-action buttons:
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Next (Alt+N)</strong> — one AI turn: the next actor in rotation speaks.
          </li>
          <li>
            <strong>Round (Alt+R)</strong> — every enabled actor speaks once, in order.
          </li>
          <li>
            <strong>Auto (Alt+A)</strong> — continuously runs rounds until a stop condition triggers.
          </li>
          <li>
            <strong>Stop (Esc)</strong> — halts generation at the end of the current streaming token.
          </li>
          <li>
            <strong>⚡ Turbo</strong> — skips memory cycles, alignment scoring, and private
            thoughts. Faster but shallower output.
          </li>
          <li>
            <strong>⬇ MD</strong> — copies the full transcript as Markdown to your clipboard.
          </li>
          <li>
            <strong>AI Assistant (bolt icon, Alt+I)</strong> — opens the AI setup assistant for
            natural-language configuration of your scenario and actors.
          </li>
          <li>
            <strong>⌘ (Ctrl+K)</strong> — command palette for quick navigation and actions.
          </li>
        </ul>
      </HelpSection>

      {/* Scenario */}
      <HelpSection id="scenario" title="Scenario" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Presets</strong> — applies a named template that sets Mode, Title, Premise,
            Objective, and all Systems fields at once. Options: Brainstorm, Risk Assessment,
            Structured Debate, Project Retrospective, Collaborative Story, Expert Interview,
            Collaborative Improv, Problem Solving.
          </li>
          <li>
            <strong>Mode</strong> — coarse behavioral switch: <em>Problem</em> (analytical),{' '}
            <em>Story</em> (roleplay), or <em>Freeform</em> (open). Systems settings override
            individual actor behaviors.
          </li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          <strong>Systems settings</strong> control the session's behavioral rules:
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Stage Directions</strong> — the key roleplay toggle. On = actors speak in
            character with <em>*asterisk*</em> physical actions, web tools disabled, theatrical
            formatting rules apply. Off = analytical forum mode.
            <ul style={{ margin: '4px 0 4px 0', paddingLeft: 16, lineHeight: 1.6 }}>
              <li>
                <em>Intensity</em>: how much physical description is expected — Minimal, Moderate,
                or Immersive.
              </li>
              <li>
                <em>Max stage share</em>: hard cap on what % of a response may be{' '}
                <em>*action*</em> text (e.g. 20% = brief actions, 40% = immersive narration).
              </li>
            </ul>
          </li>
          <li>
            <strong>DM Role</strong> — the Director's operating mode. <em>Narrates</em> on =
            Director gets narrator-DM instructions ("describe the environment…"); off = facilitator
            ("surface decisions, invite quieter actors…"). Usually matches Stage Directions.
          </li>
          <li>
            <strong>Alignment Strictness</strong> — how firmly actors are nudged back to the
            objective when drifting. Strict = hard redirects in prompt. Loose = free exploration.
            Off = no alignment signals at all.
          </li>
          <li>
            <strong>Document Schema</strong> — labels the working document type for context:
            Freeform, Decisions, Story Bible, or Findings. Does not change actor prompts yet, but
            affects future templates.
          </li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          <strong>Core Context — Title, Premise, Objective</strong>: injected into every single
          actor prompt as non-compressible anchors. Keep them clear and specific — they directly
          shape every turn.
        </p>
      </HelpSection>

      {/* Actors */}
      <HelpSection id="actors" title="Actors" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Add Actor / + From Description</strong> — add a blank actor, or describe one
            in plain English (e.g. "a cynical economist who challenges growth assumptions") and the
            AI fills in all fields automatically.
          </li>
          <li>
            <strong>Name &amp; Role</strong> — shown in the transcript swatch. Role is a one-line
            descriptor (e.g. "Risk Spotter").
          </li>
          <li>
            <strong>Persona</strong> — private context injected into the actor's system prompt.
            Not shown in the transcript. Be specific about personality and behaviors.
          </li>
          <li>
            <strong>Goal</strong> — what this actor is trying to accomplish in the discussion.
            Shapes their skip/speak decisions.
          </li>
          <li>
            <strong>Voice</strong> — style guidance ("Calm, precise, concise." or "Blunt and
            provocative.") injected as a reminder at the bottom of each prompt.
          </li>
          <li>
            <strong>Temperature</strong> — randomness 0.0–2.0. 0.7 = focused, 1.0 = balanced,
            1.2+ = creative/unpredictable. Directors work well at 0.7–0.8.
          </li>
          <li>
            <strong>Relationships</strong> — short notes on how this actor views each other actor.
            Injected into their private context on turns where memory runs.
          </li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          <strong>Permissions</strong> control what an actor is allowed to do:
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Direct (canDirect)</strong> — this actor is the Director: gets the
            moderator/narrator system prompt, can propose anchors, and route the next speaker. Max
            one Director per session.
          </li>
          <li>
            <strong>Manage Cast (canManageCast)</strong> — can create, silence, and resume actors
            mid-session via JSON output. Also unlocks CAP-1 (prompt injection) and CAP-2 (private
            messages).
          </li>
          <li>
            <strong>Research (canResearch)</strong> — gets a specialized web-search prompt. Uses
            [SEARCH: query] in their thought field to fetch live data before responding.
          </li>
          <li>
            <strong>See Thoughts (canSeeThoughts)</strong> — Directors with this see all actors'
            private thoughts. Regular actors see thoughts from actors they have relationships with.
          </li>
        </ul>
      </HelpSection>

      {/* Memory */}
      <HelpSection id="memory" title="Memory" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Pinned Facts</strong> — ground-truth facts injected verbatim into every actor
            prompt. Use for settled decisions, key constraints, or invariants the model must never
            contradict.
          </li>
          <li>
            <strong>Shared Summary</strong> — the AI's compressed rolling summary, rebuilt every
            few cycles or on demand. Prevents old context from disappearing as the conversation
            grows.
          </li>
          <li>
            <strong>Open Questions</strong> — unresolved threads tracked by the memory summarizer.
            Keeps the discussion from going in circles.
          </li>
          <li>
            <strong>DM State</strong> — scenario-specific state maintained by the Director (scene
            location, introduced elements, tension level). Used in Story mode.
          </li>
          <li>
            <strong>Pending Anchors</strong> — the Director suggests these during sessions; you
            approve them. Once approved, actors are explicitly told not to re-argue them.
          </li>
          <li>
            <strong>Outcomes</strong> — extracted decisions, action items, risks, and rationale.
            Run "Extract Outcomes" or let the memory cycle do it automatically.
          </li>
          <li>
            <strong>Archive / Recall</strong> — older memory chunks stored in IndexedDB, recalled
            semantically when the current topic is relevant to past discussion.
          </li>
        </ul>
      </HelpSection>

      {/* Telemetry */}
      <HelpSection id="telemetry" title="Telemetry" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Alignment Score (0–100%)</strong> — how closely the conversation aligns with
            the Objective. Computed via embedding cosine similarity (if an embedding model is
            configured) or keyword overlap.
          </li>
          <li>
            <strong>Drift</strong> — change in alignment since the last turn. The sparkline shows
            the last 10 turns.
          </li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          <strong>Session Health tiles:</strong>
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Skip Rate</strong> — % of AI turns that chose to skip. High = actors are
            being efficient; very high = they may be stuck.
          </li>
          <li>
            <strong>Extract Rate</strong> — % of outcome extraction attempts that succeeded.
          </li>
          <li>
            <strong>Mem Dups</strong> — memory deduplication events detected.
          </li>
          <li>
            <strong>Aligned</strong> — current alignment % at a glance.
          </li>
          <li>
            <strong>Repeats</strong> — turns flagged as repetitive via quality signals. Two flags
            in 20 turns triggers an automatic loop-breaking hint.
          </li>
        </ul>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Influence Budget</strong> — % of total words spoken per actor, showing
            speaking-time balance across the cast.
          </li>
          <li>
            <strong>Optimization toggles</strong>: preflight skip router, round snapshot (KV cache
            reuse), hypothesis sampling (parallel candidates), influence bars on messages, and
            prompt traces in diagnostics.
          </li>
          <li>
            <strong>Gravity Sensitivity slider</strong> — at 100 = constant drift warnings; at 0 =
            silent. Default 50 fires nudges when alignment drops below halfway.
          </li>
        </ul>
      </HelpSection>

      {/* Documents */}
      <HelpSection id="documents" title="Documents" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Working Documents (AI Editable on)</strong> — actors can propose edits using
            the <code>documentEdits</code> JSON field. Changes are tracked with version history and
            per-line authorship.
          </li>
          <li>
            <strong>Reference Documents (AI Editable off)</strong> — injected into actor prompts as
            read-only background material. No edit protocol is shown to actors.
          </li>
          <li>
            <strong>Target</strong> — set "All actors" or restrict a document to specific actors.
            Useful for private briefings or role-specific context.
          </li>
          <li>
            <strong>Import PR</strong> — paste a GitHub PR URL to auto-import the diff as reference
            documents and configure 4 specialist code-review actors: Review Lead, Security Analyst,
            Architecture Reviewer, and Test Coverage Reviewer.
          </li>
          <li>
            <strong>Import Folder</strong> — load source files from your local machine as reference
            documents. Supports up to 20 files, 8 KB each.
          </li>
        </ul>
      </HelpSection>

      {/* Goal & Auto-Stop */}
      <HelpSection id="goal" title="Goal & Auto-Stop" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Goal text</strong> — the statement the LLM judge checks against the
            conversation to decide if work is done. Be concrete ("Produce a ranked list of 5
            mitigations with owners") rather than vague ("complete the discussion").
          </li>
          <li>
            <strong>Judge goal after each round</strong> — runs an LLM judge call after every
            round. If it determines the goal is reached, auto-run stops.
          </li>
          <li>
            <strong>Stop when everyone skips</strong> — if all enabled actors skip in the same
            round, the topic is considered exhausted and auto-run stops.
          </li>
          <li>
            <strong>Max rounds</strong> — hard cap on the number of rounds. Useful for demos or
            time-boxed sessions.
          </li>
          <li>
            <strong>Check Goal Now</strong> — run the judge manually against the last N turns,
            without waiting for the next round.
          </li>
        </ul>
      </HelpSection>

      {/* Sessions */}
      <HelpSection id="sessions" title="Sessions" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Save current</strong> — snapshots the full session state to IndexedDB.
          </li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          <strong>Export formats:</strong>
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Debug</strong> — full state including private thoughts, prompt traces, and
            metrics. For debugging or archival.
          </li>
          <li>
            <strong>Shareable</strong> — redacted version safe to send to others (no private
            thoughts).
          </li>
          <li>
            <strong>Markdown</strong> — human-readable transcript suitable for sharing or
            publishing.
          </li>
          <li>
            <strong>Evaluation</strong> — structured QA dataset format for fine-tuning or
            benchmarking.
          </li>
        </ul>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Load preset</strong> — import a JSON scenario file exported from another
            session or hand-crafted.
          </li>
          <li>
            <strong>Clear conversation</strong> — wipes messages, summaries, and outcomes. Keeps
            actors, scenario, and settings intact.
          </li>
          <li>
            <strong>Reset all</strong> — restores Forum to factory defaults. This is irreversible.
          </li>
        </ul>
      </HelpSection>

      {/* Connection */}
      <HelpSection id="connection" title="Connection" openId={openId} setOpenId={setOpenId}>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>Base URL</strong> — LM Studio's local API endpoint. Default:
            http://127.0.0.1:1234. Change if you've moved LM Studio's port.
          </li>
          <li>
            <strong>Chat model</strong> — used for all actor turns, the Director, memory
            summarization, and goal judging. Larger models produce better reasoning.
          </li>
          <li>
            <strong>Embedding model</strong> — used for semantic memory recall and alignment
            scoring. Can be a smaller/faster model (e.g. nomic-embed-text). Leave blank to fall
            back to the chat model.
          </li>
          <li>
            <strong>Temperature / Max Tokens / Top-P / Repeat Penalty</strong> — global generation
            defaults. Individual actors can override temperature in the Actors panel.
          </li>
          <li>
            <strong>Streaming</strong> — show tokens as they arrive. Disable if your model or
            proxy buffers responses.
          </li>
          <li>
            <strong>Turn delay</strong> — pause between turns in auto mode (seconds). Useful for
            reading along at a comfortable pace.
          </li>
        </ul>
      </HelpSection>

      {/* Capabilities */}
      <HelpSection id="capabilities" title="Capabilities (Automatic Behaviors)" openId={openId} setOpenId={setOpenId}>
        <p style={{ marginBottom: 8 }}>
          These run autonomously during sessions — no user configuration needed. They are triggered
          by actors or the Director via structured JSON output.
        </p>
        <ul style={{ margin: '4px 0 8px 0', paddingLeft: 16, lineHeight: 1.6 }}>
          <li>
            <strong>CAP-1 Prompt Injection</strong> — Directors and managers can privately prime
            an actor before their next turn. The actor sees a <code>[DIRECTOR'S NOTE]</code> block
            that other actors don't. Scope can be next turn only or persistent.
          </li>
          <li>
            <strong>CAP-2 Private Message</strong> — Directors and managers can send a message
            visible only to one target actor. Useful for off-channel coordination without
            influencing the rest of the cast.
          </li>
          <li>
            <strong>CAP-8 Fact Pin</strong> — actors in analytical mode can add a freshly-settled
            undisputed fact directly to Pinned Facts via their <code>pinFact</code> JSON field.
          </li>
          <li>
            <strong>CAP-14 Quality Signal</strong> — actors can flag the prior turn as repetitive
            (<code>rateSignal: {'{'}flag: "repeat"{'}'}</code>). Two repeat flags in 20 turns
            auto-injects a loop-breaking hint to the flagged actor.
          </li>
        </ul>
      </HelpSection>
    </div>
  );
}
