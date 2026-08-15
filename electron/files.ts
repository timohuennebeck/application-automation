/* Document files on disk. The database stores the path; the bytes live under
   userData, so a card keeps its documents when the app is reinstalled and the
   Agent SDK can read them straight from the filesystem.

   Everything here takes the userData root as its first argument rather than
   reaching for Electron's app.getPath, which keeps it testable and keeps the
   Electron import out of the pure parts. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { toISO } from '../src/lib/date.ts';
import type { ProfileDocumentInfo, TemplateInfo, TemplateVersion } from '../src/shared/domain.ts';
import { DOCUMENT_STEMS } from '../src/shared/applicant.ts';
import { DocumentKind, TemplateKind } from '../src/shared/enums.ts';

/* The one format the whole pipeline starts from: the agent edits the markup and
   exports the PDF from it, so what gets uploaded is always the source, never
   the finished page. */
export function isHtml(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

/* Stored under the applicant's name and the kind, not under whatever the file
   was called when it was picked — there is one document of each kind per
   application, so the picked name carries no information and a stray name
   could escape the folder. The recruiter sees this name when the PDF lands in
   their downloads, which is why it says whose it is. The two renditions of a
   document share this stem and differ only in extension. */
const BASE_NAMES: Record<DocumentKind, string> = {
  [DocumentKind.LEBENSLAUF]: DOCUMENT_STEMS.LEBENSLAUF,
  [DocumentKind.COVER_LETTER]: DOCUMENT_STEMS.ANSCHREIBEN,
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

interface AttachmentCopy {
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
  const name = copyUnderFreeName(dir, sourcePath);
  return {
    filePath: path.join('documents', applicationId, 'attachments', name),
    name: path.basename(sourcePath),
    size: statSync(path.join(dir, name)).size,
  };
}

/* Copies a picked file into dir under its sanitized name, stepping to x-2.pdf,
   x-3.pdf while the name is taken. Returns the name it landed under. */
function copyUnderFreeName(dir: string, sourcePath: string): string {
  mkdirSync(dir, { recursive: true });
  const safe = sanitizeAttachmentName(sourcePath);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let name = safe;
  for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  copyFileSync(sourcePath, path.join(dir, name));
  return name;
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
   sync and no row that can outlive its file. Each slot is a directory of
   Fassungen; each Fassung is a subdirectory named by its label, holding the one
   uploaded file renamed to the applicant's document name — the same name every
   generated copy carries — so what the card shows is what a recruiter would
   see. A `.selected` marker in the slot names the Fassung Kepler uses. */

const TEMPLATE_DIRS: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'lebenslauf',
  [TemplateKind.ANSCHREIBEN]: 'anschreiben',
};

/* What an upload is renamed to, extension aside. */
const TEMPLATE_STEMS: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: DOCUMENT_STEMS.LEBENSLAUF,
  [TemplateKind.ANSCHREIBEN]: DOCUMENT_STEMS.ANSCHREIBEN,
};

/* Where uploads landed before original names were kept: one fixed file per
   slot. Still read so an existing install keeps its documents. */
const LEGACY_TEMPLATE_FILES: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'lebenslauf.html',
  [TemplateKind.ANSCHREIBEN]: 'anschreiben.html',
};

/* The label a slot's first Fassung gets, and the stem further ones are
   numbered from. */
const FIRST_TEMPLATE_LABEL = 'Standard';
const AUTO_LABEL_PREFIX = 'Fassung ';
const SELECTED_MARKER = '.selected';
const MAX_LABEL_LENGTH = 40;

/* Absolute path of a slot's directory. The kind comes from the renderer, so an
   unknown one is rejected here rather than joined into the path as `undefined`. */
function templateDir(userDataPath: string, kind: TemplateKind): string {
  const dir = TEMPLATE_DIRS[kind];
  if (!dir) throw new Error(`unknown template kind: ${kind}`);
  return path.join(userDataPath, 'templates', dir);
}

