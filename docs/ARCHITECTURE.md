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

The app runs in one tab at a time: `main.tsx` holds a Web Lock (`app/tabLock.ts`) and another tab shows "Slate is open in another tab or window" with **Use here**, which takes the lock over (the first tab then reloads into that screen). Where Web Locks are missing, tabs still cannot overwrite each other: the kv stores change their entry in one transaction that re-reads it (`core/stores/sharedKv.ts`), and tabs announce kv writes and document updates over BroadcastChannels so the others re-read them.

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

A canvas is a set of monthly segment documents presented as one surface by [`CanvasModel`](../src/core/canvas/model.ts). An object lives in the segment of the month it was created in. Write through `model.transact(tx => …)`: one call is one undo step, even across segments. A write to a month that is not loaded yet (the first stroke after midnight on the 1st) waits in the model until that month opens, shown meanwhile, and joins the same undo step; the controller also loads the new month at midnight and on returning to the app. Text-box text is a `Y.Text` (`model.textOf(id)`); edit it with origin `'local'` so typing is undoable.

Strokes and shapes store absolute canvas coordinates; their header `x, y, w, h` is the bounding box of the geometry and `rotation` is 0. Text boxes, images and clips have a frame (`x, y, w, h`) and a `rotation` around its centre.

Rendering: strokes and shapes are drawn on canvas tiles (only visible tiles, cached per zoom level); text boxes, images and clips are DOM elements, mounted only when visible, under the ink layer.

The canvas UI lives in `src/ui/canvas/`: `engine/` is the imperative core (camera, pointer input, tiled ink layer, wet layer), `controller.ts` wraps the model for one open canvas (segment loading, day lines on add, dependents on delete), `actions.ts` holds the selection actions, and React components render the DOM objects, overlays, toolbar and dialogs. Pure logic (camera, tiles, hit testing, eraser, transforms, space insertion, day lines, marks, clipboard formats) is in `src/core/canvas/`. Other areas reach a canvas only through `ui/common/registries.ts` (`canvasApi(slug)`, selection actions, topic picker, source openers).

## Sync

