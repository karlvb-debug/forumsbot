# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development branch

Work on the branch assigned for your session. Never push directly to `main`.

## Commands

```sh
# Start for development (two terminals required)
npm run server   # Terminal 1 — Express proxy on port 4173
npm run dev      # Terminal 2 — Vite HMR on port 5173, open http://localhost:5173

# Build & serve production bundle
npm run build
npm start        # serves dist/ on port 4173

# Electron
npm run electron:dev    # requires `npm run dev` + `npm run server` already running
npm run electron:build  # produces installers in release/

# Quality gates (must all pass before pushing)
npm test         # full suite — no LM Studio connection required
npm run lint     # ESLint across src/
npm run build    # must complete with no new errors

# Run a single test file
npx vitest run src/modules/memory.test.js
```

## Architecture

### State layer (three stores, no Redux)

All persistent application data lives in a single mutable JS object in `src/modules/state.js`. Mutation and persistence are handled by three cooperating modules:

- **`src/modules/stateStore.ts`** — framework-agnostic subscription registry. Module-layer code calls `mutateState(fn)` or `notifyStateChange()` after mutating `state` directly. Never imports React.
- **`src/hooks/useForumState.ts`** — React bridge via `useSyncExternalStore`. Components call `useForumState(s => s.actors)` to subscribe to any state slice.
- **`src/modules/uiStore.ts`** — separate store for transient signals (connection status, busy flag, toasts) that don't belong in persisted state.

The pattern: mutate `state` → call `mutateState()` or `saveState()` → stateStore notifies React → components re-render via selector. Components never reach into modules directly except through hooks.

### Module / hook / component layering

```
src/modules/   ← Pure logic. No React imports. Mutates state directly.
src/hooks/     ← React bindings only. Imports modules, exposes hooks/callbacks.
src/components/ ← UI only. Imports hooks, never modules directly.
```

`App.jsx` dynamically imports heavy modules (`turns`, `memory`, `api`, `session`, `db`) and injects them into `src/hooks/useActions.ts` via `setModuleRefs()`. This keeps the initial parse cost low and avoids circular wiring.

### Turn pipeline (`src/modules/turns/`)

`turns.js` is a barrel that re-exports from five focused files:

| File | Responsibility |
|---|---|
| `config.js` | Stateless helpers — system settings, actor thinking tier, queue, plan |
| `resolver.js` | Speaker selection — `tinyRouter`, `resolveIntent`, `resolveNextSpeaker` |
| `prompt.js` | Prompt assembly — `buildPromptContext`, memory block, budget scaling |
| `result.js` | Output processing — `applyAiResult`, pause handling, `distillActorMemory` |
| `pipeline.js` | Orchestration — `runNextTurn`, `runRound`, `runAutoLoop`, goal judging |

`pipeline.js` is the only file allowed to import from the others; circular imports between the sub-files are forbidden. When `result.js` needs to trigger a pipeline-side side-effect (e.g. conflict callbacks), it receives an `onConflict` callback injected by `pipeline.js` rather than importing it.

### Prompt fragment system (`src/prompts/`)

Every prose string sent to the LLM is a named key in `src/prompts/registry.js`. Nothing is hardcoded in turn/pipeline logic. Call `frag('key', { vars })` to resolve a fragment — it checks `state.promptOverrides[key]` first, then falls back to the registry default. Users can override any fragment at runtime via the Prompts inspector panel; overrides persist in `localStorage`.

### Streaming and UI stores

`src/modules/streamingStore.ts` manages the per-actor "thinking bubble" lifecycle during generation. Module-layer code calls `showStreamingBubble` / `updateStreamingBubble` / `removeStreamingBubble`; `Transcript.jsx` subscribes via `useSyncExternalStore`.

### Server (`server.js`)

A zero-dependency Node `http.createServer` proxy. No Express. Exports `startServer(port)` for Electron; auto-listens when run directly via `node server.js`. CSRF check allows requests with no `Origin` header (curl, Electron, server-to-server) and rejects cross-origin POSTs from other browser origins.

## Key constraints

- **No React in `src/modules/`** — modules are framework-agnostic; React bindings belong in `src/hooks/`.
- **`eslint-plugin-react` is intentionally absent** — it's incompatible with ESLint 10. Only `eslint-plugin-react-hooks` is used. Don't add it back.
- **React Compiler rules are disabled** — `eslint-plugin-react-hooks@7` bundles React Compiler rules that produce false positives on this codebase. They're disabled in `eslint.config.js`; don't re-enable them.
- **TypeScript for new hook/type files; plain JS is fine for module additions.**
- **No new `console.debug` in production paths.**
