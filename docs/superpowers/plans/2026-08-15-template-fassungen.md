# Template-Fassungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several named Fassungen per template slot on disk, one marked per slot that Kepler uses, the label stamped onto each generated document, and "Cover Letter" renamed to "Anschreiben" throughout the UI.

**Architecture:** The file layer in `electron/files.ts` gains a directory-per-Fassung layout with a `.selected` marker and lazy migration of the old single-file slot; the orchestrator reads the selected Fassung and passes its label to `repo.setDocumentFile`, which stores it in a new `documents.template_label` column; the profile modal renders one card per Fassung with a selection dot, and the detail view shows the label in the document caption.

**Tech Stack:** Electron main (node:fs, node:sqlite), React renderer, vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-template-fassungen-design.md`

## Global Constraints

- Wording: "Fassung", never "Variante"; no "Aktiv" word — a dot marks the selected Fassung.
- User-facing "Cover Letter" → "Anschreiben"; enum `DocumentKind.COVER_LETTER`, `TemplateKind.ANSCHREIBEN`, file stems unchanged.
- Filesystem is the source of truth for Fassungen; no DB table.
- First Fassung in an empty/migrated slot is `Standard`; further ones auto-named `Fassung 2`, `Fassung 3`, …
- Labels: trimmed, non-empty, ≤ 40 chars, no `/`, `\`, leading `.`; unique per slot case-insensitively.
- All errors shown to the user are German.
- Run tests with `npx vitest run <file>`; typecheck with `npx tsc --noEmit -p tsconfig.json` (or `npm run typecheck` if present).

---

### Task 1: File layer — Fassungen on disk

**Files:**
- Modify: `src/shared/domain.ts` (add `TemplateVersion`)
- Modify: `electron/files.ts:174-270` (replace the single-slot section)
- Test: `electron/__tests__/files.test.ts` (replace `templatePath` / `copyTemplate` / `listTemplates` describes)

**Interfaces:**
- Produces (all in `electron/files.ts`, `userDataPath: string` first):
  - `interface TemplateVersion extends TemplateInfo { label: string; selected: boolean }` (in `src/shared/domain.ts`)
  - `listTemplateVersions(userDataPath, kind: TemplateKind): TemplateVersion[]`
  - `listTemplates(userDataPath): Record<TemplateKind, TemplateVersion[]>`
  - `addTemplateVersion(userDataPath, kind, sourcePath): TemplateVersion`
  - `replaceTemplateVersion(userDataPath, kind, label, sourcePath): TemplateVersion`
  - `selectTemplateVersion(userDataPath, kind, label): void`
  - `renameTemplateVersion(userDataPath, kind, from, to): TemplateVersion`
  - `removeTemplateVersion(userDataPath, kind, label): void`
  - `selectedTemplatePath(userDataPath, kind): { label: string; path: string } | null`
  - `templateVersionPath(userDataPath, kind, label): string | null` (file of one Fassung, for `templates:open`)
- Keeps `templatePath` and `copyTemplate` **exported for now** as thin wrappers over `selectedTemplatePath` / (`addTemplateVersion` when empty else `replaceTemplateVersion` on the selected) so the orchestrator and main.ts keep compiling until Tasks 3/4 remove them.

- [ ] **Step 1: Add the type**

In `src/shared/domain.ts` right after `TemplateInfo`:

```ts
/* One Fassung of a template slot: its file plus the label it is filed under
   (the directory name) and whether it is the one Kepler uses. */
