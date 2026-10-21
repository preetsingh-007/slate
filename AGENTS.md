# Agent instructions

Slate is the app described in the PRD; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the code layout and the storage contract.

- Reference requirement ids (C4, L8, R6, G3…) in comments and test names where a requirement drives the code.
- Code in `src/core/` does not import React or `src/ui/`.
- Every requirement id has at least one automated test (Vitest for logic, Playwright for interaction).
- Before committing: `npm run typecheck && npm test`. Run `npm run test:e2e` for UI changes and `npm run test:gym` for changes to sync output.
- Never write outside `journal/` and `library/` in the gym repository (R5); the sync engine enforces this.
- The app contacts only GitHub and the fetch helper. Do not add other network calls or CDN assets.
- Commit messages: imperative summary line, then a body explaining why.
