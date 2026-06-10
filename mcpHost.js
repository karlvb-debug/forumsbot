/**
 * MCP host — connects to Model Context Protocol servers declared in
 * mcp.config.json and exposes their tools to the rest of the proxy.
 *
 * Config format (file is optional; absent file = MCP disabled, zero cost):
 *   {
 *     "servers": {
 *       "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
 *       "remote": { "url": "http://127.0.0.1:8808/mcp" },
 *       "off":    { "command": "...", "enabled": false }
 *     }
 *   }
 *
 * Security model: this file is the ONLY way servers get added — there is no
 * UI or API write path, so actors can list and call tools but never grant
 * themselves new ones. Tool results are treated as untrusted data by the
 * caller (server.js wraps them in the same header as web_read).
 *
 * Tools are namespaced "mcp:<server>.<tool>" so the client can route any
 * such name through /api/tool-execute without per-tool wiring. Server names
 * must not contain "." (skipped with a warning if they do).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const RESULT_CHAR_CAP = 3000;
const CALL_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

let configPath = process.env.MCP_CONFIG || join(__dirname, "mcp.config.json");
/** serverName → { client, tools } on success, { error } on failure */
let clients = new Map();
let initPromise = null;

/** Point the host at a different config and drop all connections (tests). */
export async function resetMcp(newConfigPath = null) {
  await closeMcp();
  if (newConfigPath) configPath = newConfigPath;
}

export async function closeMcp() {
  const open = [...clients.values()].filter((entry) => entry.client);
  clients = new Map();
  initPromise = null;
  await Promise.allSettled(open.map((entry) => entry.client.close()));
}

async function loadConfig() {
  let text;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return null; // no config file — MCP is off
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.warn(`[mcp] ${configPath} is not valid JSON: ${err?.message}`);
    return null;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function connectServer(name, cfg) {
  // SDK is imported lazily so a missing/broken install only matters once a
  // config actually exists.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  let transport;
  if (cfg.url) {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    transport = new StreamableHTTPClientTransport(new URL(cfg.url));
  } else if (cfg.command) {
    const { StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    transport = new StdioClientTransport({
      command: cfg.command,
      args: Array.isArray(cfg.args) ? cfg.args : [],
      // Children get the SDK's minimal safe env, plus explicit config additions
      // — never the proxy's full process.env.
      env: cfg.env && typeof cfg.env === "object"
        ? { ...getDefaultEnvironment(), ...cfg.env }
        : undefined,
      stderr: "ignore",
    });
  } else {
    throw new Error("Server config needs either \"command\" (stdio) or \"url\" (HTTP).");
  }

  const client = new Client({ name: "forumsbot", version: "1.0.0" });
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `Connect to "${name}" timed out.`);
  const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `tools/list for "${name}" timed out.`);
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  return { client, tools, cfg };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Effective limit for a call: per-tool override → per-server default → global
// default. Config: { "timeoutMs": …, "resultCharCap": …, "tools": { "name":
// { "timeoutMs": …, "resultCharCap": … } } } on any server entry.
function resolveLimits(cfg, toolName) {
  const toolCfg = cfg?.tools && typeof cfg.tools === "object" ? cfg.tools[toolName] : null;
  return {
    timeoutMs: clampNumber(toolCfg?.timeoutMs ?? cfg?.timeoutMs, 50, 120_000, CALL_TIMEOUT_MS),
    resultCharCap: clampNumber(toolCfg?.resultCharCap ?? cfg?.resultCharCap, 100, 20_000, RESULT_CHAR_CAP),
  };
}

function ensureInit() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const config = await loadConfig();
    const servers = config?.servers && typeof config.servers === "object" ? config.servers : {};
    await Promise.all(Object.entries(servers).map(async ([name, cfg]) => {
      if (!cfg || typeof cfg !== "object" || cfg.enabled === false) return;
      if (name.includes(".") || name.includes(":")) {
        console.warn(`[mcp] skipping server "${name}" — names must not contain "." or ":".`);
        return;
      }
      try {
        clients.set(name, await connectServer(name, cfg));
        console.log(`[mcp] connected "${name}" (${clients.get(name).tools.length} tools)`);
      } catch (err) {
        console.warn(`[mcp] failed to connect "${name}": ${err?.message || err}`);
        clients.set(name, { error: String(err?.message || err) });
      }
    }));
  })();
  return initPromise;
}

/**
 * All tools from connected servers, namespaced and sorted for stable
 * ordering (prompt sections built from this list must not churn the KV
 * cache). Failed servers appear in `errors` so the UI can surface them.
 */
export async function listMcpTools() {
  await ensureInit();
  const tools = [];
  const errors = [];
  for (const [server, entry] of clients) {
    if (!entry.client) {
      errors.push({ server, error: entry.error });
      continue;
    }
    for (const t of entry.tools) {
      tools.push({
        name: `mcp:${server}.${t.name}`,
        description: String(t.description || ""),
        inputSchema: t.inputSchema || { type: "object" },
        server,
        // readOnlyHint/destructiveHint drive the grant UI's risk badges.
        annotations: t.annotations && typeof t.annotations === "object" ? t.annotations : undefined,
      });
    }
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return { tools, errors };
}

/**
 * Call a namespaced tool ("mcp:server.tool"). Returns plain text, capped and
 * timeout-bounded per resolveLimits (config-overridable per server or per
 * tool). Tool-level failures (isError results) come back as "Tool error: …"
 * text so the model gets feedback; protocol/config failures throw.
 */
export async function callMcpTool(fullName, args = {}, { timeoutMs = null } = {}) {
  await ensureInit();
  const match = /^mcp:([^.:]+)\.(.+)$/.exec(String(fullName || ""));
  if (!match) throw new Error(`Invalid MCP tool name: ${fullName}`);
  const [, server, toolName] = match;
  const entry = clients.get(server);
  if (!entry) throw new Error(`Unknown MCP server: ${server}`);
  if (!entry.client) throw new Error(`MCP server "${server}" is unavailable: ${entry.error}`);
  if (!entry.tools.some((t) => t.name === toolName)) {
    throw new Error(`Unknown tool "${toolName}" on MCP server "${server}".`);
  }

  const limits = resolveLimits(entry.cfg, toolName);
  const effectiveTimeout = timeoutMs != null ? clampNumber(timeoutMs, 50, 120_000, limits.timeoutMs) : limits.timeoutMs;
  const result = await withTimeout(
    entry.client.callTool({ name: toolName, arguments: args && typeof args === "object" ? args : {} }),
    effectiveTimeout,
    `MCP tool "${fullName}" timed out after ${effectiveTimeout}ms.`
  );

  const text = (Array.isArray(result?.content) ? result.content : [])
    .map((item) => (item?.type === "text" ? String(item.text ?? "") : `[${item?.type || "unknown"} content omitted]`))
    .join("\n")
    .trim();

  const capped = text.length > limits.resultCharCap ? `${text.slice(0, limits.resultCharCap)}…[truncated]` : text;
  if (result?.isError) return `Tool error: ${capped || "MCP tool reported an error."}`;
  return capped || "No content returned.";
}
