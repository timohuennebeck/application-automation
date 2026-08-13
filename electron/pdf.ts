/* Rendering a stored HTML document to PDF. This is the same path Chromium's own
   "Als PDF sichern" takes, which is how an HTML CV is normally turned into one:
   an offscreen window loads the file and prints itself.

   It lives apart from files.ts because it needs a real Electron runtime — the
   rest of the file handling stays pure and testable. */
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/* A template that never finishes loading would otherwise hold the window, and
   with it the upload, open for good. */
const LOAD_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} dauerte zu lange`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/* Renders `htmlPath` and writes the result to `pdfPath`. The document is the
   user's own file, but it is still loaded as an ordinary web page would be:
   no node integration, no preload, its own isolated context. */
export async function renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  try {
    await withTimeout(win.loadURL(pathToFileURL(htmlPath).href), LOAD_TIMEOUT_MS, 'Das Laden der Vorlage');
    const pdf = await withTimeout(
      win.webContents.printToPDF({
        printBackground: true,
        /* The template decides its own page: a CV carries its margins in CSS,
           and Chromium's default half-inch would sit on top of them. A file
           without @page rules falls back to A4. */
        preferCSSPageSize: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }),
      LOAD_TIMEOUT_MS,
      'Der PDF-Export',
    );
    await writeFile(pdfPath, pdf);
  } finally {
    win.destroy();
  }
}
