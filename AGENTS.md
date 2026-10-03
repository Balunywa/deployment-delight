# Agent instructions

Start with [docs/HANDOFF.md](docs/HANDOFF.md): product direction (an SE/CSA engagement tool; MSX through msx-mcp),
what's built, how to build, test and deploy, the current blocker, and what to do next. Then read `README.md`.

Rules that matter most:

- MSX is the system of record. Store only the TPID, opportunity IDs and our own context. Never hold MSX credentials,
  and never write to MSX without the user confirming the exact text.
- Before calling work done: `npx tsc --noEmit -p .` clean, `npx eslint src e2e` adds no warnings, `npx playwright test`
  passes, then run the desktop runtime (`node desktop/launcher.mjs`) and check the change there with Playwright (see
  the handoff). The Azure-hosted app is retired: don't deploy to it.
- Tests tagged `@readonly` must stay data-agnostic (a fresh desktop install has no demo data).
- New migrations go in `db/migrations` (applied at startup, on PGlite in the desktop app too). The audit log is
  append-only.
- Never print or commit secrets (`MCP_TOKEN`, database credentials). Commit messages end with
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
