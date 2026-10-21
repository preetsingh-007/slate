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
| kv `libtext:<id>` | text of a book or clipping for library search (L12), derived on each device | never written |
| blob `<sha256>` | images, clip images, snapshot resources, book files | `assets/<sha256>.<ext>` (book files only in Git LFS mode) |

## Canvas

A canvas is a set of monthly segment documents presented as one surface by [`CanvasModel`](../src/core/canvas/model.ts). An object lives in the segment of the month it was created in. Write through `model.transact(tx => …)`: one call is one undo step, even across segments. Text-box text is a `Y.Text` (`model.textOf(id)`); edit it with origin `'local'` so typing is undoable.

Strokes and shapes store absolute canvas coordinates; their header `x, y, w, h` is the bounding box of the geometry and `rotation` is 0. Text boxes, images and clips have a frame (`x, y, w, h`) and a `rotation` around its centre.

Rendering: strokes and shapes are drawn on canvas tiles (only visible tiles, cached per zoom level); text boxes, images and clips are DOM elements, mounted only when visible, under the ink layer.

## Sync

Sync pulls on open and on returning to the foreground, and pushes about 20 seconds after the last change and when the app goes to the background. Yjs documents merge; JSON files merge field by field; derived files are regenerated, never merged. Commits touch only `journal/` and `library/`.
