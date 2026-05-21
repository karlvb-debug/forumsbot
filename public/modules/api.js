import { AVAILABLE_TOOLS, MAX_TOOL_ROUNDS } from './constants.js';
import { state } from './state.js';
import { parseAiJson, parseTextToolCalls, stripTextToolCalls } from './utils.js';

// els reference — set via initApi() called from main.js
let els = null;
export function initApi(elsRef) {
  els = elsRef;
}

// Track which actor/director is currently generating so tool status messages
// can say "Architect is searching..." rather than a generic message.
let _currentSpeaker = "";
export function setCurrentSpeaker(name) { _currentSpeaker = name || ""; }

// Accumulate tool calls made during the current chatCompletion so the
// calling turn can attach them to the message for display in the transcript.
let _lastToolCalls = [];
export function getLastToolCalls() { return [..._lastToolCalls]; }

export async function chatCompletion(system, user, { temperature = state.settings.temperature, maxTokens = state.settings.maxTokens, signal, useTools = false, jsonSchema = null } = {}) {
  _lastToolCalls = []; // reset per-call log
  const isToolMode = useTools && state.settings.toolsEnabled && state.scenario.mode !== "story";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const payload = {
      model: state.settings.model,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    // JSON schema-constrained decoding (LM Studio / llama.cpp grammar support).
    // Dramatically improves structured output reliability on small models.
    if (jsonSchema && !isToolMode) {
      payload.response_format = {
        type: "json_schema",
        json_schema: { name: "response", strict: true, schema: jsonSchema }
      };
    }

    if (isToolMode && round < MAX_TOOL_ROUNDS) {
      payload.tools = AVAILABLE_TOOLS;
      payload.tool_choice = "auto";
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.settings.baseUrl,
        apiKey: state.settings.apiKey,
        request: payload
      }),
      signal
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "LM Studio request failed.");
    }

    const choice = data?.choices?.[0];
    const msg = choice?.message;

    // Path A: Native tool calls (OpenAI format)
    if (msg?.tool_calls?.length) {
      console.log(`[tools] Round ${round + 1}: native tool_calls (${msg.tool_calls.length})`);
      messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls) {
        const result = await executeToolCall(call.function?.name, call.function?.arguments, signal);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    const content = msg?.content || "";

    // Capture real token usage from LM Studio response
    if (data.usage) {
      state.contextInfo.lastPromptTokens = data.usage.prompt_tokens || 0;
      state.contextInfo.lastCompletionTokens = data.usage.completion_tokens || 0;
      // Notify render layer without importing render.js (circular dep avoidance)
      document.dispatchEvent(new CustomEvent("tokenUsageUpdated"));
    }

    // Path B: Prompt-based tool calls (fallback for models without native support)
    if (isToolMode && round < MAX_TOOL_ROUNDS) {
      const textCalls = parseTextToolCalls(content);
      if (textCalls.length) {
        const callTypes = textCalls.map((tc) => tc.tool).join(", ");
        console.log(`[tools] Round ${round + 1}: text-based calls [${callTypes}] (${textCalls.length} total)`);
        let toolResults = "";
        for (const tc of textCalls) {
          const result = await executeToolCall(tc.tool, JSON.stringify(tc.args), signal);
          toolResults += `\n\n--- ${tc.tool} result ---\n${result}\n--- end ---`;
        }
        const cleanedContent = stripTextToolCalls(content);
        messages.push({ role: "assistant", content: cleanedContent || "Let me look that up." });
        messages.push({ role: "user", content: [
          `Here are the tool results you requested:${toolResults}`,
          "",
          "Incorporate these results into your response. If you need more detail from another URL, use [READ: https://exact-url] in your thought field.",
          "Return valid JSON with thought, action, and message fields."
        ].join("\n") });
        continue;
      }
    }

    return content;
  }

  // If we exhausted rounds, return whatever we have
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return lastAssistant?.content || "";
}