export interface TemplateVersion extends TemplateInfo {
  label: string;
  selected: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Replace the `templatePath`, `copyTemplate` and `listTemplates` describe blocks in `electron/__tests__/files.test.ts` with (update the import list accordingly — drop `copyTemplate`/`templatePath`, add the new names):

```ts
const CV = 'Timo_Huennebeck_Lebenslauf.html';
const slot = (kind: 'lebenslauf' | 'anschreiben') => path.join(root, 'templates', kind);

describe('template versions', () => {
  it('lists nothing while a slot is empty', () => {
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF)).toEqual([]);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toBe(null);
    expect(listTemplates(root)).toEqual({ LEBENSLAUF: [], ANSCHREIBEN: [] });
  });

  it('files the first upload as "Standard" and selects it', () => {
    const v = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('Mein Lebenslauf.html', 'cv'));
    expect(v).toEqual({ label: 'Standard', selected: true, name: CV, size: 2, day: toISO(new Date()) });
    expect(readFileSync(path.join(slot('lebenslauf'), 'Standard', CV), 'utf8')).toBe('cv');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toEqual({
      label: 'Standard',
      path: path.join(slot('lebenslauf'), 'Standard', CV),
    });
  });

  it('auto-names further uploads "Fassung n" and leaves the selection alone', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    const second = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    const third = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('c.html'));
    expect(second.label).toBe('Fassung 2');
    expect(second.selected).toBe(false);
    expect(third.label).toBe('Fassung 3');
    /* Removing the middle one frees its number for the next upload. */
    removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2');
    expect(addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('d.html')).label).toBe('Fassung 2');
  });

  it('keeps the picked extension', () => {
    const v = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.htm', 'cv'));
    expect(v.name).toBe('Timo_Huennebeck_Lebenslauf.htm');
  });

  it('refuses anything but HTML and leaves no slot behind', () => {
    for (const name of ['cv.pdf', 'cv.docx']) {
      expect(() => addTemplateVersion(root, TemplateKind.LEBENSLAUF, source(name)), name).toThrow(/html/i);
    }
    expect(existsSync(path.join(root, 'templates'))).toBe(false);
  });

  it('lists by label with the selected flag', () => {
    addTemplateVersion(root, TemplateKind.ANSCHREIBEN, source('a.html', 'letter'));
    addTemplateVersion(root, TemplateKind.ANSCHREIBEN, source('b.html', 'longer letter'));
    selectTemplateVersion(root, TemplateKind.ANSCHREIBEN, 'Fassung 2');
    expect(listTemplateVersions(root, TemplateKind.ANSCHREIBEN)).toEqual([
      { label: 'Fassung 2', selected: true, name: 'Timo_Huennebeck_Anschreiben.html', size: 13, day: toISO(new Date()) },
      { label: 'Standard', selected: false, name: 'Timo_Huennebeck_Anschreiben.html', size: 6, day: toISO(new Date()) },
    ]);
    expect(selectedTemplatePath(root, TemplateKind.ANSCHREIBEN)!.label).toBe('Fassung 2');
  });

  it('replaces the file of one Fassung without touching the others', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html', 'one'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html', 'two'));
    const v = replaceTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', source('c.htm', 'three'));
    expect(v.label).toBe('Fassung 2');
    expect(v.name).toBe('Timo_Huennebeck_Lebenslauf.htm');
    expect(readdirSync(path.join(slot('lebenslauf'), 'Fassung 2'))).toEqual(['Timo_Huennebeck_Lebenslauf.htm']);
    expect(readFileSync(path.join(slot('lebenslauf'), 'Standard', CV), 'utf8')).toBe('one');
  });

  it('renames a Fassung and carries the selection with it', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    const v = renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Standard', 'Kurz');
    expect(v).toMatchObject({ label: 'Kurz', selected: true });
    expect(existsSync(path.join(slot('lebenslauf'), 'Standard'))).toBe(false);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)!.label).toBe('Kurz');
  });

  it('refuses unsafe, empty, overlong and duplicate labels', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(41), 'standard', 'STANDARD']) {
      expect(() => renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', bad), bad).toThrow();
    }
    expect(existsSync(path.join(slot('lebenslauf'), 'Fassung 2'))).toBe(true);
    /* Renaming to itself is a no-op, not a duplicate. */
    expect(renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', 'Fassung 2').label).toBe('Fassung 2');
    /* Only whitespace around the label is dropped. */
    expect(renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', '  Kurz ').label).toBe('Kurz');
  });

  it('refuses to remove the selected Fassung', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    expect(() => removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Standard')).toThrow(/verwendet/i);
    removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2');
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF).map((v) => v.label)).toEqual(['Standard']);
  });

  it('heals a missing or stale selection marker to the first label', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    writeFileSync(path.join(slot('lebenslauf'), '.selected'), 'Weg');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)!.label).toBe('Fassung 2');
    expect(readFileSync(path.join(slot('lebenslauf'), '.selected'), 'utf8')).toBe('Fassung 2');
    rmSync(path.join(slot('lebenslauf'), '.selected'));
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF).find((v) => v.selected)!.label).toBe('Fassung 2');
  });

  it('skips a Fassung whose file vanished', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    rmSync(path.join(slot('lebenslauf'), 'Standard', CV));
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF)).toEqual([]);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toBe(null);
  });

  /* Slots used to hold one file directly; that file becomes "Standard". */
  it('moves a single-file slot of an older install into "Standard"', () => {
    mkdirSync(slot('anschreiben'), { recursive: true });
    writeFileSync(path.join(slot('anschreiben'), 'Mein Anschreiben.htm'), 'letter');
    expect(listTemplateVersions(root, TemplateKind.ANSCHREIBEN)).toMatchObject([
      { label: 'Standard', selected: true, name: 'Timo_Huennebeck_Anschreiben.htm' },
    ]);
    expect(readFileSync(path.join(slot('anschreiben'), 'Standard', 'Timo_Huennebeck_Anschreiben.htm'), 'utf8')).toBe('letter');
    expect(existsSync(path.join(slot('anschreiben'), 'Mein Anschreiben.htm'))).toBe(false);
  });

  it('moves the legacy flat file of an even older install into "Standard"', () => {
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    writeFileSync(path.join(root, 'templates', 'lebenslauf.html'), 'old cv');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toEqual({
      label: 'Standard',
      path: path.join(slot('lebenslauf'), 'Standard', CV),
    });
    expect(existsSync(path.join(root, 'templates', 'lebenslauf.html'))).toBe(false);
  });

  it('refuses a kind that is not one of the two slots', () => {
    expect(() => listTemplateVersions(root, 'OTHER' as TemplateKind)).toThrow(/kind/i);
    expect(() => selectedTemplatePath(root, '../../etc' as TemplateKind)).toThrow(/kind/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run electron/__tests__/files.test.ts`
Expected: FAIL — imports undefined.

- [ ] **Step 4: Implement**

Replace lines from `/* ── Profile templates` through the end of `listTemplates` in `electron/files.ts` with:

```ts
/* ── Profile templates ────────────────────────────────────────────────────
   The CV and cover letter kept once for the whole profile, in userData/templates.
   There is no table behind them: the file being there *is* the state — its
   name, size and date come from the filesystem. Each slot is a directory of
   Fassungen; each Fassung is a subdirectory named by its label, holding the one
   uploaded file renamed to the applicant's document name — the same name every
   generated copy carries. A `.selected` marker in the slot names the Fassung
   Kepler uses. */

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
export const FIRST_TEMPLATE_LABEL = 'Standard';
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
  if (
    !trimmed ||
    trimmed.length > MAX_LABEL_LENGTH ||
    trimmed.startsWith('.') ||
    /[/\\]/.test(trimmed) ||
    trimmed === '..' ||
    trimmed === '.'
  ) {
    throw new Error('Ungültiger Name für eine Fassung.');
  }
  return trimmed;
}

function versionDir(userDataPath: string, kind: TemplateKind, label: string): string {
  return path.join(templateDir(userDataPath, kind), checkLabel(label));
}

/* Moves an install from before Fassungen — one file directly in the slot, or
   the even older flat templates/<kind>.html — into a "Standard" Fassung. Runs
   on every read; a no-op once nothing is left to move. */
function migrateSlot(userDataPath: string, kind: TemplateKind): void {
  const dir = templateDir(userDataPath, kind);
  const target = path.join(dir, FIRST_TEMPLATE_LABEL);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    /* no slot directory yet */
  }
  const flat = entries.find((e) => isHtml(e) && statSync(path.join(dir, e)).isFile());
  const legacy = path.join(userDataPath, 'templates', LEGACY_TEMPLATE_FILES[kind]);
  const from = flat ? path.join(dir, flat) : existsSync(legacy) ? legacy : null;
  if (!from || existsSync(target)) {
    /* A leftover legacy file beside a migrated slot would only shadow it. */
    if (from && from === legacy) rmSync(legacy, { force: true });
    return;
  }
  mkdirSync(target, { recursive: true });
  renameSync(from, path.join(target, TEMPLATE_STEMS[kind] + path.extname(from).toLowerCase()));
  writeFileSync(path.join(dir, SELECTED_MARKER), FIRST_TEMPLATE_LABEL);
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

/* Which Fassung the marker names, healed to the first label when it is missing
   or names one that no longer exists. Null for an empty slot. */
function selectedLabel(userDataPath: string, kind: TemplateKind, labels = labelsIn(userDataPath, kind)): string | null {
  if (!labels.length) return null;
  const marker = path.join(templateDir(userDataPath, kind), SELECTED_MARKER);
  let wanted: string | null = null;
  try {
    wanted = readFileSync(marker, 'utf8').trim();
  } catch {
    /* no marker yet */
  }
  if (wanted && labels.includes(wanted)) return wanted;
  writeFileSync(marker, labels[0]);
  return labels[0];
}

function describeVersion(userDataPath: string, kind: TemplateKind, label: string, selected: boolean): TemplateVersion {
  const file = versionFile(versionDir(userDataPath, kind, label));
  if (!file) throw new Error(`Fassung „${label}“ ist nicht vorhanden.`);
  return { ...describe(file), label, selected };
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
export function selectedTemplatePath(userDataPath: string, kind: TemplateKind): { label: string; path: string } | null {
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
function writeVersionFile(userDataPath: string, kind: TemplateKind, label: string, sourcePath: string): string {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const dir = versionDir(userDataPath, kind, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, TEMPLATE_STEMS[kind] + path.extname(sourcePath).toLowerCase());
  copyFileSync(sourcePath, target);
  return target;
}

/* Two labels collide when they differ only in case — the Mac's filesystem
   would fold them into one directory. */
function labelTaken(labels: string[], label: string): boolean {
  const lower = label.toLowerCase();
  return labels.some((l) => l.toLowerCase() === lower);
}

/* Adds a Fassung under the next free name: "Standard" for an empty slot, else
   "Fassung 2", "Fassung 3", … skipping names in use. The first Fassung of a
   slot is selected; later ones leave the selection alone. */
export function addTemplateVersion(userDataPath: string, kind: TemplateKind, sourcePath: string): TemplateVersion {
  if (!isHtml(sourcePath)) throw new Error(`not an HTML file: ${sourcePath}`);
  const labels = labelsIn(userDataPath, kind);
  let label = FIRST_TEMPLATE_LABEL;
  if (labels.length) {
    for (let n = 2; labelTaken(labels, (label = AUTO_LABEL_PREFIX + n)); n++);
  }
  writeVersionFile(userDataPath, kind, label, sourcePath);
  if (!labels.length) writeFileSync(path.join(templateDir(userDataPath, kind), SELECTED_MARKER), label);
  return describeVersion(userDataPath, kind, label, selectedLabel(userDataPath, kind) === label);
}

/* Swaps the file of an existing Fassung. */
export function replaceTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  label: string,
  sourcePath: string,
): TemplateVersion {
  const clean = checkLabel(label);
  if (!labelsIn(userDataPath, kind).includes(clean)) throw new Error(`Fassung „${clean}“ ist nicht vorhanden.`);
  writeVersionFile(userDataPath, kind, clean, sourcePath);
  return describeVersion(userDataPath, kind, clean, selectedLabel(userDataPath, kind) === clean);
}

/* Marks the Fassung Kepler uses from now on. */
export function selectTemplateVersion(userDataPath: string, kind: TemplateKind, label: string): void {
  const clean = checkLabel(label);
  if (!labelsIn(userDataPath, kind).includes(clean)) throw new Error(`Fassung „${clean}“ ist nicht vorhanden.`);
  writeFileSync(path.join(templateDir(userDataPath, kind), SELECTED_MARKER), clean);
}

/* Renames a Fassung; the selection follows it. Renaming to the same name is a
   no-op, a name that only differs in case from another Fassung is refused. */
export function renameTemplateVersion(
  userDataPath: string,
  kind: TemplateKind,
  from: string,
  to: string,
): TemplateVersion {
  const oldLabel = checkLabel(from);
  const newLabel = checkLabel(to);
  const labels = labelsIn(userDataPath, kind);
  if (!labels.includes(oldLabel)) throw new Error(`Fassung „${oldLabel}“ ist nicht vorhanden.`);
  const wasSelected = selectedLabel(userDataPath, kind, labels) === oldLabel;
  if (newLabel !== oldLabel) {
    if (labelTaken(labels.filter((l) => l !== oldLabel), newLabel) || (newLabel.toLowerCase() === oldLabel.toLowerCase() && newLabel !== oldLabel && labelTaken(labels, newLabel) && false)) {
      throw new Error(`Eine Fassung „${newLabel}“ gibt es schon.`);
    }
    renameSync(versionDir(userDataPath, kind, oldLabel), versionDir(userDataPath, kind, newLabel));
    if (wasSelected) writeFileSync(path.join(templateDir(userDataPath, kind), SELECTED_MARKER), newLabel);
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

/* ── Compatibility wrappers, removed once every caller reads Fassungen ──── */
export function templatePath(userDataPath: string, kind: TemplateKind): string | null {
  return selectedTemplatePath(userDataPath, kind)?.path ?? null;
}
export function copyTemplate(userDataPath: string, kind: TemplateKind, sourcePath: string): TemplateInfo {
  const selected = selectedLabel(userDataPath, kind);
  return selected
    ? replaceTemplateVersion(userDataPath, kind, selected, sourcePath)
    : addTemplateVersion(userDataPath, kind, sourcePath);
}
```

Note on `renameTemplateVersion`'s duplicate check: simplify the condition to
`if (labelTaken(labels.filter((l) => l !== oldLabel), newLabel))` — but a
case-only rename of the *same* Fassung (`Kurz` → `kurz`) must be allowed and
`renameSync` handles it on a case-insensitive FS. Keep exactly:

```ts
    if (labelTaken(labels.filter((l) => l !== oldLabel), newLabel)) {
      throw new Error(`Eine Fassung „${newLabel}“ gibt es schon.`);
    }
```

Add `readFileSync` and `writeFileSync` to the `node:fs` import; import `TemplateVersion` from `../src/shared/domain.ts`. Keep `describe(filePath)` where it is (used by profile documents too).

- [ ] **Step 5: Run tests; fix until green**

Run: `npx vitest run electron/__tests__/files.test.ts`
Expected: PASS. Then run the whole suite: `npx vitest run` — orchestrator tests still pass through the `templatePath` wrapper (its `uploadTemplates` helper writes single-file slots, which migrate lazily).

- [ ] **Step 6: Commit**

```bash
git add src/shared/domain.ts electron/files.ts electron/__tests__/files.test.ts
git commit -m "feat(files): several Fassungen per template slot with a selected marker"
```

---

### Task 2: Database — `template_label` column and "Anschreiben" titles

**Files:**
- Modify: `electron/db/schema.ts` (append migration 20)
- Modify: `src/shared/db-types.ts:178-189` (`DocumentRow`), `:376-378` (`DbApi.documents`)
- Modify: `electron/db/repo.ts:216`, `:693-703`
- Modify: `electron/db/seed.ts:360-365`
- Modify: `electron/db/ipc.ts` (no change needed — it maps by name; verify arity is passed through)
- Modify: `src/state/store.tsx:1050`
- Test: `electron/db/__tests__/migrate.test.ts`, `electron/db/__tests__/repo.test.ts`

**Interfaces:**
- Produces: `DocumentRow.template_label: string | null`; `repo.setDocumentFile(documentId, filePath, pdfPath, templateLabel: string | null): DocumentRow`; `DbApi.documents.setFile(documentId, filePath, pdfPath, templateLabel)`.

- [ ] **Step 1: Failing migration test**

Append to the migrate describe in `electron/db/__tests__/migrate.test.ts`:

```ts
  /* Migration 20: generated documents remember the Fassung they came from, and
     the letter is called by its German name like everything else. */
  it('adds template_label and renames the letter rows to Anschreiben', () => {
    const db = dbAtVersion(19);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, 't', 't');
      INSERT INTO documents (application_id, kind, title, created_at, updated_at)
        VALUES ('BEW-1', 'COVER_LETTER', 'Cover Letter', 't', 't');
      INSERT INTO documents (application_id, kind, title, created_at, updated_at)
        VALUES ('BEW-1', 'LEBENSLAUF', 'Lebenslauf', 't', 't');
    `);
    migrate(db);
    const rows = db.prepare('SELECT kind, title, template_label FROM documents ORDER BY id').all();
    expect(rows).toEqual([
      { kind: 'COVER_LETTER', title: 'Anschreiben', template_label: null },
      { kind: 'LEBENSLAUF', title: 'Lebenslauf', template_label: null },
    ]);
  });
