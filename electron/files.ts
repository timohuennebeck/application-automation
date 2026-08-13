/* Document files on disk. The database stores the path; the bytes live under
   userData, so a card keeps its documents when the app is reinstalled and the
   Agent SDK can read them straight from the filesystem.

   Everything here takes the userData root as its first argument rather than
   reaching for Electron's app.getPath, which keeps it testable and keeps the
   Electron import out of the pure parts. */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DocumentKind } from '../src/shared/enums.ts';

/* The one format the agent can fill in without losing the layout: a .docx is
   zipped XML, a PDF is a finished page. */
export function isDocx(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.docx';
}

/* Stored under the kind, not under whatever the file was called when it was
   picked — there is one document of each kind per application, so the name
   carries no information and a stray name could escape the folder. */
const FILE_NAMES: Record<DocumentKind, string> = {
  [DocumentKind.LEBENSLAUF]: 'lebenslauf.docx',
  [DocumentKind.COVER_LETTER]: 'cover-letter.docx',
  [DocumentKind.OTHER]: 'other.docx',
};

export function documentFileName(kind: DocumentKind): string {
  return FILE_NAMES[kind];
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

/* Copies a picked file into place, replacing any earlier version, and returns
   the path to store in documents.file_path — relative to userData, so moving
   the directory does not invalidate every row. */
export function copyDocument(
  userDataPath: string,
  applicationId: string,
  kind: DocumentKind,
  sourcePath: string,
): string {
  if (!isDocx(sourcePath)) throw new Error(`not a .docx: ${sourcePath}`);
  const dir = applicationDir(userDataPath, applicationId);
  mkdirSync(dir, { recursive: true });
  const name = documentFileName(kind);
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
