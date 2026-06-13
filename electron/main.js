import { app, BrowserWindow, shell } from 'electron';
import { createServer as createNetServer } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The renderer's localStorage and IndexedDB are keyed by ORIGIN, and the
// packaged app's origin is http://127.0.0.1:<port>. If the port changes
// between launches, every launch lands on a fresh origin with empty storage
// and the user's sessions/settings appear wiped (they're stranded under the
// old origin). So the port must be stable: reuse the last successful port,
// fall back to a fixed default, and only walk forward when both are taken.
const DEFAULT_PORT = 41700;
const PORT_SCAN_RANGE = 20;

let serverPort = null;

function portFile() {
  return join(app.getPath('userData'), 'server-port.json');
}

function readSavedPort() {
  try {
    const saved = JSON.parse(readFileSync(portFile(), 'utf8'));
    const port = Number(saved?.port);
    return Number.isInteger(port) && port > 1024 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

function savePort(port) {
  try {
    writeFileSync(portFile(), JSON.stringify({ port }));
  } catch {
    // Best-effort: a failed save just means the next launch retries the default.
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createNetServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/** Bind to port 0 to let the OS pick a free port, then release it. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function resolveStablePort() {
  const saved = readSavedPort();
  const candidates = saved && saved !== DEFAULT_PORT ? [saved, DEFAULT_PORT] : [DEFAULT_PORT];
  for (let offset = 1; offset <= PORT_SCAN_RANGE; offset++) candidates.push(DEFAULT_PORT + offset);
  for (const port of candidates) {
    if (await isPortFree(port)) return port;
  }
  // Last resort: a random port so the app still launches. Storage from
  // previous launches won't be visible on this origin, but that beats not
  // starting at all — and the next launch retries the stable candidates.
  console.warn('[electron] no stable port available, falling back to a random port');
  return getFreePort();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Forum',
  });

  const url = app.isPackaged
    ? `http://127.0.0.1:${serverPort}`
    : (process.env.ELECTRON_DEV_URL || 'http://localhost:5173');

  win.loadURL(url);

  // Open links that aren't our own server in the system browser.
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const isLocal = app.isPackaged
      ? targetUrl.startsWith(`http://127.0.0.1:${serverPort}`)
      : targetUrl.startsWith('http://localhost:5173');
    if (!isLocal) shell.openExternal(targetUrl);
    return { action: isLocal ? 'allow' : 'deny' };
  });
}

// A second instance would race for the stable port, lose, and end up on a
// different origin without the user's data. Hand focus to the first instance
// instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) {
      serverPort = await resolveStablePort();
      savePort(serverPort);
      // Dynamic import so server.js isn't loaded (and thus doesn't auto-listen)
      // until we're ready to give it a port.
      const { startServer } = await import('../server.js');
      await startServer(serverPort);
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // macOS: re-open the window when the dock icon is clicked and no windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
