# CLAUDE.md

Bewerbungen — a local-first desktop tracker for job applications, in German.
Electron shell, React renderer, SQLite on disk, and an in-app agent ("Kepler")
built on the Claude Agent SDK.

## Commands

| Task      | Command          |
| --------- | ---------------- |
| Dev       | `npm run dev`    |
| Typecheck | `npx tsc -b`     |
| Lint      | `npm run lint`   |
| Test      | `npm test`       |
| Format    | `npm run format` |
| Package   | `npm run dist`   |

`npx tsc -b`, `npm run lint` and `npm test` must all be clean before work is
called done.

## Layout

- `electron/` — main process. Node, `tsconfig.node.json`, `module: nodenext`.
  - `electron/agent/` — Kepler: orchestrator, service queue, LLM calls,
    prompts, schemas, run store.
  - `electron/db/` — SQLite: schema, migrations, repo, seed, IPC.
  - `electron/files.ts`, `pdf.ts` — attachment storage and PDF rendering.
- `src/` — renderer. `tsconfig.app.json`, `moduleResolution: bundler`.
  - `src/features/<area>/` — screen-level components, one directory per area.
  - `src/ui/` — presentational primitives shared across features.
  - `src/state/` — the store, its context, selectors and DB views.
  - `src/shared/` — types and enums crossing the process boundary.
  - `src/lib/` — dependency-free helpers (dates, salary, URLs, text).
  - `src/data/` — static config (columns, options) and seed sample data.
- Tests live in `__tests__/` next to the code they cover.

The Agent SDK may only be imported from the main process — it spawns a bundled
CLI and is marked external in `vite.config.ts` (via `rolldownOptions`, not
`rollupOptions`; Vite 8 runs on rolldown and silently drops the latter).

## Style

- **Named exports and `export function` declarations.** No default exports, no
  exported arrow functions.
- **Explicit return types** on exported functions in `electron/` and `src/lib/`.
  React components are exempt.
- **Import extensions**: relative imports inside `electron/` carry the `.ts`
  extension (nodenext requires it). Imports inside `src/` omit it — except in the
  modules `electron/` also consumes (`src/shared/`, `src/data/`), where the
  extension is required by the importer and must stay.
- **`import type`** for type-only imports — `verbatimModuleSyntax` is on.
- **Comments are `/* */` blocks that explain _why_**, not what. A comment that
  restates the code is noise; one that records the reason a value is 76, or why
  labels wrap instead of truncating, is the point. Match the existing density.
- Prettier: single quotes, 2-space indent, semicolons, trailing commas, 110
  columns. Run `npm run format` rather than hand-aligning.
- German is the UI language. User-facing strings, DB content and sample data are
  German; identifiers, comments and commit messages are English.

## React

- Props are declared inline in the signature for small components, or as an
  `interface <Name>Props` when the component is large or the type is reused.
  A `*Props` interface stays unexported unless another module imports it. This
  does **not** apply to a type that is the declared return type of an exported
  function, or a field type of an exported interface — those are part of the
  module's surface and keep their `export` even with no direct importer.
- Styling is inline `style={{ ... }}` against CSS custom properties defined in
  `src/app/theme.css` (`var(--c-a5a29a)`). Shared style fragments live in
  `src/ui/styles.ts` so the same look is the same bytes everywhere.
- The store is a single provider (`src/state/store.tsx`) reached through
  `src/state/store-context.ts`. Derived data belongs in `src/state/selectors.ts`,
  not in components.

## Data

- Every mutation is written through `window.desktop.db`; the store keeps the
  in-memory view in sync. Never mutate domain state without persisting it.
- Schema changes need a migration in `electron/db/migrate.ts` with a test.

## Notes

- `noUnusedLocals` and `noUnusedParameters` are on, so `tsc` already catches
  unused locals. Dead code therefore hides at the **export** level: symbols
  exported but never imported anywhere.
- PDF templates: blur shadows and alpha gradients stall `printToPDF`. Keep
  template CSS to flat fills.
