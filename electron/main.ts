import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/open.ts';
import { seedIfEmpty } from './db/seed.ts';
import { createRepo } from './db/repo.ts';
import { registerDbIpc } from './db/ipc.ts';
import { registerAgentIpc } from './agent/index.ts';
import {
  addProfileDocuments,
  copyCommentAttachment,
  copyDocument,
  addTemplateVersion,
  documentPaths,
  documentSize,
  listProfileDocuments,
  listTemplates,
  profileDocumentPath,
  purgeApplicationFiles,
  removeProfileDocument,
  removeStoredFile,
  resolveDocumentPath,
  removeTemplateVersion,
  renameTemplateVersion,
  replaceTemplateVersion,
  selectTemplateVersion,
  selectedTemplatePath,
  templatePdfPath,
  templateVersionPath,
  listTemplateVersions,
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

/* One instance only. Two processes on the same SQLite file would each run
   boot recovery — the second would declare the first's in-flight Kepler runs
   dead while they are still working. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

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

/* The app's file root — where the database, documents and templates live. */
const root = () => app.getPath('userData');

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

/* Every source picked this session. The copy channels refuse anything else,
   so the renderer can only ingest OS paths the user chose in the dialog —
   the same stance attachments:openSource takes. */
const pickedDocumentSources = new Set<string>();

function requirePicked(sourcePath: string): void {
  if (!pickedDocumentSources.has(sourcePath)) throw new Error('Unbekannte Datei.');
}

ipcMain.handle('documents:pick', async (_e, title: string, type: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile'],
    filters: [FILE_TYPES[type] ?? FILE_TYPES.docx],
  });
  const picked = res.canceled ? null : (res.filePaths[0] ?? null);
  if (picked) pickedDocumentSources.add(picked);
  return picked;
});

/* Takes in the HTML and renders the PDF beside it in one step, so a row never
   claims a source without the export that belongs to it. A failed export is
   reported rather than thrown: the upload itself worked, and losing it because
   Chromium could not print the file would be the wrong trade. */
ipcMain.handle(
  'documents:copy',
  async (_e, applicationId: string, kind: DocumentKind, sourcePath: string): Promise<DocumentUpload> => {
    requirePicked(sourcePath);
    const userData = root();
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
  filePaths.map((p) => documentSize(root(), p)),
);

/* Opens the stored file in whatever the OS uses for .docx. Returns the error
   string openPath gives on failure ('' means it opened). */
ipcMain.handle('documents:open', (_e, filePath: string) =>
  shell.openPath(resolveDocumentPath(root(), filePath)),
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
  sourcePaths.map((p) => copyCommentAttachment(root(), applicationId, p)),
);

/* Profile templates: the Fassungen of the two documents that are not tied to
   an application. They share the picker above, so the extension is checked
   once more in the file layer before anything is written. */
ipcMain.handle('templates:list', () => listTemplates(root()));

ipcMain.handle('templates:add', (_e, kind: TemplateKind, sourcePath: string) => {
  requirePicked(sourcePath);
  return addTemplateVersion(root(), kind, sourcePath);
});

ipcMain.handle('templates:replace', (_e, kind: TemplateKind, label: string, sourcePath: string) => {
  requirePicked(sourcePath);
  return replaceTemplateVersion(root(), kind, label, sourcePath);
});

ipcMain.handle('templates:select', (_e, kind: TemplateKind, label: string) =>
  selectTemplateVersion(root(), kind, label),
);

ipcMain.handle('templates:rename', (_e, kind: TemplateKind, from: string, to: string) =>
  renameTemplateVersion(root(), kind, from, to),
);

ipcMain.handle('templates:remove', (_e, kind: TemplateKind, label: string) =>
  removeTemplateVersion(root(), kind, label),
);

/* Without a label the selected Fassung opens — what the agent panel's doc
   chips point at. */
ipcMain.handle('templates:open', (_e, kind: TemplateKind, label?: string) => {
  const filePath = label
    ? templateVersionPath(root(), kind, label)
    : (selectedTemplatePath(root(), kind)?.path ?? null);
  return filePath ? shell.openPath(filePath) : 'Noch keine Datei hochgeladen.';
});

/* One render per PDF at a time: a double-click must not race two hidden
   Chromium prints onto the same file — the loser's cleanup would delete what
   the winner just wrote. Later clicks queue behind the running render. */
const pdfRenders = new Map<string, Promise<void>>();

/* The PDF of one Fassung, rendered beside its HTML on first request and again
   whenever the HTML is newer than the last render — the profile has nothing
   else that would trigger the export. Returns '' on success, else the reason. */
ipcMain.handle('templates:openPdf', async (_e, kind: TemplateKind, label: string) => {
  const htmlPath = templateVersionPath(root(), kind, label);
  if (!htmlPath) throw new Error('Noch keine Datei hochgeladen.');
  const pdfPath = templatePdfPath(htmlPath);
  const render = (pdfRenders.get(pdfPath) ?? Promise.resolve())
    .catch(() => {}) /* the earlier click already reported its own failure */
    .then(async () => {
      if (!existsSync(pdfPath) || statSync(pdfPath).mtimeMs < statSync(htmlPath).mtimeMs) {
        await renderPdf(htmlPath, pdfPath);
      }
    });
  pdfRenders.set(pdfPath, render);
  try {
    await render;
  } catch (err) {
    rmSync(pdfPath, { force: true });
    throw new Error('Das PDF ließ sich nicht erzeugen: ' + String(err));
  } finally {
    if (pdfRenders.get(pdfPath) === render) pdfRenders.delete(pdfPath);
  }
  const openError = await shell.openPath(pdfPath);
  if (openError) throw new Error(openError);
  /* The Fassung as it now stands — the menu shows the PDF's size from here on.
     It may be gone by now (deleted outside the app mid-render). */
  const version = listTemplateVersions(root(), kind).find((v) => v.label === label);
  if (!version) throw new Error(`Fassung „${label}“ ist nicht vorhanden.`);
  return version;
});

/* Profile documents: any further files kept with the profile. The picker is
   the unfiltered multi-select one; the bytes are copied in straight away, so
   the folder listing is all the state there is. */
ipcMain.handle('profileDocuments:list', () => listProfileDocuments(root()));

ipcMain.handle('profileDocuments:add', async (_e, title: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return addProfileDocuments(root(), res.filePaths);
});

ipcMain.handle('profileDocuments:open', (_e, name: string) =>
  shell.openPath(profileDocumentPath(root(), name)),
);

ipcMain.handle('profileDocuments:remove', (_e, name: string) => removeProfileDocument(root(), name));

/* The database must be usable before any window exists; a broken store means
   quit with an error rather than silently running in-memory and losing edits. */
function initDb(): boolean {
  try {
    const db = openDb(path.join(root(), 'bewerbungen.db'));
    seedIfEmpty(db);
    const repo = createRepo(db);
    const agent = registerAgentIpc(() => win, db, repo, root());
    registerDbIpc(repo, {
      afterDeleteApplication: (id) => {
        agent.abandon(id);
        purgeApplicationFiles(root(), id);
      },
      afterDeleteComment: (paths) => paths.forEach((p) => removeStoredFile(root(), p)),
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