export async function chatJson(system, user, temperature, signal) {
  const content = await chatCompletion(system, user, {
    temperature,
    maxTokens: state.settings.maxTokens,
    signal,
    useTools: true
  });
  return parseAiJson(content);
}

/**
 * Schema-constrained structured JSON call.
 * Passes a JSON Schema to LM Studio for grammar-constrained decoding.
 * Falls back to plain chatCompletion if the model/server doesn't support it.
 */
export async function chatStructured(system, user, schema, { temperature = 0.2, maxTokens = null, signal = null } = {}) {
  try {
    const raw = await chatCompletion(system, user, {
      temperature,
      maxTokens: maxTokens || state.settings.maxTokens,
      signal,
      jsonSchema: schema
    });
    return JSON.parse(raw);
  } catch (err) {
    // If schema-constrained call fails (model doesn't support it), fall back to plain call
    console.warn("[api] chatStructured schema mode failed, falling back to plain completion:", err.message);
    const raw = await chatCompletion(system, user, { temperature, maxTokens: maxTokens || state.settings.maxTokens, signal });
    return JSON.parse(raw);
  }
}


export async function executeToolCall(toolName, argsString, signal) {
  let toolArgs;
  try {
    toolArgs = JSON.parse(argsString || "{}");
  } catch {
    toolArgs = {};
  }

  console.log(`[tools] Executing: ${toolName}(${JSON.stringify(toolArgs)})`);

  // Live status update so the user knows a web call is in flight.
  const speakerLabel = _currentSpeaker ? `${_currentSpeaker} is` : "Agent is";
  if (toolName === "web_search") {
    const query = toolArgs.query || toolArgs.q || "...";
    setStatus(`🔍 ${speakerLabel} searching: "${String(query).slice(0, 60)}"`, "pending");
    _lastToolCalls.push({ tool: "web_search", query: String(query) });
  } else if (toolName === "web_read") {
    const url = toolArgs.url || toolArgs.href || "...";
    let domain;
    try { domain = new URL(url).hostname; } catch { domain = String(url).slice(0, 50); }
    setStatus(`📄 ${speakerLabel} reading: ${domain}`, "pending");
    _lastToolCalls.push({ tool: "web_read", url: String(url), domain });
  } else {
    setStatus(`⚙️ ${speakerLabel} using tool: ${toolName}`, "pending");
    _lastToolCalls.push({ tool: toolName, args: toolArgs });
  }

  try {
    const toolResponse = await fetch("/api/tool-execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: toolName, args: toolArgs }),
      signal
    });
    const toolData = await toolResponse.json();
    let resultText;

    if (toolName === "web_search") {
      const results = toolData.results || [];
      resultText = results.map((r, i) =>
        `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`
      ).join("\n\n");

      // Auto-read the top result to give the model rich content in one round
      if (results.length && results[0].url) {
        const topUrl = results[0].url;
        let topDomain;
        try { topDomain = new URL(topUrl).hostname; } catch { topDomain = topUrl.slice(0, 50); }
        setStatus(`📄 ${speakerLabel} reading: ${topDomain}`, "pending");
        _lastToolCalls.push({ tool: "web_read", url: topUrl, domain: topDomain });

        try {
          const readResp = await fetch("/api/tool-execute", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tool: "web_read", args: { url: topUrl } }),
            signal
          });
          const readData = await readResp.json();
          const pageText = readData.text || "";
          if (pageText) {
            // Truncate to ~2000 chars to avoid overwhelming context
            const trimmed = pageText.length > 2000 ? pageText.slice(0, 2000) + "\n\n[...truncated]" : pageText;
            resultText += `\n\n━━━ Full content from [1] (${topDomain}) ━━━\n${trimmed}\n━━━ End ━━━`;
            console.log(`[tools] Auto-read top result: ${topDomain} (${pageText.length} chars → ${trimmed.length} chars)`);
          }
        } catch (readErr) {
          console.debug("[tools] Auto-read failed (non-critical):", readErr.message);
        }
      }

      if (results.length > 1) {
        resultText += "\n\nOther URLs available for [READ:] if you need more detail.";
      }
    } else {
      resultText = toolData.text || toolData.error || "No content returned.";
    }

    console.log(`[tools] ${toolName} returned ${resultText.length} chars`);
    return resultText;
  } catch (err) {
    console.warn(`[tools] ${toolName} execution failed:`, err);
    return `Tool error: ${err.message}`;
  }
}

