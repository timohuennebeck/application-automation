# Template-Fassungen (A/B Templates) — Design

**Date:** 2026-08-15
**Status:** Approved in brainstorming (layout C, wording "Fassung", no "Aktiv" chip)

## Goal

Let the applicant keep several versions ("Fassungen") of the Lebenslauf template
and several of the Anschreiben template, mark one per slot as the one Kepler uses,
and have every generated document remember which Fassung it came from — so
variants can be compared against outcomes by hand later.

Decisions settled during brainstorming:

- **Manual switch, not an experiment.** No automatic alternation, no stats. The
  user picks the Fassung Kepler uses; the app records the choice per document.
- **Per slot, independently.** Lebenslauf and Anschreiben each have their own set of
  Fassungen and their own marked one. Lebenslauf "Kurz" + Anschreiben "Standard" is a
  valid combination.
- **Filesystem stays the source of truth** (approach A). No DB table for Fassungen.
- **Wording:** "Fassung" (never "Variante"), no "Aktiv" word — a filled dot marks the
  Fassung Kepler uses. New Fassungen are auto-named and renamed via the menu.
- **Rename "Cover Letter" → "Anschreiben" everywhere the UI says it.** Enum value
  `DocumentKind.COVER_LETTER` and file stems are unchanged.

Out of scope: per-run override at start time, aggregation/statistics per Fassung,
paired sets across the two slots.

## Storage (electron/files.ts)

Today: `userData/templates/<lebenslauf|anschreiben>/<Stem>.html`, one file per slot.

New layout — one subdirectory per Fassung, its name is the label:

```
userData/templates/lebenslauf/
  Standard/Timo_Huennebeck_Lebenslauf.html
  Kurz/Timo_Huennebeck_Lebenslauf.html
  .selected            ← contains "Kurz"
userData/templates/anschreiben/
  Standard/Timo_Huennebeck_Anschreiben.html
  .selected            ← contains "Standard"
```

- **Label = directory name.** Sanitised the way `profileDocumentPath` guards names:
  no path separators, no leading dot, trimmed, non-empty, max ~40 chars; anything
  else is rejected with a German error. Labels are unique per slot (case-sensitive
  on disk, but reject case-insensitive duplicates so macOS's case-insensitive
  filesystem cannot make two labels collide).
- **`.selected`** holds the label of the Fassung Kepler uses. Missing or stale
  (names a directory that no longer exists) → fall back to the alphabetically first
  Fassung and rewrite the file. Ignored by directory listings (starts with `.`).
- **Lazy migration** on first read (same pattern as the legacy-name rename in
  `templatePath` today): a slot directory that contains an HTML file directly, or the
  legacy flat `templates/lebenslauf.html`, is moved into `<slot>/Standard/<Stem>.html`
  and `.selected` is written as `Standard`. Existing installs therefore see one
  Fassung called "Standard", marked, with no re-upload.
- **Auto-naming** of a new Fassung: `Fassung 2`, `Fassung 3`, … — the smallest n ≥ 2
  whose label is free. (The first upload into an empty slot is `Standard`.)

### File-layer API (replaces the single-slot functions)

```ts
interface TemplateVersion extends TemplateInfo { label: string; selected: boolean }

listTemplateVersions(userDataPath, kind): TemplateVersion[]          // sorted by label
listTemplates(userDataPath): Record<TemplateKind, TemplateVersion[]>  // both slots at once
addTemplateVersion(userDataPath, kind, sourcePath): TemplateVersion   // copies under next free label; selects it if slot was empty
replaceTemplateVersion(userDataPath, kind, label, sourcePath): TemplateVersion
selectTemplateVersion(userDataPath, kind, label): void
renameTemplateVersion(userDataPath, kind, from, to): TemplateVersion
removeTemplateVersion(userDataPath, kind, label): void                // throws if it is the selected one
selectedTemplatePath(userDataPath, kind): { label: string; path: string } | null
```

`templatePath(kind)` (used by the orchestrator and `templates:open`) becomes
`selectedTemplatePath` — same null-when-empty contract, plus the label.

Sorting: by label with `localeCompare`, so "Standard" is not always first; the dot
says which one is in use, not the position.

## IPC (electron/main.ts, preload.ts)

`window.desktop.templates` becomes:

| channel             | args                    | returns                                   |
| ------------------- | ----------------------- | ----------------------------------------- |
| `templates:list`    | —                       | `Record<TemplateKind, TemplateVersion[]>` |
| `templates:add`     | kind, sourcePath        | `TemplateVersion`                         |
| `templates:replace` | kind, label, sourcePath | `TemplateVersion`                         |
| `templates:select`  | kind, label             | `void`                                    |
| `templates:rename`  | kind, from, to          | `TemplateVersion`                         |
| `templates:remove`  | kind, label             | `void`                                    |
| `templates:open`    | kind, label             | `''` or error string                      |