```

Check how `dbAtVersion` builds its schema (it runs `MIGRATIONS.slice(0, n)`); check the `applications` columns required at version 19 by reading an existing later test in the file and copy its INSERT shape if it differs.

- [ ] **Step 2: Failing repo test**

In `electron/db/__tests__/repo.test.ts`, update the three existing `setDocumentFile` calls to pass a fourth argument (`null`), and add:

```ts
  it('stores which Fassung a generated document came from, and clears it for a hand-uploaded file', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];
    const generated = repo.setDocumentFile(doc.id, 'documents/BEW-45/x.html', null, 'Kurz');
    expect(generated.template_label).toBe('Kurz');
    const uploaded = repo.setDocumentFile(doc.id, 'documents/BEW-45/x.html', null, null);
    expect(uploaded.template_label).toBeNull();
  });

  it('creates the letter placeholder as "Anschreiben"', () => {
    const docs = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null }).documents;
    expect(docs.map((d) => d.title)).toEqual(['Anschreiben', 'Lebenslauf']);
  });
```

- [ ] **Step 3: Run both test files, expect FAIL**

`npx vitest run electron/db/__tests__/migrate.test.ts electron/db/__tests__/repo.test.ts`

- [ ] **Step 4: Implement**

`electron/db/schema.ts` — append after migration 19:

```ts
  /* Migration 20: which Fassung of the profile template a generated document
     came from — NULL for older documents and for files the user uploaded by
     hand. And the letter row is called what the rest of the app calls it. */
  `
  ALTER TABLE documents ADD COLUMN template_label TEXT;
  UPDATE documents SET title = 'Anschreiben' WHERE kind = 'COVER_LETTER' AND title = 'Cover Letter';
  `,
