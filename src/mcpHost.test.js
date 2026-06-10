// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMcpTools, callMcpTool, resetMcp, closeMcp } from '../mcpHost.js';

const fixturePath = fileURLToPath(new URL('./test-fixtures/mcp-echo-server.mjs', import.meta.url));

let tmpDir;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mcp-test-'));
  const configPath = join(tmpDir, 'mcp.config.json');
  await writeFile(configPath, JSON.stringify({
    servers: {
      echo: { command: process.execPath, args: [fixturePath] },
      disabled: { command: process.execPath, args: [fixturePath], enabled: false },
      broken: {}, // neither command nor url — must fail without blocking others
      'bad.name': { command: process.execPath, args: [fixturePath] }, // dots are reserved
    },
  }));
  await resetMcp(configPath);
});

afterAll(async () => {
  await closeMcp();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('listMcpTools', () => {
  it('returns namespaced tools from connected servers, sorted by name', async () => {
    const { tools } = await listMcpTools();
    expect(tools.map((t) => t.name)).toEqual(['mcp:echo.big', 'mcp:echo.boom', 'mcp:echo.echo', 'mcp:echo.slow']);
    expect(tools.every((t) => t.server === 'echo')).toBe(true);
    expect(tools[2].description).toBe('Echo a message back.');
    expect(tools[2].inputSchema?.properties?.message?.type).toBe('string');
  });

  it('reports unconnectable servers in errors without blocking the rest', async () => {
    const { errors } = await listMcpTools();
    expect(errors).toHaveLength(1);
    expect(errors[0].server).toBe('broken');
    expect(errors[0].error).toMatch(/command.*url/i);
  });

  it('skips disabled servers and servers with reserved characters in the name', async () => {
    const { tools, errors } = await listMcpTools();
    const servers = new Set([...tools.map((t) => t.server), ...errors.map((e) => e.server)]);
    expect(servers.has('disabled')).toBe(false);
    expect(servers.has('bad.name')).toBe(false);
  });
});

describe('callMcpTool', () => {
  it('round-trips a call through the stdio server', async () => {
    const text = await callMcpTool('mcp:echo.echo', { message: 'hello world' });
    expect(text).toBe('echo: hello world');
  });

  it('caps oversized results', async () => {
    const text = await callMcpTool('mcp:echo.big', {});
    expect(text.length).toBeLessThan(3100);
    expect(text.endsWith('…[truncated]')).toBe(true);
  });

  it('returns tool-level failures as feedback text instead of throwing', async () => {
    const text = await callMcpTool('mcp:echo.boom', {});
    expect(text).toBe('Tool error: kaboom');
  });

  it('rejects tools the server never listed', async () => {
    await expect(callMcpTool('mcp:echo.nope', {})).rejects.toThrow(/Unknown tool "nope"/);
  });

  it('rejects unknown servers and malformed names', async () => {
    await expect(callMcpTool('mcp:ghost.echo', {})).rejects.toThrow(/Unknown MCP server/);
    await expect(callMcpTool('web_search', {})).rejects.toThrow(/Invalid MCP tool name/);
  });

  it('tolerates non-object args', async () => {
    const text = await callMcpTool('mcp:echo.echo', null);
    expect(text).toBe('echo:'); // result text is trimmed
  });
});

describe('per-server and per-tool limits', () => {
  beforeAll(async () => {
    const configPath = join(tmpDir, 'mcp.limits.json');
    await writeFile(configPath, JSON.stringify({
      servers: {
        echo: {
          command: process.execPath,
          args: [fixturePath],
          resultCharCap: 500,
          timeoutMs: 5000,
          tools: {
            big: { resultCharCap: 1000 },
            slow: { timeoutMs: 60 },
          },
        },
      },
    }));
    await resetMcp(configPath);
  });

  it('applies the server-level result cap', async () => {
    const text = await callMcpTool('mcp:echo.echo', { message: 'y'.repeat(600) });
    expect(text).toBe(`echo: ${'y'.repeat(494)}…[truncated]`); // 500 chars + marker
  });

  it('lets a per-tool cap override the server default', async () => {
    const text = await callMcpTool('mcp:echo.big', {});
    expect(text).toBe('x'.repeat(1000) + '…[truncated]');
  });

  it('enforces a per-tool timeout', async () => {
    await expect(callMcpTool('mcp:echo.slow', {})).rejects.toThrow(/timed out after 60ms/);
  });
});

describe('missing config', () => {
  it('yields an empty tool list, not an error', async () => {
    await resetMcp(join(tmpDir, 'does-not-exist.json'));
    const { tools, errors } = await listMcpTools();
    expect(tools).toEqual([]);
    expect(errors).toEqual([]);
  });
});