/* A label is a directory name that arrives from the renderer: one plain path
   segment, no dotfile, short enough for a card title. Returns it trimmed. */
function checkLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > MAX_LABEL_LENGTH || trimmed.startsWith('.') || /[/\\]/.test(trimmed)) {
    throw new Error('Ungültiger Name für eine Fassung.');
  }
  return trimmed;
}

function versionDir(userDataPath: string, kind: TemplateKind, label: string): string {
  return path.join(templateDir(userDataPath, kind), checkLabel(label));
}

/* The HTML file inside a Fassung directory, or null. */
function versionFile(dir: string): string | null {
  try {
    if (!statSync(dir).isDirectory()) return null;
    const entry = readdirSync(dir).find(isHtml);
    return entry ? path.join(dir, entry) : null;
  } catch {
    return null;
  }
}

function markerPath(userDataPath: string, kind: TemplateKind): string {
  return path.join(templateDir(userDataPath, kind), SELECTED_MARKER);
}

/* Moves an install from before Fassungen — one file directly in the slot, or
   the even older flat templates/<kind>.html — into a "Standard" Fassung. Runs
   on every read; a no-op once nothing is left to move. */
function migrateSlot(userDataPath: string, kind: TemplateKind): void {
  const dir = templateDir(userDataPath, kind);
  const target = path.join(dir, FIRST_TEMPLATE_LABEL);
  let flat: string | undefined;
  try {
    /* statSync has to sit inside the guard too: an entry deleted between the
       readdir and the stat throws ENOENT out through listTemplates and takes
       the whole profile panel with it, rather than skipping one file. */
    flat = readdirSync(dir).find((e) => isHtml(e) && statSync(path.join(dir, e)).isFile());
  } catch {
    /* no slot directory yet, or an entry vanished mid-scan */
  }
  const legacy = path.join(userDataPath, 'templates', LEGACY_TEMPLATE_FILES[kind]);
  const from = flat ? path.join(dir, flat) : existsSync(legacy) ? legacy : null;
  if (!from) return;
  if (existsSync(target)) {
    /* A leftover from an older layout beside a migrated slot would only be
       confusing; the migrated Fassung is the one that counts. */
    rmSync(from, { force: true });
    return;
  }
  mkdirSync(target, { recursive: true });
  renameSync(from, path.join(target, TEMPLATE_STEMS[kind] + path.extname(from).toLowerCase()));
  writeFileSync(markerPath(userDataPath, kind), FIRST_TEMPLATE_LABEL);
}

/* The labels present in a slot, by name. A Fassung whose file is gone does not
   count — Finder deletions leave an empty directory behind. */
function labelsIn(userDataPath: string, kind: TemplateKind): string[] {
  migrateSlot(userDataPath, kind);
  const dir = templateDir(userDataPath, kind);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.startsWith('.') && versionFile(path.join(dir, e)) !== null)
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/* Which Fassung the marker names, healed to the first label when it is missing
   or names one that no longer exists. Null for an empty slot. */
function selectedLabel(
  userDataPath: string,
  kind: TemplateKind,
  labels = labelsIn(userDataPath, kind),
): string | null {
  if (!labels.length) return null;
  let wanted: string | null = null;
  try {
    wanted = readFileSync(markerPath(userDataPath, kind), 'utf8').trim();
  } catch {
    /* no marker yet */
  }
  if (wanted && labels.includes(wanted)) return wanted;
  writeFileSync(markerPath(userDataPath, kind), labels[0]);
  return labels[0];
}

function describeVersion(
  userDataPath: string,
  kind: TemplateKind,
  label: string,
  selected: boolean,
): TemplateVersion {
  const file = versionFile(versionDir(userDataPath, kind, label));
  if (!file) throw new Error(`Fassung „${label}“ ist nicht vorhanden.`);
  let pdfSize: number | null = null;
  try {
    pdfSize = statSync(templatePdfPath(file)).size;
  } catch {
    /* not rendered yet */
  }
  return { ...describe(file), label, selected, pdfSize };
}

