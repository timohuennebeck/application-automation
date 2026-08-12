import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/main.js -> project root
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const PRELOAD = path.join(__dirname, 'preload.mjs');

let win: BrowserWindow | null = null;

/* shell.openExternal hands the string to the OS handler, so anything beyond
   these schemes (file://, custom app schemes) would launch local files or
   other apps. Application URLs come from job listings, so treat them as
   untrusted. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function openExternal(url: string) {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) return false;
  shell.openExternal(url);
  return true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Native traffic lights sit inside our own top bar, matching the design.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1012' : '#fbfaf7',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  // External links open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

// Keeps the window chrome in sync when the renderer toggles the theme.
ipcMain.on('theme:set', (_e, theme: 'light' | 'dark') => {
  nativeTheme.themeSource = theme;
  win?.setBackgroundColor(theme === 'dark' ? '#0f1012' : '#fbfaf7');
});

ipcMain.handle('shell:openExternal', (_e, url: string) => openExternal(url));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  win = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
