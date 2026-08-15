# Bewerbungen

A local-first desktop app for tracking job applications, in German. Applications
move across a board, each one opens into a detail view holding the posting, the
contacts, the interview rounds and the documents — and an in-app agent
("Kepler") drafts the CV and cover letter for a posting from your profile.

Everything lives on your machine: a SQLite database and the document files in
Electron's `userData` directory. There is no server and no account.

## Stack

- **Electron 43** — main process in `electron/`
- **React 19 + Vite 8** — renderer in `src/`
- **node:sqlite** — persistence, schema and migrations in `electron/db/`
- **Claude Agent SDK** — Kepler, in `electron/agent/`

## Getting started

```sh
npm install
npm run dev
```

The first launch creates `bewerbungen.db` in `userData` and seeds it with sample
applications so the board isn't empty.

Kepler uses the Claude Agent SDK, which authenticates through your existing
Claude subscription via the bundled CLI.

## Scripts

| Command          | What it does                              |
| ---------------- | ----------------------------------------- |
| `npm run dev`    | Vite dev server + Electron, with HMR      |
| `npm run build`  | Typecheck and build renderer + main       |
| `npm test`       | Vitest, once                              |
| `npm run lint`   | Oxlint                                    |
| `npm run format` | Prettier, write                           |
| `npm run dist`   | Package a macOS .dmg via electron-builder |

## How Kepler works

A run is a deterministic step chain, not an autonomous loop —
`electron/agent/orchestrator.ts` decides what happens next and the model only
fills in individual steps:

```
FETCH → EXTRACT → CONTACTS → READ_CV → READ_LETTER → GEN_CV → GEN_LETTER → VALIDATE → COMMENT
```

It reads the posting, pulls out the role facts and contacts, reads your profile
CV and letter templates, drafts both documents for this specific posting,
validates the result, and leaves a comment on the application. Progress streams
to the renderer as `agent:event` pushes; a run can be stopped mid-step.

Every dependency with a side channel — network, model, PDF printing, events —
is injected, so the whole pipeline runs in tests against fakes and an in-memory
database.

## Conventions

See [CLAUDE.md](./CLAUDE.md) for layout, style and the rules that apply when
changing this codebase.