/* Where a Fassung's PDF rendition sits: beside the HTML, same stem. */
export function templatePdfPath(htmlPath: string): string {
  return htmlPath.replace(/\.[^.]+$/, '.pdf');
}

/* Two labels collide when they differ only in case — the Mac's filesystem
   would fold them into one directory. */
function labelTaken(labels: string[], label: string): boolean {
  const lower = label.toLowerCase();
  return labels.some((l) => l.toLowerCase() === lower);
}

/* Every Fassung of a slot, by label, with the one Kepler uses flagged. */
export function listTemplateVersions(userDataPath: string, kind: TemplateKind): TemplateVersion[] {
  const labels = labelsIn(userDataPath, kind);
  const selected = selectedLabel(userDataPath, kind, labels);
  return labels.flatMap((label) => {
    try {
      return [describeVersion(userDataPath, kind, label, label === selected)];
    } catch {
      return []; // vanished between readdir and stat
    }
  });
}

/* Both slots at once. */
export function listTemplates(userDataPath: string): Record<TemplateKind, TemplateVersion[]> {
  return {
    [TemplateKind.LEBENSLAUF]: listTemplateVersions(userDataPath, TemplateKind.LEBENSLAUF),
    [TemplateKind.ANSCHREIBEN]: listTemplateVersions(userDataPath, TemplateKind.ANSCHREIBEN),
  };
}

/* The file of the Fassung Kepler uses, with its label; null for an empty slot. */
export function selectedTemplatePath(
  userDataPath: string,
  kind: TemplateKind,
): { label: string; path: string } | null {
  const label = selectedLabel(userDataPath, kind);
  if (!label) return null;
  const file = versionFile(versionDir(userDataPath, kind, label));
  return file ? { label, path: file } : null;
}

/* The file of one named Fassung, or null when there is no such Fassung. */
export function templateVersionPath(userDataPath: string, kind: TemplateKind, label: string): string | null {
  return versionFile(versionDir(userDataPath, kind, label));
}

/* Writes the picked file into a Fassung directory under the applicant's
   document name, replacing whatever was there. Only the extension is kept from
   the picked name — a .htm stays a .htm. */
function writeVersionFile(userDataPath: string, kind: TemplateKind, label: string, sourcePath: string): void {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const dir = versionDir(userDataPath, kind, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(sourcePath, path.join(dir, TEMPLATE_STEMS[kind] + path.extname(sourcePath).toLowerCase()));
}

/* Adds a Fassung under the next free name: "Standard" for an empty slot, else
   "Fassung 2", "Fassung 3", … skipping names in use. The first Fassung of a
   slot is selected; later ones leave the selection alone. */
export function addTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  sourcePath: string,
): TemplateVersion {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const labels = labelsIn(userDataPath, kind);
  let label = FIRST_TEMPLATE_LABEL;
  if (labels.length) {
    for (let n = 2; labelTaken(labels, (label = AUTO_LABEL_PREFIX + n)); n++);
  }
  writeVersionFile(userDataPath, kind, label, sourcePath);
  if (!labels.length) writeFileSync(markerPath(userDataPath, kind), label);
  return describeVersion(userDataPath, kind, label, selectedLabel(userDataPath, kind) === label);
}

function requireLabel(userDataPath: string, kind: TemplateKind, label: string): string {
  const clean = checkLabel(label);
  if (!labelsIn(userDataPath, kind).includes(clean))
    throw new Error(`Fassung „${clean}“ ist nicht vorhanden.`);
  return clean;
}

/* Swaps the file of an existing Fassung. */
export function replaceTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  label: string,
  sourcePath: string,
): TemplateVersion {
  const clean = requireLabel(userDataPath, kind, label);
  writeVersionFile(userDataPath, kind, clean, sourcePath);
  return describeVersion(userDataPath, kind, clean, selectedLabel(userDataPath, kind) === clean);
}

