/* Document files on disk. The database stores the path; the bytes live under
   userData, so a card keeps its documents when the app is reinstalled and the
   Agent SDK can read them straight from the filesystem.

   Everything here takes the userData root as its first argument rather than
   reaching for Electron's app.getPath, which keeps it testable and keeps the
   Electron import out of the pure parts. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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

/* ── Comment attachments ──────────────────────────────────────────────────
   Arbitrary files attached to a comment, kept under
   documents/<applicationId>/attachments/ so purging an application takes them
   with it. Unlike documents there are many per comment with user-chosen names,
   so the stored name is sanitized and de-collided instead of fixed per kind. */

/* Display name → one safe path segment. The name comes from whatever the user
   picked, so separators and control characters must not survive into a path. */
function sanitizeAttachmentName(name: string): string {
  const cleaned = Array.from(path.basename(name), (ch) =>
    ch < ' ' || '/\\:*?"<>|'.includes(ch) ? '-' : ch,
  ).join('');
  const base = cleaned.replace(/^\.+/, '').trim();
  if (!base) return 'anhang';
  if (base.length <= 120) return base;
  const ext = path.extname(base);
  return base.slice(0, 120 - ext.length) + ext;
}

export interface AttachmentCopy {
  /* Relative to userData, what comment_attachments.file_path stores. */
  filePath: string;
  /* The name the file was picked under, for display. */
  name: string;
  size: number;
}

/* Copies a picked file into the comment's application folder and reports what
   to hand db:comments.add. Two picks of the same name coexist as x.pdf and
   x-2.pdf — attachments are immutable, so nothing may be overwritten. */
export function copyCommentAttachment(
  userDataPath: string,
  applicationId: string,
  sourcePath: string,
): AttachmentCopy {
  const dir = path.join(applicationDir(userDataPath, applicationId), 'attachments');
  mkdirSync(dir, { recursive: true });
  const safe = sanitizeAttachmentName(sourcePath);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let name = safe;
  for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  copyFileSync(sourcePath, path.join(dir, name));
  return {
    filePath: path.join('documents', applicationId, 'attachments', name),
    name: path.basename(sourcePath),
    size: statSync(path.join(dir, name)).size,
  };
}

/* Removes one stored file, e.g. when its comment is deleted. Tolerates a file
   that is already gone; refuses anything outside the documents folder. */
export function removeStoredFile(userDataPath: string, storedPath: string): void {
  rmSync(resolveDocumentPath(userDataPath, storedPath), { force: true });
}

/* ── Profile templates ────────────────────────────────────────────────────
   The CV and cover letter kept once for the whole profile, in userData/templates.
   There is no table behind them: the file being there *is* the state — its
   name, size and date come from the filesystem. That leaves nothing to keep in
   sync and no row that can outlive its file. Each slot is a directory holding
   the one uploaded file under its own name, so what the user picked is what
   every chip and caption shows. */

const TEMPLATE_DIRS: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'lebenslauf',
  [TemplateKind.ANSCHREIBEN]: 'anschreiben',
};

/* Where uploads landed before original names were kept: one fixed file per
   slot. Still read so an existing install keeps its documents. */
const LEGACY_TEMPLATE_FILES: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'lebenslauf.html',
  [TemplateKind.ANSCHREIBEN]: 'anschreiben.html',
};

/* Absolute path of a slot's directory. The kind comes from the renderer, so an
   unknown one is rejected here rather than joined into the path as `undefined`. */
function templateDir(userDataPath: string, kind: TemplateKind): string {
  const dir = TEMPLATE_DIRS[kind];
  if (!dir) throw new Error(`unknown template kind: ${kind}`);
  return path.join(userDataPath, 'templates', dir);
}

/* The file sitting in a slot, or null while nothing has been uploaded. */
export function templatePath(userDataPath: string, kind: TemplateKind): string | null {
  const dir = templateDir(userDataPath, kind);
  try {
    const entry = readdirSync(dir).find(isHtml);
    if (entry) return path.join(dir, entry);
  } catch {
    /* no slot directory yet — fall through to the legacy location */
  }
  const legacy = path.join(userDataPath, 'templates', LEGACY_TEMPLATE_FILES[kind]);
  return existsSync(legacy) ? legacy : null;
}

/* Puts a picked file into its slot under its own name, replacing whatever was
   there, and reports what now sits in it so the dialog can redraw without a
   second round trip. */
export function copyTemplate(userDataPath: string, kind: TemplateKind, sourcePath: string): TemplateInfo {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const dir = templateDir(userDataPath, kind);
  /* One file per slot: clear the directory and the legacy flat file, or the
     replaced upload would shadow the new one. */
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(userDataPath, 'templates', LEGACY_TEMPLATE_FILES[kind]), { force: true });
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(sourcePath));
  copyFileSync(sourcePath, target);
  return describe(target);
}

function describe(filePath: string): TemplateInfo {
  const s = statSync(filePath);
  return { name: path.basename(filePath), size: s.size, day: toISO(s.mtime) };
}

function templateInfo(userDataPath: string, kind: TemplateKind): TemplateInfo | null {
  const filePath = templatePath(userDataPath, kind);
  if (!filePath) return null;
  try {
    return describe(filePath);
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
