import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { queuePdfRender, renderPdf } from './pdf.ts';
import type { DocumentUpload } from '../src/shared/domain.ts';
import type { DocumentKind, DocumentLanguage, TemplateKind } from '../src/shared/enums.ts';

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
  /* An unexpected value would throw inside an ipcMain.on handler, which is an
     uncaught main-process exception rather than a rejected promise. */
  if (theme !== 'light' && theme !== 'dark') return;
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

/* Renders the PDF beside a document's HTML and reports rather than throws: the
   HTML is already stored, and losing it because Chromium could not print would
   be the wrong trade. Both write routes come through here, so neither can
   render a document without the other waiting its turn — the letter editor
   saves after every accepted replacement, so a second save landing mid-render
   is ordinary use rather than a double-click. */
async function exportDocumentPdf(
  applicationId: string,
  kind: DocumentKind,
  language: DocumentLanguage,
  filePath: string,
): Promise<DocumentUpload> {
  const { htmlAbs, pdfAbs, pdfRel } = documentPaths(root(), applicationId, kind, language);
  try {
    await queuePdfRender(pdfAbs, async () => {
      try {
        await renderPdf(htmlAbs, pdfAbs);
      } catch (err) {
        /* Whatever was exported before is no longer what the HTML says. The
           cleanup runs inside the queued slot so it can never reach the file
           the next save is already writing. */
        rmSync(pdfAbs, { force: true });
        throw err;
      }
    });
    return { filePath, pdfPath: pdfRel, pdfError: null };
  } catch (err) {
    return { filePath, pdfPath: null, pdfError: String(err) };
  }
}

/* Takes in the HTML and renders the PDF beside it in one step, so a row never
   claims a source without the export that belongs to it. */
ipcMain.handle(
  'documents:copy',
  async (
    _e,
    applicationId: string,
    kind: DocumentKind,
    language: DocumentLanguage,
    sourcePath: string,
  ): Promise<DocumentUpload> => {
    requirePicked(sourcePath);
    const filePath = copyDocument(root(), applicationId, kind, language, sourcePath);
    return exportDocumentPdf(applicationId, kind, language, filePath);
  },
);

/* Sizes for the document menu, in one round trip. */
ipcMain.handle('documents:sizes', (_e, filePaths: string[]) => filePaths.map((p) => documentSize(root(), p)));

/* Opens the stored file in whatever the OS uses for .docx. Returns the error
   string openPath gives on failure ('' means it opened). */
ipcMain.handle('documents:open', (_e, filePath: string) =>
  shell.openPath(resolveDocumentPath(root(), filePath)),
);

/* The stored HTML itself, for the in-app letter editor. resolveDocumentPath is
   what keeps this from being a read-any-file channel — the renderer hands over
   a stored file_path, and anything that does not land inside the documents
   folder is refused there. */
ipcMain.handle('documents:read', (_e, filePath: string) =>
  readFileSync(resolveDocumentPath(root(), filePath), 'utf8'),
);

/* Writes an edited document back over its own file and re-renders the PDF, the
   same trade as documents:copy: a failed export keeps the HTML and reports the
   reason rather than losing the edit. The database row is updated by the
   renderer through db.documents.setFile, so both write routes stay one route. */
ipcMain.handle(
  'documents:save',
  async (
    _e,
    applicationId: string,
    kind: DocumentKind,
    language: DocumentLanguage,
    html: string,
  ): Promise<DocumentUpload> => {
    const { htmlAbs, htmlRel } = documentPaths(root(), applicationId, kind, language);
    /* No mkdir: a document being edited is one that was written before, so its
       folder exists. Recreating it would resurrect a folder that was purged
       with its application, which the orchestrator refuses for the same
       reason — better to let ENOENT surface. */
    writeFileSync(htmlAbs, html);
    return exportDocumentPdf(applicationId, kind, language, htmlRel);
  },
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

function requirePickedAttachment(sourcePath: string): void {
  if (!pickedAttachmentSources.has(sourcePath)) throw new Error('Unbekannte Datei.');
}

/* Copies the staged sources into userData at send time; the comment's rows are
   only written from what this returns, so a row never points at missing bytes. */
ipcMain.handle('attachments:copy', (_e, applicationId: string, sourcePaths: string[]) => {
  /* Same gate the other three ingest channels use: without it any path the
     renderer names gets copied in and listed as an attachment. */
  sourcePaths.forEach(requirePickedAttachment);
  return sourcePaths.map((p) => copyCommentAttachment(root(), applicationId, p));
});

/* Profile templates: the Fassungen of the two documents that are not tied to
   an application. They share the picker above, so the extension is checked
   once more in the file layer before anything is written. */
ipcMain.handle('templates:list', () => listTemplates(root()));

ipcMain.handle('templates:add', (_e, kind: TemplateKind, language: DocumentLanguage, sourcePath: string) => {
  requirePicked(sourcePath);
  return addTemplateVersion(root(), kind, language, sourcePath);
});

ipcMain.handle(
  'templates:replace',
  (_e, kind: TemplateKind, language: DocumentLanguage, label: string, sourcePath: string) => {
    requirePicked(sourcePath);
    return replaceTemplateVersion(root(), kind, language, label, sourcePath);
  },
);

ipcMain.handle('templates:select', (_e, kind: TemplateKind, language: DocumentLanguage, label: string) =>
  selectTemplateVersion(root(), kind, language, label),
);

ipcMain.handle(
  'templates:rename',
  (_e, kind: TemplateKind, language: DocumentLanguage, from: string, to: string) =>
    renameTemplateVersion(root(), kind, language, from, to),
);

ipcMain.handle('templates:remove', (_e, kind: TemplateKind, language: DocumentLanguage, label: string) =>
  removeTemplateVersion(root(), kind, language, label),
);

/* Without a label the selected Fassung of that language opens — what the
   agent panel's doc chips point at. */
ipcMain.handle('templates:open', (_e, kind: TemplateKind, language: DocumentLanguage, label?: string) => {
  const filePath = label
    ? templateVersionPath(root(), kind, language, label)
    : (selectedTemplatePath(root(), kind, language)?.path ?? null);
  return filePath ? shell.openPath(filePath) : 'Noch keine Datei hochgeladen.';
});

/* The PDF of one Fassung, rendered beside its HTML on first request and again
   whenever the HTML is newer than the last render — the profile has nothing
   else that would trigger the export. Returns '' on success, else the reason. */
ipcMain.handle(
  'templates:openPdf',
  async (_e, kind: TemplateKind, language: DocumentLanguage, label: string) => {
    const htmlPath = templateVersionPath(root(), kind, language, label);
    if (!htmlPath) throw new Error('Noch keine Datei hochgeladen.');
    const pdfPath = templatePdfPath(htmlPath);
    try {
      await queuePdfRender(pdfPath, async () => {
        if (!existsSync(pdfPath) || statSync(pdfPath).mtimeMs < statSync(htmlPath).mtimeMs) {
          await renderPdf(htmlPath, pdfPath);
        }
      });
    } catch (err) {
      rmSync(pdfPath, { force: true });
      throw new Error('Das PDF ließ sich nicht erzeugen: ' + String(err));
    }
    const openError = await shell.openPath(pdfPath);
    if (openError) throw new Error(openError);
    /* The Fassung as it now stands — the menu shows the PDF's size from here on.
     It may be gone by now (deleted outside the app mid-render). */
    const version = listTemplateVersions(root(), kind, language).find((v) => v.label === label);
    if (!version) throw new Error(`Fassung „${label}“ ist nicht vorhanden.`);
    return version;
  },
);

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
