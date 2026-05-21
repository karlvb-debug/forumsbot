# Forum

A local multi-actor AI forum for LM Studio.

## Run

```sh
npm run dev
```

Open `http://127.0.0.1:4173`.

In LM Studio, start the local server and load a model. The app defaults to `http://127.0.0.1:1234`; the local proxy automatically uses LM Studio's OpenAI-compatible `/v1` endpoints behind the scenes.

## Use

- Move between the Setup, Conversation, and Memory tabs.
- Use AI Quick Start on the Setup tab to describe the forum you want, review the generated setup, then apply it.
- Add, remove, rename, and enable actors from the Actors panel.
- Give each actor a role, persona, goal, voice, and private memory.
- Turn on the Director/DM when you want a scenario guide or facilitator.
- Type a model name manually or click Models after LM Studio is running.
- Send your own message, then use Next AI, Round, or Auto.
- Use Auto-stop in the Conversation tab to give Auto a goal, ask the model to judge when it is achieved, stop when everyone skips, or stop after a round limit.
- Use Clear in the Conversation tab to clear the current transcript and memory archive while keeping the setup.
- Actors return a private thought plus either a public message or a skip.
- Memory can keep pinned facts, a shared summary, open questions, DM state, archived chunks, and per-actor notes so long sessions do not require sending the full transcript back to the model.
- Click Summarize Now or run full rounds to update memory. Recall uses lightweight keyword matching instead of embeddings.
- Use Extract Outcomes in the Memory tab to mine the conversation for recommendations, decisions, rationale, rejected options, action items, and risks.
- Save and load character/scenario presets as JSON.
- Export a full session transcript, memory, and archive as JSON.

## Notes

The Node server only serves the local app and proxies requests to the LM Studio server URL you enter. It does not require cloud credentials; LM Studio accepts any non-empty API key for OpenAI-compatible local requests. Long transcript history and memory chunks are stored locally in your browser with IndexedDB.
