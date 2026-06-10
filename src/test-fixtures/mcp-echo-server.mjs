#!/usr/bin/env node
/**
 * Minimal MCP stdio server used by mcpHost.test.js — implements just enough
 * of the protocol (initialize, tools/list, tools/call) over newline-delimited
 * JSON-RPC, with no dependencies, so tests stay hermetic: no network, no API
 * keys, no npx downloads.
 */
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "echo",
    description: "Echo a message back.",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
  {
    name: "big",
    description: "Return a 10,000-character payload (exercises the result cap).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "boom",
    description: "Always fails with a tool-level error.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "slow",
    description: "Responds after 300ms (exercises per-tool timeouts).",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const { id, method, params } = request;
  if (id == null) return; // notification — nothing to answer

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-fixture", version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "echo") {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `echo: ${args.message || ""}` }] } });
    } else if (name === "big") {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "x".repeat(10_000) }] } });
    } else if (name === "boom") {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "kaboom" }], isError: true } });
    } else if (name === "slow") {
      setTimeout(() => {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "finally done" }] } });
      }, 300);
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
  } else {
    // Answer anything else (ping etc.) so the client never hangs on us.
    send({ jsonrpc: "2.0", id, result: {} });
  }
});
