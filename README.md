# Slate

An infinite canvas for study work, with a library of books and clippings beside it, a lasso that carries anything onto the canvas with a link back to where it came from, and storage in your [gym](https://github.com/preetsingh-007/gym) repository on GitHub. Slate runs in the browser, works offline, and costs nothing beyond free tiers.

## First run

1. Open `https://preetsingh-007.github.io/slate/`.
2. Slate asks for your gym repository (`owner/name`), the branch (`main`) and a GitHub token, and shows how to make the token. In short: on github.com go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**; choose **Only select repositories** and pick only your gym repository; set **Contents** to **Read and write** (Metadata becomes read-only by itself); leave everything else at **No access**. Copy the token (`github_pat_…`) into Slate and choose **Verify and connect**.
3. Slate checks that the token can write to the repository and syncs for the first time. The token stays on this device; Slate warns 14 days before it expires and asks for a new one if GitHub rejects it, keeping every change meanwhile.

**Continue offline without sync** skips this; connect later from **Settings → GitHub**.

### Install on iPad

In Safari, open the address above, then **Share → Add to Home Screen**. Slate opens full screen from its icon and works without a network after the first visit. Do the same on iPhone; on a Mac, Chrome's **Install** button or Safari's **File → Add to Dock** does the same.

## The five workflows

**W1. Lecture.** Write on the canvas with the Pencil. The first thing you add on a new day, below everything else, draws a dashed line labelled with the date; the tag button on that label tags the day with gym topics. Take a photo of the board with **Insert image → Take a photo** and draw on it (ink drawn over an image moves with it). Add to-dos on the **To-dos** page (top bar), or type `- [ ] …` in a text box on the canvas.

**W2. Reading a paper.** **Library → Import** (or drop a PDF or EPUB anywhere). The book opens in the side pane. Highlight selected text, write on the page with the pen, or add a margin note. Choose **Lasso**, draw around a figure or paragraph, and **Send to canvas** (or drag the preview onto the canvas). The clip's badge opens the book at that place, flashed for 2 seconds. **Export a copy with annotations** saves a PDF with them drawn in; the book file itself never changes.

**W3. Chatbot answer.** Copy the answer in the chatbot's app, then **New from clipboard** (Ctrl/⌘ Shift V): it becomes a clipping, rendered as Markdown with maths, in the side pane. Lasso the useful part onto the canvas. **New from link** saves a web article the same way, with a Reader view and the Original page (a saved copy that opens offline).

**W4. Marking for gym.** Select a region with the lasso and choose **Mark for gym**: note, problem, solution or question, with an optional topic. The mark goes into `journal/queue.md`; in the gym repository, ask an agent to **formalize** it. When `journal/formalized.md` lists the mark, its flag on the canvas opens the resulting gym file.

**W5. Lookup and revision.** **Gym** (top bar) browses your gym repository's notes and problems, rendered, offline. **Revision list** shows problems to revisit, then open problems, then finished topics you have not logged for longest. Work on the canvas and mark the result as a **solution**.

The canvas and one side pane share the screen; drag the divider, swap sides, or make either full screen. On iPhone and in Slide Over one pane shows at a time (the layers button switches), and captures wait in the carry tray at the bottom until you drop them on the canvas.

## Sync

Everything is saved on the device first. While online and connected, Slate pulls when it opens, when you return to it and every 20 seconds, and pushes about 20 seconds after you stop (at most 30 seconds after the first change) and when you leave the app; a change reaches your other devices within a minute. Devices that worked offline merge when they meet: canvases, to-dos and annotations are merged edit by edit, nothing is lost. The cloud button in the top bar shows the state (synced, syncing, offline, or the error and what to do) and warns when changes have waited more than a day. Slate writes only `journal/` and `library/` in the repository, in commits named `journal: …` and `library: …`.

## The fetch helper (New from link)

A browser app cannot read other websites, so **New from link** asks a small Cloudflare Worker you deploy once (free tier) to download the page: see [worker/README.md](worker/README.md). Then enter its URL and secret in **Settings → Fetch helper**; both stay on the device. The helper receives only the page's address. When a site needs a login, shows a bot check or a paywall, Slate says so and offers New from clipboard instead. Everything else in Slate works without the helper.

## Keyboard

Every action except drawing works from the keyboard; **?** on the canvas shows this list.

| Keys | Action |
| --- | --- |
| P, M, E, L, T, S, H | Pen, highlighter, eraser, lasso, text, space, hand |
| Shift+E, Shift+L | Eraser whole/partial; lasso free-form/rectangle |
| Space (hold) | Hand tool while held |
| ⌘Z, ⇧⌘Z (Ctrl+Y) | Undo, redo |
| ⌘C, ⌘X, ⌘V, ⌘D | Copy (PNG and Markdown), cut, paste, duplicate |
| Delete | Delete the selection |
| ⌘G, ⇧⌘G | Group, ungroup |
| ], [ | Bring forward, send back |
| ⌘A | Select everything in view |
| ⌥→, ⌥← | Select the next or previous object in view |
| ⇧⌥→, ⇧⌥← | Add the next or previous object to the selection |
| Tab | From the canvas to the selection's actions (Mark for gym, tags, export…) |
| Arrows | Nudge the selection (Shift: 10×), or pan |
| ⌘=, ⌘−, ⌘0 | Zoom in, out, 100% |
| ⇧1, ⇧2 | Fit all, fit selection |
| Home | Jump to now |
| Enter | Edit the selected text box, or start one in view |
| Esc | Stop editing, close a menu or dialog, clear the selection |
| Ctrl/⌘ Shift V | New from clipboard |

In a book, clipping or gym file, **Lasso** takes the keyboard too: an arrow key shows a rectangle, arrows move it, Shift+arrows resize it, Enter captures it. Menus open with Enter and move with the arrow keys. Slate follows the system's light or dark appearance (or choose one in Settings) and its reduce-motion setting.

## Limitations

- **Pencil double-tap and squeeze** are not available to web apps in Safari. **Canvas settings → Stylus button** uses a stylus's barrel button where the browser reports it.
- **Book files** stay on each device and are matched by content. Git LFS mode allows files over 50 MB, but GitHub's LFS server does not accept uploads from web apps, so book files are not uploaded; import the same file on each device (a clip's link to a missing book offers to import it).
- **Share sheet**: iPad cannot share links into a web app; copy the link and use New from link.
- **Other websites** cannot be embedded: the Original view is a saved copy, with its scripts off unless you turn them on for that clipping (they then run sealed off from Slate's data).
- Images in Markdown that point to other websites show as links and are not loaded: Slate contacts only GitHub and your fetch helper.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit tests (Vitest)
npm run test:e2e     # Playwright: desktop and tablet profiles, then the performance budgets
npm run test:gym     # gym's check.py on the app's sync output
npm run build        # production bundle in dist/ (npm run build -- --base=/slate/ for Pages)
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the code and the storage contract; [docs/ON-DEVICE-CHECKS.md](docs/ON-DEVICE-CHECKS.md) lists what to check on the real iPad and Mac at each milestone gate.

## Deploy

1. In the repository settings, set **Pages → Source** to **GitHub Actions**. Pushes to the default branch deploy the app at `https://<owner>.github.io/<repository>/`.
2. Deploy the fetch helper once: [worker/README.md](worker/README.md).