Sync pulls on open, on returning to the foreground and every 20 seconds while the app is visible, and pushes about 20 seconds after the last change (at most 30 seconds after the first, so continuous work still goes out) and when the app goes to the background. A change therefore reaches another open device within 60 seconds (`worstCaseSyncDelayMs`). Changes of reading positions and pane state alone (P3) go out with the next push, when the app goes to the background, or after five minutes, so reading does not commit every half minute. A file GitHub refuses as too large is left out (with its clipping folder or its month's derived files), listed in the sync status and offered again a day later. Yjs documents merge; JSON files merge field by field; derived files are regenerated, never merged. Commits touch only `journal/` and `library/`.

The engine is [`core/sync/engine.ts`](../src/core/sync/engine.ts) (`services.sync`); the GitHub API is [`git/github.ts`](../src/core/sync/git/github.ts), whose `commit` is the one place that writes and checks the write scope ([`scope.ts`](../src/core/sync/scope.ts)). A push is up to one commit per scope, library before journal, published with one ref update ([`commits.ts`](../src/core/sync/commits.ts)).

| File | On pull | On push |
| --- | --- | --- |
| `*.yjs` (segments, `todo.yjs`, annotations) | merged as CRDT updates; segments and annotations only if the device has them | the merged state, when GitHub lacks part of it |
| `canvas.json`, `book.json`, `meta.json` | three-way merge per field against the last synced version (both changed: this device wins; never synced here: the repository wins; `topics` as sets; `segments` per month) | written when different |
| `settings.json` | `mergeSettings`: reading positions and pane state by their own time, the rest newest-wins | written when different |
| `clipping.md`, `snapshot.html`, assets | downloaded when opened | written once (content is immutable, L11); assets once per content hash. `clipping.md` holds the content verbatim; the backslashes that neutralise its broken links (G9) are listed in its `escapes` front matter and removed on download |
| derived (`days/`, `marks/`, `queue.md`, `todos.md`, READMEs, `annotations.md`) | ignored, except queue and to-do lines of segments not on the device | regenerated ([`derived/`](../src/core/sync/derived)) |
| `formalized.md` | parsed into `services.formalized` | never written |

Other areas download content on demand before opening it, without waiting when something is already local (it shows at once and the download merges in): `canvases.model(slug)` already asks sync for each month it loads (only an empty month waits), and `canvases.fetchAllSegments()` asks for every month for views that read all segments (S7 margin marks, canvas to-dos); call `services.sync.ensureDoc(annotationsDocId(id))` before opening a book's or clipping's annotations, `services.sync.ensureClipping(id)` before reading a clipping's content, and `services.sync.ensureBookFile(id)` for a book file in Git LFS mode. The library does this in `useAnnotations`, `useClippingContent` and `BookPane`. `services.gymFiles` is the offline mirror of gym's Markdown and images, refreshed on every pull.

## Library

Books (PDF, EPUB) and clippings open in the side pane (`src/ui/library/`); the logic is in `src/core/library/` and `src/core/html/toMarkdown.ts`.

- Book files are stored by SHA-256 in the asset store; a book synced without its file asks for it and matches the re-imported file by hash. Annotations live in `ann:<item id>`; PDF ink is stored in units of the page width.
- Clippings are read-only after creation. New from link goes through the fetch helper only: Readability gives the Reader view; the snapshot (HTML plus images, stylesheets, their `url()` resources and scripts, stored as `assets/<hash>.<ext>`) gives the Original view.
- Snapshots render only in `public/snapshot.html`, loaded with `sandbox="allow-scripts"` (never `allow-same-origin`) and fed over `postMessage`. Its own CSP allows no network and only its bootstrap script (by hash) and `blob:` scripts; after editing that script run `node scripts/snapshot-csp.mjs`.
- Text-quote anchors (highlights, notes, clip source links) are offsets into the text walk of `documentText` (`core/library/snapshot.ts`), which the viewers and the snapshot frame share.

## Panes and sources

`src/ui/app/` holds the shell: the main canvas plus one side pane (`Workspace.tsx`, P1), one pane at a time below 700 px wide (P2), and the app store (`store.ts`: canvas, tabs, divider, sides, full screen, carry tray). Each area registers what a side-pane tab of its kind shows (`ui/panes/registry.tsx`).

- P3: `layoutSync.ts` saves the layout to localStorage on every change (restored before the first render) and to `settings.panes` a moment later. Another device's newer layout is adopted on start or on returning to the app, never after a layout change made here since. Each tab keeps its place in `settings.readingPositions`: books and clippings by item id, gym files as `gym:<path>`, side-pane canvases as `canvas:<slug>` (their view, as a canvas locator). The main canvas opens per C20.
- Lasso (S1): books, clippings and gym files use `ui/sources/LassoOverlay.tsx`; a canvas in the side pane uses its own lasso, and its selection bar's Send to canvas makes a capture (`ui/canvas/sourceCapture.ts`: the region rendered from the objects, the Markdown of its text boxes and clips, a `canvas` source link).
- Moving captures (S3, S4): `ui/sources/send.ts` places them below the latest content when the main canvas is on screen, else in the carry tray; dropping goes through the main canvas's `CanvasApi.clientToCanvas`.
- Source links (S6): `registerSourceOpener(type, …)` per area (`book`, `clipping`: library; `gym`: gym; `canvas`: `ui/canvas/register.tsx`). Openers open the source in the side pane, wait for its content (downloading it if needed) and flash the location for 2 s.
- `canvasApi(slug)` returns the main pane's view of a canvas when it has one, else the side pane's.
- `tests/e2e/sources.spec.ts` is the Milestone 4 gate: every source type, lassoed onto the real canvas and back through the clip's badge, online and offline.