```

`src/shared/db-types.ts` — in `DocumentRow` after `pdf_path`:

```ts
  /* The label of the profile-template Fassung this file was generated from;
     NULL for hand-uploaded files and documents from before Fassungen. */
  template_label: string | null;
```

and `DbApi.documents.setFile(documentId: number, filePath: string, pdfPath: string | null, templateLabel: string | null): Promise<DocumentRow>;`

`electron/db/repo.ts` — line 216: `'Anschreiben'` instead of `'Cover Letter'`. `setDocumentFile`:

```ts
    setDocumentFile(
      documentId: number,
      filePath: string,
      pdfPath: string | null,
      templateLabel: string | null,
    ): DocumentRow {
      return tx(() => {
        const before = one<DocumentRow>('SELECT * FROM documents WHERE id = ?', documentId);
        const t = nowISO();
        const firstFile = !before.file_path && !before.pdf_path;
        db.prepare(
          'UPDATE documents SET file_path = ?, pdf_path = ?, template_label = ?, updated_at = ?, created_at = ? WHERE id = ?',
        ).run(filePath, pdfPath, templateLabel, t, firstFile ? t : before.created_at, documentId);
        return one<DocumentRow>('SELECT * FROM documents WHERE id = ?', documentId);
      });
    },
```

Update the docstring above it: "…and which Fassung it came from — NULL for a hand-uploaded file."

`electron/db/seed.ts:363`: `'Anschreiben'`.

`src/state/store.tsx:1050`: `api.db.documents.setFile(documentId, filePath, pdfPath, null)`.

`electron/agent/orchestrator.ts:444`: add a fourth argument `null` for now (Task 3 replaces it with the label).

- [ ] **Step 5: Run the whole suite and typecheck**

`npx vitest run && npx tsc --noEmit -p tsconfig.json` (use the project's typecheck script if `package.json` has one). Expected: PASS. If a seed test asserts `'Cover Letter'`, update it to `'Anschreiben'`.

- [ ] **Step 6: Commit**

```bash
git add electron/db src/shared/db-types.ts src/state/store.tsx electron/agent/orchestrator.ts
git commit -m "feat(db): remember the template Fassung per document; call the letter Anschreiben"
```

---

### Task 3: Orchestrator — read the selected Fassung, stamp its label

**Files:**
- Modify: `electron/agent/orchestrator.ts:9,220-265,398-450`
- Modify: `electron/agent/labels.ts:61-65`
- Test: `electron/agent/__tests__/orchestrator.test.ts`, `electron/agent/__tests__/labels.test.ts:68`

- [ ] **Step 1: Failing tests**

In `orchestrator.test.ts`, change `uploadTemplates` to write Fassungen (this also stops relying on lazy migration):

```ts
function uploadTemplates(slots: string[] = ['lebenslauf', 'anschreiben'], label = 'Standard') {
  for (const dir of slots) {
    const d = path.join(root, 'templates', dir, label);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, dir + '.html'), `<html><body>${dir}-Vorlage</body></html>`);
    writeFileSync(path.join(root, 'templates', dir, '.selected'), label);
  }
}
```

Find the test around line 160-171 that asserts `cv.file_path` and add:

```ts
    expect(cv.template_label).toBe('Standard');
    expect(letter.template_label).toBe('Standard');
