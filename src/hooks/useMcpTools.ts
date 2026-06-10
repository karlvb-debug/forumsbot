/**
 * React bridge for the MCP tool registry (modules/tools.js).
 *
 * The registry refreshes when the connection pings; components subscribing
 * here re-render when discovery completes. Snapshots are reference-stable
 * between refreshes, as useSyncExternalStore requires.
 */
import { useSyncExternalStore } from 'react';
import { subscribeMcpTools, getMcpTools, getMcpErrors } from '../modules/tools.js';
import type { McpToolInfo } from '../types.js';

export interface McpServerError {
  server: string;
  error: string;
}

export function useMcpTools(): McpToolInfo[] {
  return useSyncExternalStore(subscribeMcpTools, getMcpTools);
}

export function useMcpErrors(): McpServerError[] {
  return useSyncExternalStore(subscribeMcpTools, getMcpErrors);
}
