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
   no node integration, no preload, its own isolated context.

   And no script. None of the other three flags stops a page from running its
   own JavaScript, and this window loads a file:// document with the network
   still reachable — a generated document carries model-written text at every
   slot, so an <img onerror> that had talked its way in would run here, with
   the finished CV in the DOM to send somewhere. Nothing a document needs in
   order to be printed requires script. */
export async function renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false },
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

/* One render per PDF at a time: two hidden Chromium prints must not race onto
   the same file — the loser's cleanup would delete what the winner just wrote.
   Later work queues behind the render already running.

   It lives here rather than in main.ts because every writer has to share one
   queue for it to mean anything, and Kepler is a writer too: an agent run, an
   answer that carries edits, and the editor's debounced save all print the
   same <document>.pdf. A queue only one of them goes through is not a queue. */
const pdfRenders = new Map<string, Promise<void>>();

export function queuePdfRender(pdfPath: string, work: () => Promise<void>): Promise<void> {
  const render = (pdfRenders.get(pdfPath) ?? Promise.resolve())
    .catch(() => {}) /* the earlier caller already reported its own failure */
    .then(work);
  pdfRenders.set(pdfPath, render);
  return render.finally(() => {
    if (pdfRenders.get(pdfPath) === render) pdfRenders.delete(pdfPath);
  });
}

/* renderPdf's signature, queued — what every caller that has nothing to do
   inside the slot but print should use. */
export function renderPdfQueued(htmlPath: string, pdfPath: string): Promise<void> {
  return queuePdfRender(pdfPath, () => renderPdf(htmlPath, pdfPath));
}
