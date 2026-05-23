import { AVAILABLE_TOOLS, MAX_TOOL_ROUNDS } from './constants.js';
import { state } from './state.js';
import { parseAiJson, parseTextToolCalls, stripTextToolCalls, stripCodeFence } from './utils.js';

// Extract the message field content progressively from a streaming JSON buffer.
// Handles {"thought":"...","action":"...","message":"..."} with proper JSON unescape.
function extractStreamingMessage(accumulated) {
  const msgPattern = /"message"\s*:\s*"/;
  const match = msgPattern.exec(accumulated);
  if (!match) return null;
  let result = "";
  let escaped = false;
  for (let i = match.index + match[0].length; i < accumulated.length; i++) {
    const ch = accumulated[i];
    if (escaped) {
      if (ch === "n") result += "\n";
      else if (ch === "t") result += "\t";
      else if (ch === '"') result += '"';
      else if (ch === "\\") result += "\\";
      else result += ch;
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      break;
    } else {
      result += ch;
    }
  }
  return result;
}

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

    const startTime = Date.now();
    let response;
    let status = "ok";
    let data;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: state.settings.baseUrl,
          apiKey: state.settings.apiKey,
          request: payload
        }),
        signal
      });
      data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "LM Studio request failed.");
      }
    } catch (err) {
      status = err.name === "TimeoutError" ? "timeout" : "error";
      const apiLog = {
        timestamp: new Date().toISOString(),
        endpoint: "/v1/chat/completions",
        model: payload.model || "unknown",
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startTime,
        tokensPerSecondCompletion: 0,
        status,
        error: err.message
      };
      if (!state.diagnostics) state.diagnostics = {};
      if (!Array.isArray(state.diagnostics.apiCallLogs)) state.diagnostics.apiCallLogs = [];
      state.diagnostics.apiCallLogs.push(apiLog);
      if (state.diagnostics.apiCallLogs.length > 100) state.diagnostics.apiCallLogs.shift();
      throw err;
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = data?.usage?.prompt_tokens || 0;
    const completionTokens = data?.usage?.completion_tokens || 0;
    const tokensPerSecond = completionTokens && latencyMs > 0 ? Math.round(completionTokens / (latencyMs / 1000)) : 0;

    const apiLog = {
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions",
      model: payload.model || "unknown",
      promptTokens,
      completionTokens,
      latencyMs,
      tokensPerSecondCompletion: tokensPerSecond,
      status: "ok",
      estimatedCostCents: Number(((promptTokens * 0.00015 + completionTokens * 0.0006) / 1000).toFixed(4))
    };
    if (!state.diagnostics) state.diagnostics = {};
    if (!Array.isArray(state.diagnostics.apiCallLogs)) state.diagnostics.apiCallLogs = [];
    state.diagnostics.apiCallLogs.push(apiLog);
    if (state.diagnostics.apiCallLogs.length > 100) state.diagnostics.apiCallLogs.shift();

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
      state.contextInfo.lastPromptTokens = promptTokens;
      state.contextInfo.lastCompletionTokens = completionTokens;
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

/**
 * Stream a single-round chat completion, calling onChunk(delta, accumulated) for each token.
 * No tool-call handling — use chatCompletion for that. Returns the full accumulated text.
 */
export async function chatStream(system, user, { temperature = state.settings.temperature, maxTokens = state.settings.maxTokens, signal } = {}, onChunk = null) {
  const payload = {
    model: state.settings.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true
  };

  const startTime = Date.now();
  try {
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
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "LM Studio request failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let sseBuffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            completionTokens++;
            if (onChunk) onChunk(delta, accumulated);
          }
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || 0;
            completionTokens = parsed.usage.completion_tokens || completionTokens;
          }
        } catch { /* ignore malformed SSE line */ }
      }
    }

    const latencyMs = Date.now() - startTime;
    const tokensPerSecond = completionTokens && latencyMs > 0 ? Math.round(completionTokens / (latencyMs / 1000)) : 0;
    const apiLog = {
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions (stream)",
      model: payload.model || "unknown",
      promptTokens,
      completionTokens,
      latencyMs,
      tokensPerSecondCompletion: tokensPerSecond,
      status: "ok",
      estimatedCostCents: Number(((promptTokens * 0.00015 + completionTokens * 0.0006) / 1000).toFixed(4))
    };
    if (!state.diagnostics) state.diagnostics = {};
    if (!Array.isArray(state.diagnostics.apiCallLogs)) state.diagnostics.apiCallLogs = [];
    state.diagnostics.apiCallLogs.push(apiLog);
    if (state.diagnostics.apiCallLogs.length > 100) state.diagnostics.apiCallLogs.shift();
    if (promptTokens) {
      state.contextInfo.lastPromptTokens = promptTokens;
      state.contextInfo.lastCompletionTokens = completionTokens;
      document.dispatchEvent(new CustomEvent("tokenUsageUpdated"));
    }
    return accumulated;
  } catch (err) {
    const apiLog = {
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions (stream)",
      model: payload.model || "unknown",
      promptTokens: 0, completionTokens: 0,
      latencyMs: Date.now() - startTime,
      tokensPerSecondCompletion: 0,
      status: err.name === "TimeoutError" ? "timeout" : "error",
      error: err.message
    };
    if (!state.diagnostics) state.diagnostics = {};
    if (!Array.isArray(state.diagnostics.apiCallLogs)) state.diagnostics.apiCallLogs = [];
    state.diagnostics.apiCallLogs.push(apiLog);
    if (state.diagnostics.apiCallLogs.length > 100) state.diagnostics.apiCallLogs.shift();
    throw err;
  }
}

