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
import type {
  ProfileDocumentInfo,
  TemplateInfo,
  TemplateSlots,
  TemplateVersion,
} from '../src/shared/domain.ts';
import { DOCUMENT_STEMS } from '../src/shared/applicant.ts';
import { DocumentKind, DocumentLanguage, TemplateKind } from '../src/shared/enums.ts';

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
   their downloads, which is why it says whose it is, and why it speaks the
   application's language. The two renditions of a document share this stem
   and differ only in extension. */
const TEMPLATE_OF_DOCUMENT: Record<Exclude<DocumentKind, 'OTHER'>, TemplateKind> = {
  [DocumentKind.LEBENSLAUF]: TemplateKind.LEBENSLAUF,
  [DocumentKind.COVER_LETTER]: TemplateKind.ANSCHREIBEN,
};

function baseName(kind: DocumentKind, language: DocumentLanguage): string {
  /* The kind reaches here from the renderer. An unknown one would otherwise
     name the file "undefined.html" and hand that path back to be stored on the
     row — junk written quietly rather than a channel refusing a bad argument.
     hasOwn rather than a truthiness check: 'constructor' and 'toString' are on
     every object, and both would sail through as a name. */
  if (!Object.hasOwn(DocumentKind, kind) || DocumentKind[kind as keyof typeof DocumentKind] !== kind) {
    throw new Error(`unknown document kind: ${kind}`);
  }
  if (kind === DocumentKind.OTHER) return 'other';
  return DOCUMENT_STEMS[checkLanguage(language)][TEMPLATE_OF_DOCUMENT[kind]];
}

export function documentFileName(
  kind: DocumentKind,
  language: DocumentLanguage,
  ext: 'html' | 'pdf',
): string {
  return baseName(kind, language) + '.' + ext;
}

/* A language is a path segment that arrives from the renderer: only the two
   sides a slot has are joined into a path. */