export function setStatus(message, tone = "pending") {
  if (!els) return;
  els.connectionStatus.textContent = message;
  els.connectionStatus.className = "status-pill";
  if (tone === "ok") els.connectionStatus.classList.add("connected");
  if (tone === "error") els.connectionStatus.classList.add("error");
}

export async function pingConnection(silent = false) {
  const baseUrl = state.settings.baseUrl || "http://127.0.0.1:1234";
  const apiKey = state.settings.apiKey || "lm-studio";
  try {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unreachable");
    const models = (data.data || []).map((m) => m.id).filter(Boolean);
    // Populate datalist
    if (els) {
      els.modelOptions.innerHTML = "";
      models.forEach((id) => {
        const option = document.createElement("option");
        option.value = id;
        els.modelOptions.append(option);
      });
      // Auto-select first model if none chosen
      if (!state.settings.model && models[0]) {
        state.settings.model = models[0];
        els.model.value = models[0];
      }
    }
    // Persist last known good connection
    try {
      sessionStorage.setItem("forum-last-baseurl", baseUrl);
      if (state.settings.model) sessionStorage.setItem("forum-last-model", state.settings.model);
    } catch (_) {}
    if (!silent) {
      setStatus(models.length ? `${models.length} model${models.length === 1 ? "" : "s"} available` : "Connected — no models listed", "ok");
    } else {
      setStatus(`Connected · ${models.length} model${models.length === 1 ? "" : "s"}`, "ok");
    }

    // Fetch extended model info (context length, capabilities) from /api/v0/models
    // Runs in the background — failure is silent since this is optional enrichment.
    fetch("/api/model-info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey })
    }).then((r) => r.json()).then((info) => {
      const models = info.data || [];
      // Find the currently selected model
      const current = state.settings.model
        ? models.find((m) => m.id === state.settings.model)
        : models.find((m) => m.state === "loaded");
      if (current?.loaded_context_length || current?.max_context_length) {
        state.contextInfo.maxContextLength = current.loaded_context_length || current.max_context_length;
        document.dispatchEvent(new CustomEvent("tokenUsageUpdated"));
      }
    }).catch(() => {}); // non-critical

    return true;
  } catch (error) {
    if (!silent) setStatus(error.message || "Could not reach LM Studio", "error");
    else setStatus("Not connected", "error");
    return false;
  }
}

export async function loadModels() {
  setStatus("Checking LM Studio…", "pending");
  await pingConnection(false);
}

let _pingInterval = null;
export function startConnectionPing() {
  if (_pingInterval) clearInterval(_pingInterval);
  pingConnection(true);
  _pingInterval = setInterval(() => {
    if (!document.hidden) pingConnection(true);
  }, 12000);
}

export function restoreLastConnection() {
  try {
    const lastUrl = sessionStorage.getItem("forum-last-baseurl");
    const lastModel = sessionStorage.getItem("forum-last-model");
    if (lastUrl && !state.settings.baseUrl) {
      state.settings.baseUrl = lastUrl;
      if (els) els.baseUrl.value = lastUrl;
    }
    if (lastModel && !state.settings.model) {
      state.settings.model = lastModel;
      if (els) els.model.value = lastModel;
    }
  } catch (_) {}
}

export async function getEmbedding(text) {
  if (!state.settings.model) {
    throw new Error("No model selected.");
  }
  const response = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      request: {
        model: state.settings.model,
        input: text
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Embeddings request failed.");
  }
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Invalid embedding response format.");
  }
  return embedding;
}
