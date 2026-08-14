import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/open.ts';
import { seedIfEmpty } from './db/seed.ts';
import { createRepo } from './db/repo.ts';
import { registerDbIpc } from './db/ipc.ts';
import {
  copyCommentAttachment,
  copyDocument,
  copyTemplate,
  documentPaths,
  documentSize,
  listTemplates,
  purgeApplicationFiles,
  removeStoredFile,
  resolveDocumentPath,
  templatePath,
} from './files.ts';
import { renderPdf } from './pdf.ts';
import type { DocumentUpload } from '../src/shared/domain.ts';
import type { DocumentKind, TemplateKind } from '../src/shared/enums.ts';

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

/* Document files. The picker runs here because the renderer, with context
   isolation on, never sees a real path — and because the dialog's file-type
   filter is a suggestion on macOS, the extension is checked again in
   copyDocument before anything is written. */
/* The renderer names a file type rather than handing over dialog options, so
   what the picker offers stays decided here. */
const FILE_TYPES: Record<string, { name: string; extensions: string[] }> = {
  docx: { name: 'Word-Dokument', extensions: ['docx'] },
  html: { name: 'HTML-Datei', extensions: ['html', 'htm'] },
};

ipcMain.handle('documents:pick', async (_e, title: string, type: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile'],
    filters: [FILE_TYPES[type] ?? FILE_TYPES.docx],
  });
  return res.canceled ? null : (res.filePaths[0] ?? null);
});

/* Takes in the HTML and renders the PDF beside it in one step, so a row never
   claims a source without the export that belongs to it. A failed export is
   reported rather than thrown: the upload itself worked, and losing it because
   Chromium could not print the file would be the wrong trade. */
ipcMain.handle(
  'documents:copy',
  async (_e, applicationId: string, kind: DocumentKind, sourcePath: string): Promise<DocumentUpload> => {
    const userData = app.getPath('userData');
    const filePath = copyDocument(userData, applicationId, kind, sourcePath);
    const { htmlAbs, pdfAbs, pdfRel } = documentPaths(userData, applicationId, kind);
    try {
      await renderPdf(htmlAbs, pdfAbs);
      return { filePath, pdfPath: pdfRel, pdfError: null };
    } catch (err) {
      // Whatever was exported from the previous version is no longer this one.
      rmSync(pdfAbs, { force: true });
      return { filePath, pdfPath: null, pdfError: String(err) };
    }
  },
);

/* Sizes for the document menu, in one round trip. */
ipcMain.handle('documents:sizes', (_e, filePaths: string[]) =>
  filePaths.map((p) => documentSize(app.getPath('userData'), p)),
);

/* Opens the stored file in whatever the OS uses for .docx. Returns the error
   string openPath gives on failure ('' means it opened). */
ipcMain.handle('documents:open', (_e, filePath: string) =>
  shell.openPath(resolveDocumentPath(app.getPath('userData'), filePath)),
);

/* Comment attachments: any file type, several at once. Unlike documents there
   is no fixed slot, so the picker is unfiltered and multi-select. */

/* Every source picked this session. openSource refuses anything else, so the
   renderer can only hand the OS paths the user chose in the dialog. */
const pickedAttachmentSources = new Set<string>();

ipcMain.handle('attachments:pick', async (_e, title: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  for (const p of res.filePaths) pickedAttachmentSources.add(p);
  return res.filePaths.map((p) => ({ path: p, name: path.basename(p), size: statSync(p).size }));
});

/* Opens a staged source that has not been sent yet — the copy in userData only
   exists after send, so this opens the original. '' on success, else the reason. */
ipcMain.handle('attachments:openSource', (_e, sourcePath: string) => {
  if (!pickedAttachmentSources.has(sourcePath)) return 'Unbekannte Datei.';
  return shell.openPath(sourcePath);
});

/* Copies the staged sources into userData at send time; the comment's rows are
   only written from what this returns, so a row never points at missing bytes. */
ipcMain.handle('attachments:copy', (_e, applicationId: string, sourcePaths: string[]) =>
  sourcePaths.map((p) => copyCommentAttachment(app.getPath('userData'), applicationId, p)),
);

/* Profile templates: the two documents that are not tied to an application.
   They share the picker above, so the extension is checked once more in
   copyTemplate before anything is written. */
ipcMain.handle('templates:list', () => listTemplates(app.getPath('userData')));

ipcMain.handle('templates:save', (_e, kind: TemplateKind, sourcePath: string) =>
  copyTemplate(app.getPath('userData'), kind, sourcePath),
);

ipcMain.handle('templates:open', (_e, kind: TemplateKind) => {
  const filePath = templatePath(app.getPath('userData'), kind);
  return filePath ? shell.openPath(filePath) : 'Noch keine Datei hochgeladen.';
});

/* The database must be usable before any window exists; a broken store means
   quit with an error rather than silently running in-memory and losing edits. */
function initDb(): boolean {
  try {
    const db = openDb(path.join(app.getPath('userData'), 'bewerbungen.db'));
    seedIfEmpty(db);
    registerDbIpc(createRepo(db), {
      afterDeleteApplication: (id) => purgeApplicationFiles(app.getPath('userData'), id),
      afterDeleteComment: (paths) => paths.forEach((p) => removeStoredFile(app.getPath('userData'), p)),
    });
    return true;
  } catch (err) {
    dialog.showErrorBox('Datenbank-Fehler', 'Die Datenbank konnte nicht geöffnet werden:\n\n' + String(err));
    app.quit();
    return false;
  }
}

app.whenReady().then(() => {
  if (initDb()) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  win = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
