/**
 * Action hooks — exposes turn orchestration, connection, and session
 * actions as functions React components can call.
 */
import { useCallback } from 'react';
import { state } from '../modules/state.js';
import { saveState, notifyStateChange } from './useForumState.js';
import type { ConnectionStatus, ConnectionTone } from '../types.js';

// ── Lazy module refs ─────────────────────────────────────────────────
// Set by setModuleRefs() in App.jsx after all modules load.
interface ModuleRefs {
  turns: Record<string, (...args: unknown[]) => unknown> | null;
  api: Record<string, (...args: unknown[]) => unknown> | null;
  session: Record<string, (...args: unknown[]) => unknown> | null;
  memory: Record<string, (...args: unknown[]) => unknown> | null;
  db: Record<string, (...args: unknown[]) => unknown> | null;
}

let _turns: ModuleRefs['turns'] = null;
let _api: ModuleRefs['api'] = null;
let _session: ModuleRefs['session'] = null;
let _memory: ModuleRefs['memory'] = null;
let _db: ModuleRefs['db'] = null;

export function setModuleRefs({ turns, api, session, memory, db }: ModuleRefs): void {
  _turns = turns;
  _api = api;
  _session = session;
  _memory = memory;
  _db = db;
}

// ── Connection status ────────────────────────────────────────────────
let _connectionStatus: ConnectionStatus = { message: 'disconnected', tone: '' as ConnectionTone };
let _statusVersion = 0;
const _statusListeners = new Set<() => void>();

export function setConnectionStatus(message: string, tone: ConnectionTone): void {
  _connectionStatus = { message, tone };
  _statusVersion++;
  _statusListeners.forEach(fn => fn());
}

export function getConnectionStatusVersion(): number {
  return _statusVersion;
}

export function getConnectionStatus(): ConnectionStatus {
  return _connectionStatus;
}

export function subscribeConnectionStatus(cb: () => void): () => void {
  _statusListeners.add(cb);
  return () => _statusListeners.delete(cb);
}

// ── Busy state ───────────────────────────────────────────────────────
let _busy = false;
let _busyVersion = 0;
const _busyListeners = new Set<() => void>();

export function setBusy(value: boolean): void {
  _busy = value;
  _busyVersion++;
  _busyListeners.forEach(fn => fn());
}

export function getBusy(): boolean {
  return _busy;
}

export function getBusyVersion(): number {
  return _busyVersion;
}

export function subscribeBusy(cb: () => void): () => void {
  _busyListeners.add(cb);
  return () => _busyListeners.delete(cb);
}

// ── Toast notifications ──────────────────────────────────────────────
export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'warn' | 'error';
}

let _toasts: Toast[] = [];
let _toastVersion = 0;
const _toastListeners = new Set<() => void>();

export function showToast(message: string, type: Toast['type'] = 'info', duration = 5000): number {
  const id = Date.now() + Math.random();
  _toasts = [..._toasts, { id, message, type }];
  _toastVersion++;
  _toastListeners.forEach(fn => fn());
  if (duration > 0) {
    setTimeout(() => {
      _toasts = _toasts.filter(t => t.id !== id);
      _toastVersion++;
      _toastListeners.forEach(fn => fn());
    }, duration);
  }
  return id;
}

export function getToasts(): Toast[] {
  return _toasts;
}

export function subscribeToasts(cb: () => void): () => void {
  _toastListeners.add(cb);
  return () => _toastListeners.delete(cb);
}

// ── Action functions for components ─────────────────────────────────

export function useActions() {
  const nextTurn = useCallback(async () => {
    if (_turns) await (_turns.runNextTurn as () => Promise<void>)();
  }, []);

  const runRound = useCallback(async () => {
    if (_turns) await (_turns.runRound as () => Promise<void>)();
  }, []);

  const startAuto = useCallback(async () => {
    if (_turns) await (_turns.runAutoLoop as () => Promise<void>)();
  }, []);

  const stopGeneration = useCallback(() => {
    if (_turns) (_turns.stopGeneration as () => void)();
    (state as { autoRunning: boolean }).autoRunning = false;
    notifyStateChange();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const message = {
      id: 'user-' + Date.now(),
      speaker: 'You',
      color: 'var(--fg-dim)',
      text: text.trim(),
      content: text.trim(),
      type: 'user' as const,
      createdAt: Date.now(),
    };
    const stateWithMessages = state as { messages: unknown[] };
    stateWithMessages.messages = [...stateWithMessages.messages, message];
    if (_db) await (_db.putMessage as (m: unknown) => Promise<void>)(message);
    saveState();
    // Fire on_user_message trigger actors (background orchestrators react to user input)
    if (_turns) await (_turns.fireUserMessageTriggers as (m: string) => Promise<void>)(text.trim());
  }, []);

  const pingConnection = useCallback(async () => {
    if (_api) await (_api.pingConnection as () => Promise<void>)();
  }, []);

  const loadModels = useCallback(async () => {
    if (_api) await (_api.loadModels as () => Promise<void>)();
  }, []);

  const directorBrief = useCallback(async () => {
    if (_turns) await (_turns.runDirectorBrief as () => Promise<void>)();
  }, []);

  return { nextTurn, runRound, startAuto, stopGeneration, sendMessage, pingConnection, loadModels, directorBrief };
}