`templates:save` is removed (renderer only). Kind and label are validated in the
main process (unknown kind / unsafe label → throw), never joined into a path raw.

## Database

**Migration 20:** `ALTER TABLE documents ADD COLUMN template_label TEXT;` plus
`UPDATE documents SET title = 'Anschreiben' WHERE kind = 'COVER_LETTER' AND title = 'Cover Letter';`

`DocumentRow` gains `template_label: string | null`. `repo.setDocumentFile` takes a
`templateLabel: string | null` and writes it alongside the paths. The renderer's
`db:documents.setFile` ("Ersetzen mit eigener Datei" in the detail view) passes NULL —
a hand-uploaded document did not come from a Fassung, so the caption drops the label. New empty document rows are inserted
with title `'Anschreiben'`.

## Agent (electron/agent/orchestrator.ts)

`readTemplate` returns `{ html, label }` from `selectedTemplatePath`; the error text
stays ("Keine Lebenslauf-Vorlage hochgeladen …"). `generateDocument` passes the label
into `setDocumentFile`. The label is read once per generation step, so a switch in the
profile mid-run affects only steps that have not started. Prompts unchanged.

`labels.ts` GEN_LETTER strings say "Anschreiben für … erstellen/wird erstellt…/erstellt".

## Renderer

### Profil › Templates (`src/features/profile/ProfileModal.tsx`)

Hint: "Deine HTML-Templates. Du kannst je mehrere Fassungen halten — der Punkt
markiert die, die Kepler für neue Bewerbungen nutzt. Die Originale bleiben unberührt."

Per slot (`Lebenslauf`, `Anschreiben`), in that order:

- a small slot title row
- one `DocumentCard` per Fassung: a **selection dot** on the far left (new small
  component `SelectDot`, filled blue when selected, hollow grey otherwise; click on the
  dot selects, does not open), the HTML glyph, title = label, caption =
  `<file> · <size> · aktualisiert am <day>`. Unselected cards use the `muted` styling.
  Card click opens the file. `⋯` menu: **Herunterladen · Ersetzen mit eigener Datei ·
  Umbenennen · Löschen** ("Löschen" disabled on the selected Fassung).
- an `AddRow` **"Fassung hinzufügen"** → native picker (HTML) → `templates:add`.
- empty slot: a single muted card exactly as today ("Lebenslauf" / "Anschreiben",
  caption "HTML-Datei auswählen", click → picker; first upload becomes "Standard").
- **Umbenennen** is inline: the title turns into an input prefilled with the label,
  Enter/blur commits via `templates:rename`, Escape cancels; error text below the
  group as today.

The last card's menu still flips upward. State: `versions: Record<TemplateKind,
TemplateVersion[]> | null`, `busy: {kind,label}|null`, `renaming: {kind,label}|null`,
`error`. Extract the per-slot block into `TemplateSlot.tsx` to keep the modal short.

### Detail › Bewerbungsunterlagen (`DocumentsSection.tsx`)

Caption becomes `erstellt am 14.08.2026 · Fassung Kurz` when `template_label` is set;
unchanged otherwise. Document title for the letter reads "Anschreiben" (from the row).

### Agent panel (`AgentRunPanel.tsx`)

`SLOT_TITLES.ANSCHREIBEN = 'Anschreiben'`.

### "Cover Letter" → "Anschreiben" sweep

`ProfileModal.tsx`, `AgentRunPanel.tsx`, `electron/agent/labels.ts`, `electron/db/repo.ts`
(new row title), `electron/db/seed.ts`, `src/data/sample-data.ts` (sample comments),
plus migration 20 for existing rows. Comments/docstrings that say "cover letter" in
English prose can stay.

## Error handling

- Missing template at generation → existing `KeplerError` message.
- Unsafe / duplicate label → error string surfaced under the Templates group.
- Deleting the selected Fassung is refused in the file layer (defence in depth) and
  disabled in the menu.
- Stale `.selected` self-heals to the first label.
- Listing errors → group-level error text, as today.

## Testing

- `electron/__tests__/files.test.ts`: lazy migration (legacy flat file and single-file
  slot both end up as `Standard` + `.selected`), add auto-naming (`Fassung 2`, gap
  reuse), select/rename/remove incl. refusal to remove selected, stale `.selected`
  self-heal, label sanitising and case-insensitive duplicate rejection,
  `selectedTemplatePath` returns label.
- `electron/db/__tests__/migrate.test.ts`: migration 20 adds column and rewrites titles.
- `electron/db/__tests__/repo.test.ts`: `setDocumentFile` stores/clears `template_label`.
- Orchestrator test (if one exists for generateDocument): label reaches the row.
- Renderer: `DocumentsSection` caption with and without label; profile slot component
  renders dot state and menu items (disabled Löschen on selected).