```

Add a test next to it:

```ts
  it('generates from the selected Fassung and records its label', async () => {
    uploadTemplates(['lebenslauf', 'anschreiben']);
    uploadTemplates(['lebenslauf'], 'Kurz'); // writes .selected = Kurz for the CV slot
    const appId = createApp({ postingText: POSTING });
    await runPipeline(appId); // use the same call the neighbouring tests use
    const docs = repo.load().documents.filter((d) => d.application_id === appId);
    expect(docs.find((d) => d.kind === DocumentKind.LEBENSLAUF)!.template_label).toBe('Kurz');
    expect(docs.find((d) => d.kind === DocumentKind.COVER_LETTER)!.template_label).toBe('Standard');
  });
```

(Adapt `POSTING`/`runPipeline` to whatever helpers the file already uses for a full successful run — copy from the test at ~line 160.)

In `labels.test.ts:68` change `'Cover Letter für Acme GmbH erstellt'` → `'Anschreiben für Acme GmbH erstellt'`.

- [ ] **Step 2: Run, expect FAIL**

`npx vitest run electron/agent/__tests__/orchestrator.test.ts electron/agent/__tests__/labels.test.ts`

- [ ] **Step 3: Implement**

`labels.ts` GEN_LETTER:

```ts
  [AgentStepKey.GEN_LETTER]: (ctx) => ({
    wait: `Anschreiben für ${ctx.company} erstellen`,
    run: `Anschreiben für ${ctx.company} wird erstellt…`,
    done: `Anschreiben für ${ctx.company} erstellt`,
  }),
```

`orchestrator.ts`: import `selectedTemplatePath` instead of `templatePath`. Replace `readTemplate`:

```ts
/* The selected Fassung of a slot: its markup and the label the generated
   document is stamped with. */
function readTemplate(
  userDataPath: string,
  kind: TemplateKind,
  name: string,
): { html: string; label: string } {
  const selected = selectedTemplatePath(userDataPath, kind);
  if (!selected) {
    throw new KeplerError(
      `Keine ${name}-Vorlage hochgeladen. Bitte im Profil (⌘P) eine HTML-Vorlage hinterlegen.`,
    );
  }
  return { html: readFileSync(selected.path, 'utf8'), label: selected.label };
}
```

In the pipeline, `docInput` becomes:

```ts
    const docInput = (kind: TemplateKind, name: string): DocumentInput & { label: string } => {
      const { html, label } = readTemplate(deps.userDataPath, kind, name);
      return {
        template: html,
        label,
        listing,
        extraction: needExtraction(),
        profileFacts: repo.load().profileFacts.map((f) => f.text),
        company: company.name,
        role: app.role,
      };
    };
```

and the two generation calls:

```ts
      const input = docInput(TemplateKind.LEBENSLAUF, 'Lebenslauf');
      cvHtml = await generateDocument(deps, applicationId, DocumentKind.LEBENSLAUF, cvPrompt(input), input.label);
```

(same for the letter with `letterPrompt` / `DocumentKind.COVER_LETTER`). `cvPrompt`/`letterPrompt` accept the extra property harmlessly (structural typing) — if `DocumentInput` is declared with exact keys and TS complains, pass `{ ...input }` minus `label` or extend `DocumentInput` with an optional `label?: string` that the prompt ignores. Prefer the destructure: `const { label, ...input } = docInput(...)`.

`generateDocument` gains `templateLabel: string` as its last parameter and passes it as the fourth argument to `setDocumentFile`.

- [ ] **Step 4: Run tests and typecheck, expect PASS**

`npx vitest run electron/agent && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add electron/agent
git commit -m "feat(agent): generate from the selected Fassung and stamp its label on the document"
```

---

### Task 4: IPC — Fassung channels in main and preload; drop the wrappers

**Files:**
- Modify: `electron/main.ts:10-28,195-207`
- Modify: `electron/preload.ts:116-125`
- Modify: `electron/files.ts` (delete `templatePath`, `copyTemplate` wrappers)
- Modify: `src/features/detail/AgentRunPanel.tsx:12-20,218-226,306-318` (compile against the new list shape)
- Modify: `src/features/profile/ProfileModal.tsx` (temporarily compile: replaced fully in Task 5 — do Task 5 immediately after; the intermediate state only needs to typecheck)

**Interfaces:**
- Produces on `window.desktop.templates`:
  ```ts
  list(): Promise<Record<TemplateKind, TemplateVersion[]>>
  add(kind, sourcePath): Promise<TemplateVersion>
  replace(kind, label, sourcePath): Promise<TemplateVersion>
  select(kind, label): Promise<void>
  rename(kind, from, to): Promise<TemplateVersion>
  remove(kind, label): Promise<void>
  open(kind, label?): Promise<string>   // '' on success; without label opens the selected Fassung
  ```

- [ ] **Step 1: main.ts handlers**

Replace the three template handlers with:

```ts
/* Profile templates: the Fassungen of the two documents that are not tied to
   an application. They share the picker above, so the extension is checked
   once more in the file layer before anything is written. */
ipcMain.handle('templates:list', () => listTemplates(app.getPath('userData')));

ipcMain.handle('templates:add', (_e, kind: TemplateKind, sourcePath: string) =>
  addTemplateVersion(app.getPath('userData'), kind, sourcePath),
);

