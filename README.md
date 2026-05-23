# Forum — Local AI Council

A multi-actor AI discussion app that runs entirely on your machine using [LM Studio](https://lmstudio.ai). Configure a panel of AI actors with distinct roles, personas, and goals, then watch them deliberate — or join in yourself.

All processing is local. No cloud, no API keys, no data leaving your machine.

---

## Requirements

- **Node.js** ≥ 18
- **LM Studio** with the local server running (defaults to `http://127.0.0.1:1234`)
- A loaded chat model (any OpenAI-compatible model works)
- Optional: a dedicated embedding model for semantic memory features (e.g. `nomic-embed-text-v1.5`)

---

## Quick Start

```sh
npm install
npm run dev
```

Open **http://localhost:4173** in your browser.

In LM Studio, start the local server and load a model. The Forum server proxies all LLM calls to LM Studio — it never contacts the internet directly for AI requests.

---

## Setup

### Connection
Enter your LM Studio server URL (default `http://127.0.0.1:1234`) and select a model. Click **Refresh** to load available models. The app will auto-detect the model's context window size and scale its prompt budget accordingly — a 128K model gets proportionally more context than an 8K model.

Optionally set a separate **Embedding Model** for memory recall and semantic drift detection. If left blank, the chat model is used as a fallback.

### Scenario
Every session has three core fields that anchor all actor prompts:

- **Premise** — the situation or context (e.g. *"Three product designers reviewing a new mobile checkout flow"*)
- **Objective** — what the group should achieve or decide
- **Mode** — Problem, Story, or Freeform (shapes default DM behaviour and system framing)

These fields are **non-compressible** — they always reach the model intact regardless of how large the prompt grows.

### Quick Setup
Describe the forum you want in plain English on the Setup tab. The AI will generate a full configuration — scenario, actors, memory seed — which you can review and apply or discard.

### Actors
Add up to 8 actors. Each actor has:

| Field | Purpose |
|---|---|
| **Name** | Display name and identity |
| **Role** | Short badge label (e.g. "Systems thinker") |
| **Persona** | How this actor thinks and behaves |
| **Goal** | What this actor is personally trying to achieve |
| **Voice** | Style note (e.g. "Calm, precise, concise") |
| **Temperature** | Per-actor creativity override (0.1–1.5) |
| **Private memory** | Internal monologue — updated by the memory system, visible only in the actor's prompt |
| **Research Specialist** | Special mode: actor uses `[SEARCH: query]` in their thought field to run live web searches before responding |

### Director (DM)
An optional orchestrator agent that runs after each actor round. The Director can summarise, redirect the conversation, invite quieter actors, and maintain scenario continuity. It can optionally see all actors' private thoughts.

---

## Conversation

### Running turns
| Button | Shortcut | Action |
|---|---|---|
| **Next AI** | `⌘⇧N` | One actor turn |
| **Round** | `⌘⇧R` | All enabled actors + Director |
| **Auto** | — | Continuous rounds until a stop condition |
| **Send** | `⌘↵` | Post your message, then run one round |

### Auto-stop
Give Auto a **goal**, then choose stop conditions:
- LLM judges the goal as achieved after each round
- Everyone skips in the same round
- A maximum number of rounds is reached

When the goal is detected as met, a **Stop or Continue** modal appears — you can stop, pause, or redirect with a new goal.

### Per-message features
- **👍 / 👎 feedback** — rate contributions; thumbs-down reveals a reason tag (hallucination, off-topic, repetitive, poor quality)
- **⚓ Anchor** — mark a settled claim; anchored statements are injected into every subsequent prompt as agreed ground truth
- **💭 Private thought** — expandable block showing the actor's internal reasoning (toggle "Show private thoughts" to enable)
- **Tool call blocks** — inline web search results when a Researcher or tools-enabled actor fetches live information

### Telemetry sidebar
The **📊 Telemetry** sidebar tab shows real-time session health:

- **Alignment dial** — semantic similarity between recent messages and the session objective (purple = on-track, gold = drifting, coral = critical). Shows a `keyword` badge when falling back to keyword-based scoring instead of embeddings.
- **Session Health tiles** — alignment %, skip rate, outcome extraction rate, memory duplication score
- **Tension Field Grid** — animated canvas visualisation of session drift
- **Gravity Sensitivity** — the alignment threshold below which a "return to objective" warning is injected into actor prompts
- **Preflight Skip Router** — pre-screens each actor's relevance before spending tokens on a full response; actors with low relevance skip instantly (saves significant tokens on long sessions)
- **Hypothesis Sampling** — generate N candidate responses per turn and auto-select the best by composite quality metrics
- **Trigger Steering Nudge** — immediately force all actors to pivot back to the objective
- **Influence Budget** — proportional bar showing which actors have driven the session's vocabulary

### Collaborative Document
The **📝 Doc** sidebar tab enables a shared document that actors can read and edit during the session. Features:
- Markdown preview and raw edit modes
- Per-author edit attribution bar
- Confluence River — animated visualisation of each actor's contribution share
- History scrubber — browse and restore any past version

---

## Memory

Forum maintains a persistent memory system across a long session so the full transcript never needs to be sent back to the model.

### How it works
The memory system runs automatically in the background every few turns:

1. **Delta cycle** — appends a short bullet summary of recent turns
2. **Full rewrite** (every 4 deltas by default) — rebuilds the shared summary from all deltas + archived chunks

Each cycle produces a **memory chunk** stored in IndexedDB with an embedding vector. When building a prompt, the most relevant chunks are retrieved by cosine similarity (with keyword overlap as a hybrid signal).

### Memory fields
| Field | Contents |
|---|---|
| **Pinned Facts** | Ground-truth statements injected into every prompt. Semantic dedup (cosine ≥ 0.88) prevents near-duplicate facts from accumulating. |
| **Shared Summary** | 300–500 word durable summary of the session |
| **Open Questions** | Unresolved questions the group hasn't answered |
| **DM State** | Director-private notes on pacing and actor dynamics |
| **Pending Facts** | AI-suggested facts waiting for user approval |

### Memory controls
- **Summarize Now** — manually trigger a memory cycle
- **Rebuild from History** — full rewrite from the complete message history
- **Save Facts** — promote all pending suggestions to confirmed pinned facts
- **Compact Facts** — merge and deduplicate pinned facts when they grow too long
- **Clear Archive** — delete all archived chunks from IndexedDB
- **Archive Browser** — inspect all stored chunks with timestamps, keywords, and embedding status

### Anchored Agreements
Click ⚓ on any message to anchor a settled claim. Anchors are listed in the Memory tab and injected into every subsequent prompt, giving the whole group a shared reference point that persists regardless of memory compression.

---

## Outcomes

After a session, click **Extract** in the Memory tab to have the LLM mine the transcript for structured results:

- Final recommendation
- Decisions made
- Rationale
- Rejected options
- Action items
- Risks identified

---

## Session Management

| Action | Description |
|---|---|
| **Save** (preset) | Download current setup (actors, scenario, DM, memory seed) as a `.json` file |
| **Load** (preset) | Load a preset file to restore a saved configuration |
| **Export** | Download the full session — transcript, memory, metrics — as JSON |
| **Export modes** | Debug (all traces), Shareable (redacted), Evaluation (metrics only) |
| **Copy Session** | Copy the formatted transcript to the clipboard |
| **Clear** | Wipe the transcript while preserving all setup and memory configuration |

---

## Architecture

```
Forum/
├── server.js          # Node.js HTTP server — proxy only, no business logic
└── public/
    ├── index.html     # Single-page app shell
    ├── main.js        # Entry point, event wiring, auto-run loop
    ├── styles.css     # Vanilla CSS
    └── modules/
        ├── api.js         # LLM call wrappers, tool call parsing
        ├── constants.js   # App-wide constants and default state
        ├── db.js          # IndexedDB access (chunks, actor-memory, messages)
        ├── markdown.js    # Lightweight markdown renderer
        ├── memory.js      # Summarisation, chunk archiving, recall, semantic dedup
        ├── render.js      # All DOM rendering
        ├── session.js     # Preset save/load, session export
        ├── state.js       # Single mutable state object, persistence
        ├── telemetry.js   # Drift detection, canvas animations, per-turn metrics
        ├── turns.js       # Prompt assembly, dynamic budget scaling, orchestration
        └── utils.js       # Pure utilities — parsing, normalisation, keyword extraction
```

### Backend
The Node.js server (`server.js`) is a thin proxy with five endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/models` | List available models from LM Studio |
| `POST /api/model-info` | Fetch extended model metadata (context length, capabilities) |
| `POST /api/chat` | Proxy chat completion requests |
| `POST /api/embeddings` | Proxy embedding requests |
| `POST /api/tool-execute` | Execute `web_search` (DuckDuckGo) and `web_read` (URL fetch + parse) |
| `GET /*` | Serve the static web app |

No state is held server-side. All application data lives in the browser (`localStorage` + `IndexedDB`).

### Prompt budget scaling
Forum dynamically scales its prompt budget based on the model's detected context window:

| Context window | Token budget | Working memory (recent turns) |
|---|---|---|
| < 8K | ~50% of max | 6 turns |
| 8K–32K | ~55–60% | 12 turns |
| 32K–128K | ~60–68% | 20 turns |
| 128K+ | ~70% | 30 turns |

The scenario block (premise + objective) is always reserved before any budget degradation occurs.

---

## Notes

- The server binds to `127.0.0.1` only — it is not accessible from other machines on your network
- LM Studio accepts any non-empty API key for its local server; the default `lm-studio` works fine
- All session data stays in your browser — closing and reopening the tab restores your full session
- The embedding model is optional but significantly improves memory recall quality and drift detection accuracy. Any embedding model compatible with LM Studio's `/v1/embeddings` endpoint works.
