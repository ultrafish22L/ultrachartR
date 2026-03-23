/**
 * UltraChart — Electron Main Process
 *
 * Embeds the Express proxy server and serves the Vite SPA build.
 * All API routes (/ib/*, /chart/*) and static files served from one origin.
 */
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer, connectToTWS } from '../proxy/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  // Resolve directories — dist-electron/electron/main.js → web/
  const webRoot = path.join(__dirname, '..', '..');
  const distDir = path.join(webRoot, 'dist');
  const chartsDir = path.join(webRoot, 'public');
  const cacheDir = path.join(webRoot, 'proxy', 'cache');

  // Start embedded Express server with static file serving
  const port = await startServer({
    port: 5050,
    staticDir: distDir,
    chartsDir,
    cacheDir,
  });

  // Connect to TWS in background (non-fatal)
  connectToTWS().catch((err: Error) => {
    console.warn(`TWS not available: ${err.message}`);
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'UltraChart',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
