/**
 * Client-side tool registry.
 *
 * Built-in web tools are static; MCP tools are discovered from the proxy's
 * GET /api/mcp/tools at connect time and cached here. The registry feeds two
 * consumers:
 *  - api.js passes getKnownToolNames() to parseTextToolCalls so only
 *    registered tools can ever be executed from model output.
 *  - actorPrompt.js renders getMcpTools() into the tool instructions for
 *    research-capable actors.
 */

export const BUILT_IN_TOOL_NAMES = ["web_search", "web_read"];

let _mcpTools = [];
let _mcpErrors = [];
let _inFlight = null;

/** MCP tools discovered from the proxy (empty until refreshMcpTools runs). */
export function getMcpTools() {
  return _mcpTools;
}

/** Per-server connection failures, for surfacing in the UI. */
export function getMcpErrors() {
  return _mcpErrors;
}

/** Every executable tool name: built-ins plus discovered MCP tools. */
export function getKnownToolNames() {
  return [...BUILT_IN_TOOL_NAMES, ..._mcpTools.map((t) => t.name)];
}

/**
 * Re-query the proxy for available MCP tools. Failures keep the previous
 * list — a transient fetch error must not strip tool access mid-session.
 */
export function refreshMcpTools() {
  if (_inFlight) return _inFlight;
  _inFlight = fetch("/api/mcp/tools")
    .then((res) => res.json())
    .then((data) => {
      _mcpTools = Array.isArray(data?.tools) ? data.tools : [];
      _mcpErrors = Array.isArray(data?.errors) ? data.errors : [];
      return _mcpTools;
    })
    .catch(() => _mcpTools)
    .finally(() => { _inFlight = null; });
  return _inFlight;
}

/** Test hook — seed or clear the registry without a network round-trip. */
export function _setMcpToolsForTest(tools) {
  _mcpTools = Array.isArray(tools) ? tools : [];
  _mcpErrors = [];
}
