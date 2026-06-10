# Contributing to Forum

Thanks for your interest. Forum is a local-first multi-actor AI discussion tool built with React + Vite, proxied through a lightweight Node server to LM Studio.

## Getting started

```sh
npm install

# Terminal 1 — proxy server (relays LLM calls to LM Studio)
npm run server

# Terminal 2 — Vite dev server
npm run dev
```

Open http://localhost:5173. You'll need LM Studio running with a model loaded.

## Running the tests

```sh
npm test
```

All tests should pass before you open a PR. The test suite covers prompt schema logic, memory utilities, session helpers, and routing — it does not require a live LM Studio connection.

## Project structure

| Path | What it does |
|---|---|
| `src/modules/` | Business logic — state, API proxy client, memory, turns, session |
| `src/hooks/` | React bindings (state bridge, actions, streaming) |
| `src/components/` | UI — Transcript, Inspector panels, Composer, Rail |
| `src/prompts/` | Editable system prompt fragments |
| `src/styles/` | Single CSS file |
| `server.js` | Node HTTP proxy — relays `/api/*` to LM Studio, serves the built app |

## Making changes

- **Business logic** lives in `src/modules/`. Keep it framework-agnostic where possible — avoid importing React hooks into module files.
- **UI state** flows through `mutateState()` in `src/hooks/useForumState.ts`. Call `saveState()` after mutations you want persisted.
- **Prompt text** lives in `src/prompts/` as named fragments. Changing a fragment changes behaviour for all actors that include it.
- **New inspector panels** go in `src/components/inspector/`, then get wired into `Inspector.jsx` and the `NAV` array in `App.jsx`.

## Code style

- TypeScript for new hook/type files; plain JS is fine for module additions.
- No new `console.debug` calls in production paths.
- Use `info` props on `<Field>` components rather than visible hint text below fields.
- Run `npm run build` before opening a PR — the build must succeed with no new errors.

## Reporting issues

Please include:
- Forum version (check the page title or `package.json`)
- LM Studio version and model name
- Whether the issue is reproducible with a fresh session
- Browser console errors if any

Do **not** attach session export files to issues — they may contain your LM Studio API key or private conversation content.
