/**
 * UI store — framework-agnostic external stores for transient UI signals:
 * connection status, generation-busy flag, and toast notifications.
 *
 * Module-layer code (api, turns, memory, …) drives these via the setters;
 * React components subscribe through the hooks in hooks/useActions.ts.
 * No React imports here.
 */
import type { ConnectionStatus, ConnectionTone } from '../types.js';

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

export function dismissToast(id: number): void {
  const next = _toasts.filter(t => t.id !== id);
  if (next.length === _toasts.length) return;
  _toasts = next;
  _toastVersion++;
  _toastListeners.forEach(fn => fn());
}

export function getToasts(): Toast[] {
  return _toasts;
}

export function getToastsVersion(): number {
  return _toastVersion;
}

export function subscribeToasts(cb: () => void): () => void {
  _toastListeners.add(cb);
  return () => _toastListeners.delete(cb);
}
