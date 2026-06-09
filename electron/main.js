import { app, BrowserWindow, shell } from 'electron';
import { createServer as createNetServer } from 'node:net';

let serverPort = null;

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

app.whenReady().then(async () => {
  if (app.isPackaged) {
    serverPort = await getFreePort();
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