/**
 * Batch embedding request — embeds multiple texts in a single API call.
 * Returns an array of embedding vectors in the same order as the input texts.
 */
export async function getEmbeddingsBatch(texts) {
  if (!texts || !texts.length) return [];
  const modelToUse = state.settings.embeddingModel || state.settings.model;
  if (!modelToUse) throw new Error("No model selected.");
  const response = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      request: { model: modelToUse, input: texts }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Embeddings batch request failed.");
  const items = (data?.data || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  return items.map(item => item.embedding).filter(Array.isArray);
}

export async function chatJson(system, user, temperature, signal, onStream = null) {
  // Use streaming when: a callback is provided, tools won't be active, and streaming is enabled.
  const isToolMode = state.settings.toolsEnabled && state.scenario.mode !== "story";
  const canStream = onStream && !isToolMode && state.settings.streamingEnabled !== false;

  let content;
  if (canStream) {
    content = await chatStream(system, user, {
      temperature,
      maxTokens: state.settings.maxTokens,
      signal
    }, (_delta, accumulated) => {
      const msg = extractStreamingMessage(accumulated);
      if (msg !== null) onStream(msg);
    });
  } else {
    content = await chatCompletion(system, user, {
      temperature,
      maxTokens: state.settings.maxTokens,
      signal,
      useTools: true
    });
  }

  // Detect truncation: JSON that ends mid-string, mid-key, or with an unclosed brace
  // is almost always a token-budget hit rather than a model error.
  const looksLikeTruncation = (text) => {
    const t = text.trimEnd();
    // Ends without a closing brace, or ends inside a string value
    if (!t.endsWith("}") && !t.endsWith('"}') && !t.endsWith('"}')) return true;
    try { JSON.parse(stripCodeFence(t)); return false; } catch { return true; }
  };

  let finalContent = content;
  let retryAttempted = false;
  let retrySucceeded = false;

  let isStrictJson = true;
  let parseError = null;
  try {
    JSON.parse(stripCodeFence(content));
  } catch (err) {
    isStrictJson = false;
    parseError = err.message;

    // Truncation retry: one attempt with a higher token budget and a resume prompt
    if (looksLikeTruncation(content) && !signal?.aborted) {
      retryAttempted = true;
      try {
        const resumeUser = [
          "Your previous response was cut off before the JSON was complete. Here is what you sent:",
          "```",
          content.slice(-300), // show the tail so the model knows where it stopped
          "```",
          "Resume and return ONLY the complete, valid JSON object. Do not repeat content already sent — just complete the JSON from where it was cut off, starting with the missing fields or closing braces."
        ].join("\n");
        const retryContent = await chatCompletion(system, resumeUser, {
          temperature: 0.1, // deterministic for repair
          maxTokens: Math.min(state.settings.maxTokens * 2, 4000),
          signal,
          useTools: false
        });
        // Merge: try the retry content alone first, then as a suffix to the original
        const candidates = [retryContent, content + retryContent];
        for (const candidate of candidates) {
          try {
            JSON.parse(stripCodeFence(candidate));
            finalContent = candidate;
            isStrictJson = true;
            retrySucceeded = true;
            parseError = null;
            break;
          } catch { /* try next */ }
        }
      } catch {
        // Retry itself failed — fall through to normal fallback
      }
    }
  }

  const parsed = parseAiJson(finalContent);

  if (!isStrictJson) {
    if (!state.diagnostics) state.diagnostics = {};
    if (!Array.isArray(state.diagnostics.parseFailures)) state.diagnostics.parseFailures = [];
    state.diagnostics.parseFailures.push({
      timestamp: new Date().toISOString(),
      expectedSchema: "ActorEnvelope",
      rawOutput: content,
      parseError: parseError || "No strict JSON structure found",
      retryAttempted,
      retrySucceeded,
      fallbackUsed: (finalContent.includes("thought") || finalContent.includes("message")) ? "regex_extraction" : "raw_message_injection"
    });
    if (state.diagnostics.parseFailures.length > 50) state.diagnostics.parseFailures.shift();
  }

  Object.defineProperties(parsed, {
    _rawCompletion: { value: finalContent, writable: true, enumerable: false },
    _promptTokens: { value: state.contextInfo.lastPromptTokens, writable: true, enumerable: false },
    _completionTokens: { value: state.contextInfo.lastCompletionTokens, writable: true, enumerable: false },
    _parseFailure: { value: !isStrictJson, writable: true, enumerable: false }
  });

  return parsed;
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
    const parsed = JSON.parse(raw);
    Object.defineProperties(parsed, {
      _rawCompletion: { value: raw, writable: true, enumerable: false },
      _promptTokens: { value: state.contextInfo.lastPromptTokens, writable: true, enumerable: false },
      _completionTokens: { value: state.contextInfo.lastCompletionTokens, writable: true, enumerable: false },
      _parseFailure: { value: false, writable: true, enumerable: false }
    });
    return parsed;
  } catch (err) {
    // If schema-constrained call fails (model doesn't support it), fall back to plain call
    console.warn("[api] chatStructured schema mode failed, falling back to plain completion:", err.message);
    const raw = await chatCompletion(system, user, { temperature, maxTokens: maxTokens || state.settings.maxTokens, signal });
    const parsed = JSON.parse(raw);
    Object.defineProperties(parsed, {
      _rawCompletion: { value: raw, writable: true, enumerable: false },
      _promptTokens: { value: state.contextInfo.lastPromptTokens, writable: true, enumerable: false },
      _completionTokens: { value: state.contextInfo.lastCompletionTokens, writable: true, enumerable: false },
      _parseFailure: { value: true, writable: true, enumerable: false }
    });
    return parsed;
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

    // Probe the embedding endpoint so we can warn the user if it's broken.
    // Runs after every successful ping, silent — never blocks or throws.
    (async () => {
      const embedModel = state.settings.embeddingModel || state.settings.model;
      if (!embedModel) {
        document.dispatchEvent(new CustomEvent("embeddingProbeResult", {
          detail: { ok: false, reason: "No model configured. Semantic memory recall and drift detection are disabled." }
        }));
        return;
      }
      try {
        const resp = await fetch("/api/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseUrl, apiKey,
            request: { model: embedModel, input: "test" }
          }),
          signal: AbortSignal.timeout(5000)
        });
        const data = await resp.json();
        const ok = resp.ok && Array.isArray(data?.data?.[0]?.embedding);
        document.dispatchEvent(new CustomEvent("embeddingProbeResult", {
          detail: ok
            ? { ok: true }
            : { ok: false, reason: `Embedding model "${embedModel}" returned an error — semantic memory is in keyword-only mode.` }
        }));
      } catch {
        document.dispatchEvent(new CustomEvent("embeddingProbeResult", {
          detail: { ok: false, reason: `Embedding probe failed — check that an embedding model is loaded in LM Studio.` }
        }));
      }
    })();

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
  const modelToUse = state.settings.embeddingModel || state.settings.model;
  if (!modelToUse) {
    throw new Error("No model selected.");
  }
  const response = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      request: {
        model: modelToUse,
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
