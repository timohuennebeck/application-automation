/* Document files on disk. The database stores the path; the bytes live under
   userData, so a card keeps its documents when the app is reinstalled and the
   Agent SDK can read them straight from the filesystem.

   Everything here takes the userData root as its first argument rather than
   reaching for Electron's app.getPath, which keeps it testable and keeps the
   Electron import out of the pure parts. */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { toISO } from '../src/lib/date.ts';
import type { TemplateInfo } from '../src/shared/domain.ts';
import { DocumentKind, TemplateKind } from '../src/shared/enums.ts';

/* The one format the whole pipeline starts from: the agent edits the markup and
   exports the PDF from it, so what gets uploaded is always the source, never
   the finished page. */
export function isHtml(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

/* Stored under the kind, not under whatever the file was called when it was
   picked — there is one document of each kind per application, so the name
   carries no information and a stray name could escape the folder. The two
   renditions of a document share this stem and differ only in extension. */
const BASE_NAMES: Record<DocumentKind, string> = {
  [DocumentKind.LEBENSLAUF]: 'lebenslauf',
  [DocumentKind.COVER_LETTER]: 'cover-letter',
  [DocumentKind.OTHER]: 'other',
};

export function documentFileName(kind: DocumentKind, ext: 'html' | 'pdf'): string {
  return BASE_NAMES[kind] + '.' + ext;
}

/* Rejects an id that is not one plain path segment. The ids are generated
   ("BEW-33"), but they reach here from the renderer, and a '..' would let a
   delete walk out of the documents folder. */
function applicationDir(userDataPath: string, applicationId: string): string {
  const documents = path.join(userDataPath, 'documents');
  const dir = path.join(documents, applicationId);
  if (path.dirname(dir) !== documents) throw new Error(`unsafe application id: ${applicationId}`);
  return dir;
}

/* Turns a stored file_path back into an absolute one, refusing anything that
   does not land inside the documents folder. The paths this resolves were
   written by copyDocument, but they arrive here from the renderer — a '..' or
   an absolute path would otherwise hand any file on the machine to the OS. */
export function resolveDocumentPath(userDataPath: string, storedPath: string): string {
  const base = path.join(userDataPath, 'documents');
  const resolved = path.resolve(userDataPath, storedPath);
  if (!resolved.startsWith(base + path.sep)) throw new Error(`unsafe document path: ${storedPath}`);
  return resolved;
}

/* Where both renditions of a document live. The PDF is written beside the HTML
   it was rendered from, so purging an application takes the pair with it. */
export function documentPaths(
  userDataPath: string,
  applicationId: string,
  kind: DocumentKind,
): { htmlAbs: string; pdfAbs: string; pdfRel: string } {
  const dir = applicationDir(userDataPath, applicationId);
  const pdfName = documentFileName(kind, 'pdf');
  return {
    htmlAbs: path.join(dir, documentFileName(kind, 'html')),
    pdfAbs: path.join(dir, pdfName),
    pdfRel: path.join('documents', applicationId, pdfName),
  };
}

/* Copies a picked file into place, replacing any earlier version, and returns
   the path to store in documents.file_path — relative to userData, so moving
   the directory does not invalidate every row. What gets stored is the HTML
   source; the PDF beside it is rendered from this copy afterwards. */
export function copyDocument(
  userDataPath: string,
  applicationId: string,
  kind: DocumentKind,
  sourcePath: string,
): string {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const dir = applicationDir(userDataPath, applicationId);
  mkdirSync(dir, { recursive: true });
  const name = documentFileName(kind, 'html');
  copyFileSync(sourcePath, path.join(dir, name));
  return path.join('documents', applicationId, name);
}

/* Drops everything belonging to a deleted application. The database cascades
   its own rows; nothing else would ever clear these files. */
export function purgeApplicationFiles(userDataPath: string, applicationId: string): void {
  rmSync(applicationDir(userDataPath, applicationId), { recursive: true, force: true });
}

/* Size of a stored document, or null when the row points at a file that is not
   there any more — deleted from Finder, or synced away. The menu then simply
   omits the size instead of claiming one. */
export function documentSize(userDataPath: string, storedPath: string): number | null {
  try {
    return statSync(resolveDocumentPath(userDataPath, storedPath)).size;
  } catch {
    return null;
  }
}

/* ── Profile templates ────────────────────────────────────────────────────
   The CV and cover letter kept once for the whole profile, in userData/templates.
   There is no table behind them: the file being there *is* the state, and its
   size and date come from the filesystem. That leaves nothing to keep in sync
   and no row that can outlive its file. */

const TEMPLATE_FILE_NAMES: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'lebenslauf.html',
  [TemplateKind.ANSCHREIBEN]: 'anschreiben.html',
};

/* Absolute path of a slot. The kind comes from the renderer, so an unknown one
   is rejected here rather than joined into the path as `undefined`. */
export function templatePath(userDataPath: string, kind: TemplateKind): string {
  const name = TEMPLATE_FILE_NAMES[kind];
  if (!name) throw new Error(`unknown template kind: ${kind}`);
  return path.join(userDataPath, 'templates', name);
}

/* Puts a picked file into its slot, replacing whatever was there, and reports
   what now sits in it so the dialog can redraw without a second round trip. */
export function copyTemplate(userDataPath: string, kind: TemplateKind, sourcePath: string): TemplateInfo {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const target = templatePath(userDataPath, kind);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(sourcePath, target);
  return describe(statSync(target));
}

function describe(s: { size: number; mtime: Date }): TemplateInfo {
  return { size: s.size, day: toISO(s.mtime) };
}

function templateInfo(userDataPath: string, kind: TemplateKind): TemplateInfo | null {
  try {
    return describe(statSync(templatePath(userDataPath, kind)));
  } catch {
    return null;
  }
}

/* Both slots at once — null where nothing has been uploaded, or where the file
   has since disappeared from disk. */
export function listTemplates(userDataPath: string): Record<TemplateKind, TemplateInfo | null> {
  return {
    [TemplateKind.LEBENSLAUF]: templateInfo(userDataPath, TemplateKind.LEBENSLAUF),
    [TemplateKind.ANSCHREIBEN]: templateInfo(userDataPath, TemplateKind.ANSCHREIBEN),
  };
}