/* Marks the Fassung Kepler uses from now on. */
export function selectTemplateVersion(userDataPath: string, kind: TemplateKind, label: string): void {
  writeFileSync(markerPath(userDataPath, kind), requireLabel(userDataPath, kind, label));
}

/* Renames a Fassung; the selection follows it. Renaming to the same name is a
   no-op; a name that only differs in case from another Fassung is refused. */
export function renameTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  from: string,
  to: string,
): TemplateVersion {
  const oldLabel = requireLabel(userDataPath, kind, from);
  const newLabel = checkLabel(to);
  const labels = labelsIn(userDataPath, kind);
  const wasSelected = selectedLabel(userDataPath, kind, labels) === oldLabel;
  if (newLabel !== oldLabel) {
    if (
      labelTaken(
        labels.filter((l) => l !== oldLabel),
        newLabel,
      )
    ) {
      throw new Error(`Eine Fassung „${newLabel}“ gibt es schon.`);
    }
    renameSync(versionDir(userDataPath, kind, oldLabel), versionDir(userDataPath, kind, newLabel));
    if (wasSelected) writeFileSync(markerPath(userDataPath, kind), newLabel);
  }
  return describeVersion(userDataPath, kind, newLabel, wasSelected);
}

/* Deletes a Fassung. The selected one stays — a slot with files always has a
   Fassung Kepler can use. Tolerates one that is already gone. */
export function removeTemplateVersion(userDataPath: string, kind: TemplateKind, label: string): void {
  const clean = checkLabel(label);
  if (selectedLabel(userDataPath, kind) === clean) {
    throw new Error('Diese Fassung wird gerade verwendet und kann nicht gelöscht werden.');
  }
  rmSync(versionDir(userDataPath, kind, clean), { recursive: true, force: true });
}

function describe(filePath: string): TemplateInfo {
  const s = statSync(filePath);
  return { name: path.basename(filePath), size: s.size, day: toISO(s.mtime) };
}

/* ── Profile documents ────────────────────────────────────────────────────
   Everything else worth keeping in one place — Immatrikulationsbescheinigung,
   Zeugnisse, Zertifikate — in userData/profile-documents. Like the templates
   there is no table: the folder listing is the state, and a file's name is
   its id. Any file type; several may be added at once, so names are sanitized
   and de-collided the way comment attachments are, never overwritten. */

function profileDocumentsDir(userDataPath: string): string {
  return path.join(userDataPath, 'profile-documents');
}

/* Absolute path of a stored document. The name arrives from the renderer, so
   anything but one plain path segment is refused rather than joined. */
export function profileDocumentPath(userDataPath: string, name: string): string {
  const dir = profileDocumentsDir(userDataPath);
  const resolved = path.join(dir, name);
  if (path.dirname(resolved) !== dir || path.basename(resolved) !== name || !name) {
    throw new Error(`unsafe profile document name: ${name}`);
  }
  return resolved;
}

/* Copies the picked files in and reports what now sits there, in pick order. */
export function addProfileDocuments(userDataPath: string, sourcePaths: string[]): ProfileDocumentInfo[] {
  const dir = profileDocumentsDir(userDataPath);
  return sourcePaths.map((sourcePath) => describe(path.join(dir, copyUnderFreeName(dir, sourcePath))));
}

/* Everything in the folder, by name. Dotfiles are Finder's, not the user's. */
export function listProfileDocuments(userDataPath: string): ProfileDocumentInfo[] {
  let names: string[];
  try {
    names = readdirSync(profileDocumentsDir(userDataPath));
  } catch {
    return []; // nothing added yet
  }
  return names
    .filter((n) => !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((n) => {
      try {
        return [describe(path.join(profileDocumentsDir(userDataPath), n))];
      } catch {
        return []; // vanished between readdir and stat
      }
    });
}

/* Removes one document. Tolerates a file that is already gone. */
export function removeProfileDocument(userDataPath: string, name: string): void {
  rmSync(profileDocumentPath(userDataPath, name), { force: true });
}
