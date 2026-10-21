# Architecture

Slate is a local-first web app. Every change is saved on the device first (IndexedDB) and synced in the background to the owner's gym repository on GitHub, which is the source of truth. The product requirements are in the PRD; requirement ids (C1, L7, R4, G3…) are referenced in code and tests.

## Layout

```
src/
├── core/                 no React; unit-tested with Vitest
│   ├── model/            data model types (types.ts), captures
│   ├── util/             ids, time, fractional z-index, emitter, LRU
│   ├── storage/          IndexedDB (idb.ts), Yjs document store (docstore.ts), assets by hash
│   ├── stores/           canvases, library, settings, to-dos; document ids
│   ├── canvas/           canvas model over monthly segments, segment layout, spatial index
│   ├── ink/              stroke geometry, smoothing, rendering (from Axiom)
│   ├── markdown/         Markdown + KaTeX rendering, task items
│   ├── gym/              read access to gym's files
│   ├── sync/             GitHub API, sync engine, derived files
│   ├── library/          PDF and EPUB ingest, clippings, annotations
│   └── locators/         source links and re-anchoring
├── app/services.ts       long-lived services shared through React context
└── ui/                   React components by area (app, canvas, library, gym, sync, panes)
worker/                   Cloudflare Worker fetch helper
tests/e2e/                Playwright tests; tests/e2e/server.mjs serves fixtures and a mocked GitHub API
tests/gym/check.py        copy of gym's checker, run on app output (npm run test:gym)
```

## Storage contract

All local state is in one IndexedDB database (`slate`), with three object stores: `updates` (Yjs update logs per document), `blobs` (files by SHA-256) and `kv`.

| Key or id | Content | Repository file |
| --- | --- | --- |
| doc `seg:<canvas>:<YYYY-MM>` | canvas segment ([segment.ts](../src/core/canvas/segment.ts)) | `journal/<canvas>/<YYYY-MM>/canvas.yjs` |
| doc `todo` | Y.Text `checklist`, one `- [ ]` task per line | `journal/todo.yjs` |
| doc `ann:<item id>` | Y.Map `annotations`: id → Annotation | `library/books/<slug>/annotations.yjs`, `library/clippings/<slug>/annotations.yjs` |
| kv `canvases` | `CanvasMeta[]` | `journal/<canvas>/canvas.json` |
| kv `library` | books, clippings, tombstones | `library/books/<slug>/book.json`, `library/clippings/<slug>/meta.json` |
| kv `clipping:<id>` | `ClippingContent` (Markdown, snapshot HTML, asset list) | `clipping.md`, `snapshot.html`, `assets/` |
| kv `settings` | `SyncedSettings` | `library/settings.json` |
| kv `secrets`, `prefs` | token, repository, helper; device preferences | never written to the repository |
| kv `formalized` | parsed `journal/formalized.md` | read only |
| kv `gym:*` | mirror of gym's files for offline reading | read only |
| blob `<sha256>` | images, clip images, snapshot resources, book files | `assets/<sha256>.<ext>` (book files only in Git LFS mode) |

## Canvas

A canvas is a set of monthly segment documents presented as one surface by [`CanvasModel`](../src/core/canvas/model.ts). An object lives in the segment of the month it was created in. Write through `model.transact(tx => …)`: one call is one undo step, even across segments. Text-box text is a `Y.Text` (`model.textOf(id)`); edit it with origin `'local'` so typing is undoable.

Strokes and shapes store absolute canvas coordinates; their header `x, y, w, h` is the bounding box of the geometry and `rotation` is 0. Text boxes, images and clips have a frame (`x, y, w, h`) and a `rotation` around its centre.

Rendering: strokes and shapes are drawn on canvas tiles (only visible tiles, cached per zoom level); text boxes, images and clips are DOM elements, mounted only when visible, under the ink layer.

## Sync

Sync pulls on open and on returning to the foreground, and pushes about 20 seconds after the last change and when the app goes to the background. Yjs documents merge; JSON files merge field by field; derived files are regenerated, never merged. Commits touch only `journal/` and `library/`.

The engine is [`core/sync/engine.ts`](../src/core/sync/engine.ts) (`services.sync`); the GitHub API is [`git/github.ts`](../src/core/sync/git/github.ts), whose `commit` is the one place that writes and checks the write scope ([`scope.ts`](../src/core/sync/scope.ts)). A push is up to one commit per scope, library before journal, published with one ref update ([`commits.ts`](../src/core/sync/commits.ts)).

| File | On pull | On push |
| --- | --- | --- |
| `*.yjs` (segments, `todo.yjs`, annotations) | merged as CRDT updates; segments and annotations only if the device has them | the merged state, when GitHub lacks part of it |
| `canvas.json`, `book.json`, `meta.json` | three-way merge per field against the last synced version (both changed: this device wins; `topics` as sets; `segments` per month) | written when different |
| `settings.json` | `mergeSettings`: reading positions and pane state by their own time, the rest newest-wins | written when different |
| `clipping.md`, `snapshot.html`, assets | downloaded when opened | written once (content is immutable, L11); assets once per content hash |
| derived (`days/`, `marks/`, `queue.md`, `todos.md`, READMEs, `annotations.md`) | ignored, except queue and to-do lines of segments not on the device | regenerated ([`derived/`](../src/core/sync/derived)) |
| `formalized.md` | parsed into `services.formalized` | never written |

Other areas download content on demand before opening it: `canvases.model(slug)` already asks sync for each month it loads; call `services.sync.ensureDoc(annotationsDocId(id))` before opening a book's or clipping's annotations, `services.sync.ensureClipping(id)` before reading a clipping's content, and `services.sync.ensureBookFile(id)` for a book file in Git LFS mode. `services.gymFiles` is the offline mirror of gym's Markdown and images, refreshed on every pull.
