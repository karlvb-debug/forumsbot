/**
 * Action hooks — exposes turn orchestration, connection, and session
 * actions as functions React components can call.
 *
 * These wrap the existing logic module functions and handle the
 * busy/generating state management.
 */
import { useCallback } from 'react';
import { state } from '../modules/state.js';
import { saveState, notifyStateChange } from './useForumState.js';

// ── Lazy imports to avoid circular deps ─────────────────────────────
// These are set by initModules() in App.jsx after all modules load.
let _turns = null;
let _api = null;
let _session = null;
let _memory = null;
let _db = null;

export function setModuleRefs({ turns, api, session, memory, db }) {
  _turns = turns;
  _api = api;
  _session = session;
  _memory = memory;
  _db = db;
}

// ── Connection status (event-based, replaces DOM setStatus) ─────────
let _connectionStatus = { message: 'disconnected', tone: '' };
let _statusVersion = 0;
const _statusListeners = new Set();

export function setConnectionStatus(message, tone) {
  _connectionStatus = { message, tone };
  _statusVersion++;
  _statusListeners.forEach(fn => fn());
}

export function getConnectionStatusVersion() {
  return _statusVersion;
}

export function getConnectionStatus() {
  return _connectionStatus;
}

export function subscribeConnectionStatus(cb) {
  _statusListeners.add(cb);
  return () => _statusListeners.delete(cb);
}

// ── Busy state (replaces setBusy DOM manipulation) ──────────────────
let _busy = false;
let _busyVersion = 0;
const _busyListeners = new Set();

export function setBusy(value) {
  _busy = value;
  _busyVersion++;
  _busyListeners.forEach(fn => fn());
}

export function getBusy() {
  return _busy;
}

export function getBusyVersion() {
  return _busyVersion;
}

export function subscribeBusy(cb) {
  _busyListeners.add(cb);
  return () => _busyListeners.delete(cb);
}

// ── Toast notifications ─────────────────────────────────────────────
let _toasts = [];
let _toastVersion = 0;
const _toastListeners = new Set();

export function showToast(message, type = 'info', duration = 5000) {
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

export function getToasts() {
  return _toasts;
}

export function subscribeToasts(cb) {
  _toastListeners.add(cb);
  return () => _toastListeners.delete(cb);
}

// ── Action functions for components ─────────────────────────────────

export function useActions() {
  const nextTurn = useCallback(async () => {
    if (_turns) await _turns.runNextTurn();
  }, []);

  const runRound = useCallback(async () => {
    if (_turns) await _turns.runRound();
  }, []);

  const startAuto = useCallback(async () => {
    // runAutoLoop is a toggle: reads !state.autoRunning to decide start/stop
    if (_turns) await _turns.runAutoLoop();
  }, []);

  const stopGeneration = useCallback(() => {
    if (_turns) _turns.stopGeneration();
    state.autoRunning = false;
    notifyStateChange();
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    const message = {
      id: 'user-' + Date.now(),
      speaker: 'You',
      color: 'var(--fg-dim)',
      text: text.trim(),
      type: 'user',
      createdAt: Date.now(),
    };
    state.messages.push(message);
    if (_db) await _db.putMessage(message);
    saveState();
  }, []);

  const pingConnection = useCallback(async () => {
    if (_api) await _api.pingConnection();
  }, []);

  const loadModels = useCallback(async () => {
    if (_api) await _api.loadModels();
  }, []);

  return {
    nextTurn,
    runRound,
    startAuto,
    stopGeneration,
    sendMessage,
    pingConnection,
    loadModels,
  };
}