ipcMain.handle('templates:replace', (_e, kind: TemplateKind, label: string, sourcePath: string) =>
  replaceTemplateVersion(app.getPath('userData'), kind, label, sourcePath),
);

ipcMain.handle('templates:select', (_e, kind: TemplateKind, label: string) =>
  selectTemplateVersion(app.getPath('userData'), kind, label),
);

ipcMain.handle('templates:rename', (_e, kind: TemplateKind, from: string, to: string) =>
  renameTemplateVersion(app.getPath('userData'), kind, from, to),
);

ipcMain.handle('templates:remove', (_e, kind: TemplateKind, label: string) =>
  removeTemplateVersion(app.getPath('userData'), kind, label),
);

/* Without a label the selected Fassung opens — what the agent panel's doc
   chips point at. */
ipcMain.handle('templates:open', (_e, kind: TemplateKind, label?: string) => {
  const root = app.getPath('userData');
  const filePath = label ? templateVersionPath(root, kind, label) : selectedTemplatePath(root, kind)?.path ?? null;
  return filePath ? shell.openPath(filePath) : 'Noch keine Datei hochgeladen.';
});
```

Update the import list from `./files.ts` (drop `copyTemplate`, `templatePath`; add the six new names + `selectedTemplatePath`, `templateVersionPath`).

- [ ] **Step 2: preload.ts**

```ts
  /* The profile-wide templates, as Fassungen per slot. There is no database
     behind these — the files on disk are the state, so every call reads fresh. */
  templates: {
    list: (): Promise<Record<TemplateKind, TemplateVersion[]>> => ipcRenderer.invoke('templates:list'),
    /* Copies a picked file in as a new Fassung under the next free name. */
    add: (kind: TemplateKind, sourcePath: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:add', kind, sourcePath),
    /* Swaps the file of an existing Fassung. */
    replace: (kind: TemplateKind, label: string, sourcePath: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:replace', kind, label, sourcePath),
    /* Marks the Fassung Kepler uses. */
    select: (kind: TemplateKind, label: string): Promise<void> =>
      ipcRenderer.invoke('templates:select', kind, label),
    rename: (kind: TemplateKind, from: string, to: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:rename', kind, from, to),
    /* Refused for the selected Fassung. */
    remove: (kind: TemplateKind, label: string): Promise<void> =>
      ipcRenderer.invoke('templates:remove', kind, label),
    /* Hands a Fassung's file to the OS — the selected one when no label is
       given; '' on success, else the reason. */
    open: (kind: TemplateKind, label?: string): Promise<string> =>
      ipcRenderer.invoke('templates:open', kind, label),
  },
```

Import `TemplateVersion` from `../src/shared/domain.ts`. If preload declares a `DesktopApi` type elsewhere (grep `templates:` in `src/shared` / a `global.d.ts`), update it identically.

- [ ] **Step 3: Delete the wrappers in files.ts** (`templatePath`, `copyTemplate` and their comment) and remove them from the test import if still present.

- [ ] **Step 4: AgentRunPanel — selected Fassung for the chips**

```ts
type Templates = Record<TemplateKind, TemplateVersion[]>;

const SLOT_TITLES: Record<TemplateKind, string> = {
  LEBENSLAUF: 'Lebenslauf',
  ANSCHREIBEN: 'Anschreiben',
};

/* The Fassung Kepler uses for a slot — what the doc chip stands for. */
function selectedOf(templates: Templates | null, kind: TemplateKind): TemplateVersion | undefined {
  return templates?.[kind].find((v) => v.selected);
}
```

and in the chip: `name={selectedOf(templates, doc)?.name ?? SLOT_TITLES[doc]}`, `size={selectedOf(templates, doc)?.size}`; `open(doc)` stays (opens the selected).

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit -p tsconfig.json`. `ProfileModal.tsx` will fail on `templates.save` and the `Slots` type; proceed straight into Task 5 (same commit).

---

### Task 5: Profile UI — one card per Fassung with a selection dot

**Files:**
- Create: `src/ui/SelectDot.tsx`
- Create: `src/features/profile/TemplateSlot.tsx`
- Modify: `src/features/profile/ProfileModal.tsx` (shrinks to shell + two `TemplateSlot`s)
- Modify: `src/app/app.css` (only if the dot needs a hover rule)

**Interfaces:**
- Consumes `window.desktop.templates.*` from Task 4.

- [ ] **Step 1: `SelectDot`**

```tsx
/* The radio-like dot that marks the Fassung Kepler uses: filled when it is
   the one, hollow otherwise. Clicking a hollow one selects it; the filled one
   is inert. */
export function SelectDot({ on, title, onSelect }: { on: boolean; title: string; onSelect: () => void }) {
  return (
    <div
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) onSelect();
      }}
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        flexShrink: 0,
        boxSizing: 'border-box',
        border: '1.5px solid ' + (on ? 'var(--c-3f6ea8)' : 'var(--c-c9c5bb)'),
        background: on ? 'radial-gradient(var(--c-3f6ea8) 45%, transparent 50%)' : 'transparent',
        cursor: on ? 'default' : 'pointer',
      }}
    />
  );
}
```

`DocumentCard` renders children on the right only; the dot has to sit left of the glyph. Add an optional `leading?: ReactNode` prop to `src/ui/DocumentCard.tsx` rendered before `<DocGlyph …/>`.

- [ ] **Step 2: `TemplateSlot`**

```tsx
import { useCallback, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { TemplateVersion } from '../../shared/domain';
import type { TemplateKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { DocumentCard } from '../../ui/DocumentCard';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { SelectDot } from '../../ui/SelectDot';
import { DocFormat, DotsGlyph } from '../../ui/icons';

/* One template slot of the profile: every Fassung as a card, the dot on the
   left marking the one Kepler uses, and a row to add another. All writes go
   through the desktop bridge and the parent's list is patched with what
   came back, so the cards always show what is on disk. */
export function TemplateSlot({
  kind,
  title,
  versions,
  loaded,
  onChange,
  onError,
}: {
  kind: TemplateKind;
  title: string;
  versions: TemplateVersion[];
  /* False until the first listing landed — nothing is claimed about the slot. */
  loaded: boolean;
  onChange: (next: TemplateVersion[]) => void;
  onError: (msg: string | null) => void;
}) {
  const { st, set } = useApp();
  const [busy, setBusy] = useState<string | null>(null); // label being written, or '' for a new one
  const [renaming, setRenaming] = useState<{ label: string; draft: string } | null>(null);

  const api = () => {
    const a = window.desktop;
    if (!a) onError('Ohne Desktop-Umgebung nicht möglich.');
    return a;
  };

  const patch = (v: TemplateVersion) =>
    onChange(
      [...versions.filter((x) => x.label !== v.label), v].sort((a, b) => a.label.localeCompare(b.label, 'de')),
    );

  const add = useCallback(async () => {
    const a = api();
    set({ dropdown: null });
    if (!a) return;
    onError(null);
    try {
      const source = await a.documents.pick('Vorlage auswählen', 'html');
      if (!source) return;
      setBusy('');
      patch(await a.templates.add(kind, source));
    } catch (err) {
      console.error('[templates]', err);
      onError(String(err));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, versions]);

  const replace = async (label: string) => {
    const a = api();
    set({ dropdown: null });
    if (!a) return;
    onError(null);
    try {
      const source = await a.documents.pick('Vorlage auswählen', 'html');
      if (!source) return;
      setBusy(label);
      patch(await a.templates.replace(kind, label, source));
    } catch (err) {
      console.error('[templates]', err);
      onError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const select = async (label: string) => {
    const a = api();
    if (!a) return;
    onError(null);
    try {
      await a.templates.select(kind, label);
      onChange(versions.map((v) => ({ ...v, selected: v.label === label })));
    } catch (err) {
      onError(String(err));
    }
  };

  const open = async (label: string) => {
    set({ dropdown: null });
    onError(null);
    const err = await window.desktop?.templates.open(kind, label);
    if (err) onError(err);
  };

  const remove = async (label: string) => {
    const a = api();
    set({ dropdown: null });
    if (!a) return;
    onError(null);
    try {
      await a.templates.remove(kind, label);
      onChange(versions.filter((v) => v.label !== label));
    } catch (err) {
      onError(String(err));
    }
  };

  const commitRename = async () => {
    const a = api();
    const r = renaming;
    setRenaming(null);
    if (!a || !r || r.draft.trim() === r.label) return;
    onError(null);
    try {
      const v = await a.templates.rename(kind, r.label, r.draft);
      onChange(
        [...versions.filter((x) => x.label !== r.label), v].sort((x, y) => x.label.localeCompare(y.label, 'de')),
      );
    } catch (err) {
      onError(String(err));
    }
  };

  const errorText = null; // errors are shown by the parent group

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-5f5c56)' }}>{title}</div>

      {versions.length === 0 && (
        <DocumentCard
          format={DocFormat.EMPTY}
          title={title}
          caption={busy === '' ? 'wird übernommen …' : loaded ? 'HTML-Datei auswählen' : ' '}
          hint="HTML-Datei auswählen"
          muted
          onClick={add}
        />
      )}

      {versions.map((v, i) => {
        const menuKey = `template:${kind}:${v.label}`;
        const working = busy === v.label;
        const flipUp = i === versions.length - 1 && versions.length > 1;
        const isRenaming = renaming?.label === v.label;
        return (
          <DocumentCard
            key={v.label}
            format={DocFormat.HTML}
            title={
              isRenaming ? (
                <input
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ label: v.label, draft: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  style={{ font: 'inherit', fontWeight: 600, border: 'none', outline: 'none', background: 'transparent', padding: 0, width: '100%' }}
                />
              ) : (
                v.label
              )
            }
            caption={working ? 'wird übernommen …' : `${v.name} · ${formatBytes(v.size)} · aktualisiert am ${isoToDate(v.day)}`}
            hint="Öffnen"
            muted={!v.selected}
            leading={<SelectDot on={v.selected} title={v.selected ? 'Diese Fassung nutzt Kepler' : 'Diese Fassung verwenden'} onSelect={() => select(v.label)} />}
            onClick={() => open(v.label)}
          >
            <PopoverAnchor>
              <div
                className="doc-dl"
                title="Mehr"
                onClick={(e) => {
                  e.stopPropagation();
                  onError(null);
                  set((s) => ({ dropdown: s.dropdown === menuKey ? null : menuKey }));
                }}
              >
                <DotsGlyph />
              </div>
              {st.dropdown === menuKey && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Popover top={32} style={flipUp ? { top: 'auto', bottom: 32 } : undefined} right={0} minWidth={196}>
                    <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => open(v.label)}>Herunterladen</MenuItem>
                    <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => replace(v.label)}>Ersetzen mit eigener Datei</MenuItem>
                    <MenuItem
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={() => {
                        set({ dropdown: null });
                        setRenaming({ label: v.label, draft: v.label });
                      }}
                    >
                      Umbenennen
                    </MenuItem>
                    <MenuItem
                      danger
                      disabled={v.selected}
                      title={v.selected ? 'Wird gerade verwendet' : undefined}
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={() => !v.selected && remove(v.label)}
                    >
                      Löschen
                    </MenuItem>
                  </Popover>
                </div>
              )}
            </PopoverAnchor>
          </DocumentCard>
        );
      })}

      {versions.length > 0 && <AddRow label="Fassung hinzufügen" onClick={add} />}
    </div>
  );
}
```

Notes for the implementer:
- Check `MenuItem` for a `disabled` prop; if it lacks one, add `disabled?: boolean` that sets `opacity: .45; pointer-events: none` (look at how `danger` is styled and mirror it). Drop the `errorText` line — it is a leftover, errors are the parent's.
- `DocumentCard.title` is typed `string`; widen to `ReactNode`.
- Remove the `flipUp` reasoning comment duplication; keep one comment.

- [ ] **Step 3: `ProfileModal`**

```tsx
import { useEffect, useState } from 'react';
import type { TemplateVersion } from '../../shared/domain';
import { TemplateKind } from '../../shared/enums';
import { CLOSED_PROFILE, useApp } from '../../state/store-context';
import { FieldGroup, ModalShell } from '../../ui/ModalShell';
import { FactList } from './FactList';
import { ProfileDocuments } from './ProfileDocuments';
import { TemplateSlot } from './TemplateSlot';

type Slots = Record<TemplateKind, TemplateVersion[]>;
const EMPTY_SLOTS: Slots = { [TemplateKind.LEBENSLAUF]: [], [TemplateKind.ANSCHREIBEN]: [] };

const SLOTS: { kind: TemplateKind; title: string }[] = [
  { kind: TemplateKind.LEBENSLAUF, title: 'Lebenslauf' },
  { kind: TemplateKind.ANSCHREIBEN, title: 'Anschreiben' },
];

/* The documents that belong to you rather than to a single application. There
   is no table behind them: the dialog reads the Fassungen from disk when it
   opens, so it always shows what is really there. */
export function ProfileModal() {
  const { set } = useApp();
  const [slots, setSlots] = useState<Slots | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.desktop?.templates
      .list()
      .then((s) => {
        if (live) setSlots(s);
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <ModalShell onClose={() => set(CLOSED_PROFILE)} header={<div style={{ fontSize: 15, fontWeight: 600 }}>Profil</div>}>
      <FieldGroup
        label="Templates"
        hint="Deine HTML-Templates. Du kannst je mehrere Fassungen halten — der Punkt markiert die, die Kepler für neue Bewerbungen nutzt. Die Originale bleiben unberührt."
      >
        {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {SLOTS.map(({ kind, title }) => (
            <TemplateSlot
              key={kind}
              kind={kind}
              title={title}
              versions={slots?.[kind] ?? []}
              loaded={slots !== null}
              /* Falls back to a blank pair rather than dropping the change: the
                 initial listing may still be in flight, or may have failed. */
              onChange={(next) => setSlots((s) => ({ ...(s ?? EMPTY_SLOTS), [kind]: next }))}
              onError={setError}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Dokumente" hint="Weitere Unterlagen, die du griffbereit haben willst — Immatrikulationsbescheinigung, etc. Beliebiges Format.">
        <ProfileDocuments />
      </FieldGroup>

      <FieldGroup label="Kontext" hint="Füge alles hinzu, was dich persönlicher macht — Sprachen, ein Umzug, etc.">
        <FactList />
      </FieldGroup>
    </ModalShell>
  );
}
```

- [ ] **Step 4: Typecheck, lint, run the app**

`npx tsc --noEmit -p tsconfig.json && npx vitest run`. Then start the app (`npm run dev` or the project's `run` skill) and check: empty slot card → picker → "Standard" appears with filled dot; add → "Fassung 2" hollow; dot click switches; menu items; rename inline; delete disabled on selected.

- [ ] **Step 5: Commit** (Tasks 4 + 5 together)

```bash
git add electron/main.ts electron/preload.ts electron/files.ts electron/__tests__/files.test.ts src/ui/SelectDot.tsx src/ui/DocumentCard.tsx src/ui/MenuItem.tsx src/features/profile src/features/detail/AgentRunPanel.tsx
git commit -m "feat(profile): manage template Fassungen per slot with a selection dot"
```

---

### Task 6: Detail view caption + remaining "Cover Letter" strings

**Files:**
- Modify: `src/features/detail/DocumentsSection.tsx:44-48`
- Modify: `src/data/sample-data.ts:324,409`
- Modify: `electron/db/__tests__/migrate.test.ts:84` (only if that fixture is asserted on by title — otherwise leave; it feeds migration 2)
- Test: a renderer test for the caption if a `DocumentsSection` test exists (`src/features/detail/__tests__`); if none, add a small pure helper + test:

- [ ] **Step 1: Extract the caption into a pure function with a test**

Create `src/features/detail/document-caption.ts`:

```ts
import { isoToDate } from '../../lib/date';
import type { DocumentRow } from '../../shared/db-types';

/* "erstellt am 14.08.2026 · Fassung Kurz" — the date the card stands for and,
   for a generated document, the profile Fassung it came from. */
export function documentCaption(d: Pick<DocumentRow, 'created_at' | 'updated_at' | 'template_label'>): string {
  const updated = d.updated_at > d.created_at;
  const day = isoToDate((updated ? d.updated_at : d.created_at).slice(0, 10));
  const base = (updated ? 'aktualisiert am ' : 'erstellt am ') + day;
  return d.template_label ? `${base} · Fassung ${d.template_label}` : base;
}
```

Test `src/features/detail/__tests__/document-caption.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { documentCaption } from '../document-caption';

describe('documentCaption', () => {
  const t = '2026-08-14T09:00:00.000Z';
  it('names the Fassung a generated document came from', () => {
    expect(documentCaption({ created_at: t, updated_at: t, template_label: 'Kurz' })).toBe('erstellt am 14.08.2026 · Fassung Kurz');
  });
  it('says nothing about a Fassung for hand-uploaded or older documents', () => {
    expect(documentCaption({ created_at: t, updated_at: t, template_label: null })).toBe('erstellt am 14.08.2026');
  });
  it('reads "aktualisiert" once the file was replaced', () => {
    expect(documentCaption({ created_at: t, updated_at: '2026-08-15T09:00:00.000Z', template_label: null })).toBe('aktualisiert am 15.08.2026');
  });
});
```

(Check `isoToDate`'s output format in `src/lib/date.ts` and adjust the expected strings.)

- [ ] **Step 2: Run → FAIL, then wire `DocumentsSection` to `documentCaption(d)` and delete the inline `caption` closure → PASS.**

- [ ] **Step 3: Sample data** — `sample-data.ts:324` "Lebenslauf und Anschreiben für Vector Labs erstellt", `:409` `'hat Anschreiben und Lebenslauf erstellt'`. Grep once more: `grep -rn "Cover Letter" src electron` should only hit the migration-2 fixture and prose comments.

- [ ] **Step 4: Full suite + typecheck + Prettier** — `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx prettier --check .` (fix with `--write` on touched files).

- [ ] **Step 5: Commit**

```bash
git add src/features/detail src/data/sample-data.ts
git commit -m "feat(detail): show the template Fassung on generated documents; Anschreiben wording"
```

---

## Self-review

- Spec coverage: storage/lazy migration/auto-naming (T1), IPC (T4), DB migration + repo + store NULL (T2), orchestrator + labels (T3), profile UI incl. inline rename, disabled Löschen, empty slot (T5), detail caption + AgentRunPanel + sample data (T4/T6). Sorting by `localeCompare('de')` — T1. Case-insensitive duplicate rejection — T1.
- Type consistency: `TemplateVersion {label, selected, name, size, day}` used identically in T1/T4/T5; `setDocumentFile(id, filePath, pdfPath, templateLabel)` in T2/T3; `templates.open(kind, label?)` in T4/T5/AgentRunPanel.