function checkLanguage(language: DocumentLanguage): DocumentLanguage {
  if (!Object.hasOwn(LANGUAGE_DIRS, language)) throw new Error(`unknown document language: ${language}`);
  return language;
}
const LANGUAGE_DIRS: Record<DocumentLanguage, true> = {
  [DocumentLanguage.DE]: true,
  [DocumentLanguage.EN]: true,
};

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
  language: DocumentLanguage,
): { htmlAbs: string; htmlRel: string; pdfAbs: string; pdfRel: string } {
  const dir = applicationDir(userDataPath, applicationId);
  const htmlName = documentFileName(kind, language, 'html');
  const pdfName = documentFileName(kind, language, 'pdf');
  return {
    htmlAbs: path.join(dir, htmlName),
    htmlRel: path.join('documents', applicationId, htmlName),
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
  language: DocumentLanguage,
  sourcePath: string,
): string {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const { htmlAbs, htmlRel } = documentPaths(userDataPath, applicationId, kind, language);
  mkdirSync(path.dirname(htmlAbs), { recursive: true });
  copyFileSync(sourcePath, htmlAbs);
  return htmlRel;
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
   sync and no row that can outlive its file. Each slot is a directory with one
   side per language (de, en); each side is a directory of Fassungen; each
   Fassung is a subdirectory named by its label, holding the one uploaded file
   renamed to the applicant's document name in that language — the same name
   every generated copy carries — so what the card shows is what a recruiter
   would see. A `.selected` marker in each side names the Fassung Kepler uses
   for applications in that language; the sides do not know of each other. */

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

/* The label a side's first Fassung gets, and the stem further ones are
   numbered from. */
const FIRST_TEMPLATE_LABEL = 'Standard';
const AUTO_LABEL_PREFIX = 'Fassung ';
const SELECTED_MARKER = '.selected';
/* Where the pre-language Fassungen are staged while they move into the German
   side. A dotfile, so labelsIn never reads it as a Fassung. */
const STAGING_DIR = '.migrating';
const MAX_LABEL_LENGTH = 40;

/* Absolute path of a slot's directory. The kind comes from the renderer, so an
   unknown one is rejected here rather than joined into the path as `undefined`. */
function templateDir(userDataPath: string, kind: TemplateKind): string {
  const dir = TEMPLATE_DIRS[kind];
  if (!dir) throw new Error(`unknown template kind: ${kind}`);
  return path.join(userDataPath, 'templates', dir);
}

/* One language side of a slot — where its Fassungen and its marker sit. */
function sideDir(userDataPath: string, kind: TemplateKind, language: DocumentLanguage): string {
  return path.join(templateDir(userDataPath, kind), checkLanguage(language));
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

function versionDir(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
): string {
  return path.join(sideDir(userDataPath, kind, language), checkLabel(label));
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

function markerPath(userDataPath: string, kind: TemplateKind, language: DocumentLanguage): string {
  return path.join(sideDir(userDataPath, kind, language), SELECTED_MARKER);
}

/* Moves an install from before the language sides into the German side. Three
   older layouts are still read, oldest first: the flat templates/<kind>.html,
   one file directly in the slot, and Fassungen directly in the slot with the
   marker beside them — everything uploaded before there was an English side
   was German. Runs on every read; a no-op once nothing is left to move. */
function migrateSlot(userDataPath: string, kind: TemplateKind): void {
  const dir = templateDir(userDataPath, kind);
  const german = sideDir(userDataPath, kind, DocumentLanguage.DE);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    /* No slot directory yet — the flat legacy file below may still be there. */
  }

  /* A Fassung is a directory holding the HTML directly; a language side holds
     only directories. That is what tells the two apart, so even a Fassung
     that happens to be called "en" is moved rather than read as a side. */
  const fassungen = entries.filter((e) => !e.startsWith('.') && versionFile(path.join(dir, e)) !== null);
  if (fassungen.length) {
    /* Staged through a dotted directory rather than moved one by one: a
       Fassung may be named "de", and renaming that straight into the German
       side would rename a directory into itself (EINVAL) and take the whole
       profile panel with it. The staging name is a dotfile, so a crash
       between the two halves leaves nothing that reads as a Fassung. */
    const staging = path.join(dir, STAGING_DIR);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const label of fassungen) renameSync(path.join(dir, label), path.join(staging, label));
    const marker = path.join(dir, SELECTED_MARKER);
    const staged = existsSync(marker) ? readFileSync(marker, 'utf8') : null;
    rmSync(marker, { force: true });
    if (existsSync(german)) {
      /* A German side already there wins — it is the migrated one. */
      for (const label of fassungen) {
        if (!existsSync(path.join(german, label)))
          renameSync(path.join(staging, label), path.join(german, label));
      }
      rmSync(staging, { recursive: true, force: true });
    } else {
      renameSync(staging, german);
      if (staged !== null) writeFileSync(markerPath(userDataPath, kind, DocumentLanguage.DE), staged);
    }
  } else {
    /* Only a marker left over, with nothing it could name. */
    rmSync(path.join(dir, SELECTED_MARKER), { force: true });
  }

  /* statSync has to sit inside a guard too: an entry deleted between the
     readdir and the stat throws ENOENT out through listTemplates and takes
     the whole profile panel with it, rather than skipping one file. */
  const isFile = (e: string) => {
    try {
      return statSync(path.join(dir, e)).isFile();
    } catch {
      return false;
    }
  };
  const flat = entries.find((e) => isHtml(e) && isFile(e));
  const legacy = path.join(userDataPath, 'templates', LEGACY_TEMPLATE_FILES[kind]);
  const from = flat ? path.join(dir, flat) : existsSync(legacy) ? legacy : null;
  if (!from) return;
  const target = path.join(german, FIRST_TEMPLATE_LABEL);
  if (existsSync(target)) {
    /* A leftover from an older layout beside a migrated slot would only be
       confusing; the migrated Fassung is the one that counts. */
    rmSync(from, { force: true });
    return;
  }
  mkdirSync(target, { recursive: true });
  renameSync(
    from,
    path.join(target, DOCUMENT_STEMS[DocumentLanguage.DE][kind] + path.extname(from).toLowerCase()),
  );
  writeFileSync(markerPath(userDataPath, kind, DocumentLanguage.DE), FIRST_TEMPLATE_LABEL);
}

/* The labels present in a side, by name. A Fassung whose file is gone does not
   count — Finder deletions leave an empty directory behind. */
function labelsIn(userDataPath: string, kind: TemplateKind, language: DocumentLanguage): string[] {
  migrateSlot(userDataPath, kind);
  const dir = sideDir(userDataPath, kind, language);
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
   or names one that no longer exists. Null for an empty side. */
function selectedLabel(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  labels = labelsIn(userDataPath, kind, language),
): string | null {
  if (!labels.length) return null;
  let wanted: string | null = null;
  try {
    wanted = readFileSync(markerPath(userDataPath, kind, language), 'utf8').trim();
  } catch {
    /* no marker yet */
  }
  if (wanted && labels.includes(wanted)) return wanted;
  writeFileSync(markerPath(userDataPath, kind, language), labels[0]);
  return labels[0];
}

function describeVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
  selected: boolean,
): TemplateVersion {
  const file = versionFile(versionDir(userDataPath, kind, language, label));
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

/* Every Fassung of one side of a slot, by label, with the one Kepler uses
   flagged. */
export function listTemplateVersions(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
): TemplateVersion[] {
  const labels = labelsIn(userDataPath, kind, language);
  const selected = selectedLabel(userDataPath, kind, language, labels);
  return labels.flatMap((label) => {
    try {
      return [describeVersion(userDataPath, kind, language, label, label === selected)];
    } catch {
      return []; // vanished between readdir and stat
    }
  });
}

/* Both slots, both sides, at once. */
export function listTemplates(userDataPath: string): TemplateSlots {
  const sides = (kind: TemplateKind) => ({
    [DocumentLanguage.DE]: listTemplateVersions(userDataPath, kind, DocumentLanguage.DE),
    [DocumentLanguage.EN]: listTemplateVersions(userDataPath, kind, DocumentLanguage.EN),
  });
  return {
    [TemplateKind.LEBENSLAUF]: sides(TemplateKind.LEBENSLAUF),
    [TemplateKind.ANSCHREIBEN]: sides(TemplateKind.ANSCHREIBEN),
  };
}

/* The file of the Fassung Kepler uses for a language, with its label; null for
   an empty side. */
export function selectedTemplatePath(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
): { label: string; path: string } | null {
  const label = selectedLabel(userDataPath, kind, language);
  if (!label) return null;
  const file = versionFile(versionDir(userDataPath, kind, language, label));
  return file ? { label, path: file } : null;
}

/* The selected Fassung of a side as it lies on disk: its markup and the label a
   generated document is stamped with. Null when the side has no upload. */
export function readSelectedTemplate(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
): { html: string; label: string } | null {
  const selected = selectedTemplatePath(userDataPath, kind, language);
  return selected ? { html: readFileSync(selected.path, 'utf8'), label: selected.label } : null;
}

/* The file of one named Fassung, or null when there is no such Fassung. */
export function templateVersionPath(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
): string | null {
  return versionFile(versionDir(userDataPath, kind, language, label));
}

/* Writes the picked file into a Fassung directory under the applicant's
   document name in that language, replacing whatever was there. Only the
   extension is kept from the picked name — a .htm stays a .htm. */
function writeVersionFile(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
  sourcePath: string,
): void {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const dir = versionDir(userDataPath, kind, language, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(
    sourcePath,
    path.join(dir, DOCUMENT_STEMS[language][kind] + path.extname(sourcePath).toLowerCase()),
  );
}

/* Adds a Fassung under the next free name: "Standard" for an empty side, else
   "Fassung 2", "Fassung 3", … skipping names in use. The first Fassung of a
   side is selected; later ones leave the selection alone. */
export function addTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  sourcePath: string,
): TemplateVersion {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const labels = labelsIn(userDataPath, kind, language);
  let label = FIRST_TEMPLATE_LABEL;
  if (labels.length) {
    for (let n = 2; labelTaken(labels, (label = AUTO_LABEL_PREFIX + n)); n++);
  }
  writeVersionFile(userDataPath, kind, language, label, sourcePath);
  if (!labels.length) writeFileSync(markerPath(userDataPath, kind, language), label);
  return describeVersion(
    userDataPath,
    kind,
    language,
    label,
    selectedLabel(userDataPath, kind, language) === label,
  );
}

function requireLabel(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
): string {
  const clean = checkLabel(label);
  if (!labelsIn(userDataPath, kind, language).includes(clean))
    throw new Error(`Fassung „${clean}“ ist nicht vorhanden.`);
  return clean;
}

/* Swaps the file of an existing Fassung. */
export function replaceTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
  sourcePath: string,
): TemplateVersion {
  const clean = requireLabel(userDataPath, kind, language, label);
  writeVersionFile(userDataPath, kind, language, clean, sourcePath);
  return describeVersion(
    userDataPath,
    kind,
    language,
    clean,
    selectedLabel(userDataPath, kind, language) === clean,
  );
}

/* Marks the Fassung Kepler uses for that language from now on. */
export function selectTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
): void {
  writeFileSync(markerPath(userDataPath, kind, language), requireLabel(userDataPath, kind, language, label));
}

/* Renames a Fassung; the selection follows it. Renaming to the same name is a
   no-op; a name that only differs in case from another Fassung is refused. */
export function renameTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  from: string,
  to: string,
): TemplateVersion {
  const oldLabel = requireLabel(userDataPath, kind, language, from);
  const newLabel = checkLabel(to);
  const labels = labelsIn(userDataPath, kind, language);
  const wasSelected = selectedLabel(userDataPath, kind, language, labels) === oldLabel;
  if (newLabel !== oldLabel) {
    if (
      labelTaken(
        labels.filter((l) => l !== oldLabel),
        newLabel,
      )
    ) {
      throw new Error(`Eine Fassung „${newLabel}“ gibt es schon.`);
    }
    renameSync(
      versionDir(userDataPath, kind, language, oldLabel),
      versionDir(userDataPath, kind, language, newLabel),
    );
    if (wasSelected) writeFileSync(markerPath(userDataPath, kind, language), newLabel);
  }
  return describeVersion(userDataPath, kind, language, newLabel, wasSelected);
}

/* Deletes a Fassung. The selected one stays — a side with files always has a
   Fassung Kepler can use. Tolerates one that is already gone. */
export function removeTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
  label: string,
): void {
  const clean = checkLabel(label);
  if (selectedLabel(userDataPath, kind, language) === clean) {
    throw new Error('Diese Fassung wird gerade verwendet und kann nicht gelöscht werden.');
  }
  rmSync(versionDir(userDataPath, kind, language, clean), { recursive: true, force: true });
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
