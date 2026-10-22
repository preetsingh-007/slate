# On-device checks

The automated tests run in Chromium on a Linux machine. What only real hardware can show (Pencil feel, Safari's behaviour, two devices on real networks) is checked by hand on the owner's **iPad** (M1 iPad Pro, Safari, installed to the Home Screen) and **Mac** (2020 MacBook Air, Chrome and Safari), at each milestone gate in the PRD. Tick each line, note the date and the build (the commit), and file anything that fails as an issue with the device, the browser version and the steps.

## Before you start

- Install the build under test: open the GitHub Pages address in Safari on the iPad and **Share → Add to Home Screen**; on the Mac use Chrome.
- Connect both devices to the same gym repository (a test copy of gym is fine).
- For the stress checks, use a test build, which exposes the app to Safari's Web Inspector console: on the Mac run `SLATE_E2E=1 npm run build && npx vite preview --host --port 4173`, open `http://<mac name>.local:4173/` on the iPad, and connect **Safari → Develop → <iPad>** on the Mac (enable **Settings → Safari → Advanced → Web Inspector** on the iPad). Test builds also allow `http://localhost:*` connections; never install one as your everyday app.

## Milestone 1: canvas

- [ ] **Pencil latency.** Write a paragraph quickly at 100% and at 300% zoom. Wet ink stays under the Pencil tip with no visible lag or catch-up jumps; strokes do not change shape when the Pencil lifts.
- [ ] **No stroke waits.** Write while a sync is running (tap the cloud button, then **Sync now**) and with the network off: ink is just as immediate.
- [ ] **Palm rejection.** Rest the hand on the screen while writing for a page: no marks from the palm, no zooming or panning. After the first Pencil stroke one finger pans and two fingers pan and zoom. **Canvas settings → Draw with a finger** makes the finger draw.
- [ ] **Scribble in text boxes.** Double-tap an empty spot, write with the Pencil in the text box: Scribble converts the handwriting; scratch-out deletes, and nothing is lost when the box closes. Maths in `$…$` renders when not editing.
- [ ] **Pinch feel.** Pinch and pan with two fingers: the point under the fingers stays put, 10% to 800%, no jitter at the limits.
- [ ] **Space insertion feel.** Hold two fingers still for about 0.4 s, then spread vertically: space opens at the midpoint, only the visible area moves, the guide follows the fingers, and one undo restores it. Pinch to remove space: objects stop 8 units apart and never overlap. Try horizontally too. Adjust the hold time in **Canvas settings** if 0.4 s feels wrong (an open question in the PRD).
- [ ] **50,000 strokes at 60 fps.** In a test build's Web Inspector console on the iPad, add 50,000 strokes, then pan and zoom with two fingers; it should feel like an empty canvas (Web Inspector's **Timelines → Frames** shows 60 fps):

  ```js
  const h = __slateCanvas.main, now = Date.now(), objs = [];
  for (let i = 0; i < 50000; i++) {
    const x0 = (i % 250) * 40, y0 = Math.floor(i / 250) * 40, pts = [];
    for (let k = 0; k < 10; k++) pts.push(x0 + k * 3, y0 + Math.sin(k + i) * 8, 0.5);
    objs.push({ id: 'p' + i.toString(36), kind: 'stroke', x: x0, y: y0 - 8, w: 27, h: 16, rotation: 0, z: 'a' + i.toString(36).padStart(4, '0') + '1', created: now, edited: now, device: h.ctl.device, topics: [], pts, tool: 'pen', color: 'currentInk', size: 2.5 });
  }
  h.ctl.addObjects(objs);
  ```

  Then zoom out to 10%: the view fills in within a few seconds without freezing. Undo (⌘Z or a two-finger tap) removes them.
- [ ] **Photos.** **Insert image → Take a photo**: the camera opens, the photo lands downscaled, ink drawn on it moves with it.
- [ ] **Pencil double-tap.** Confirm it still does nothing in Safari (a platform limit) and that a stylus barrel button, if you have one, acts per **Canvas settings → Stylus button**.

## Milestone 2: sync

- [ ] **Two devices, offline, merging.** Turn on Airplane Mode on the iPad and disconnect the Mac's Wi-Fi. On both, add strokes and text to the same day of the same canvas, edit the same text box differently, check different to-dos, and add a mark. Reconnect one device, wait until it shows **Synced**, then the other. Both show everything from both, the text box has both edits, and nothing is lost.
- [ ] **A minute.** With both online and Slate open, draw on one: it appears on the other within 60 seconds.
- [ ] **gym CI on app commits.** On GitHub, the gym repository's Actions show `scripts/check.py` passing on Slate's `journal: …` and `library: …` commits, and those commits touch only `journal/` and `library/`.
- [ ] **Token.** Revoke the token on github.com: Slate pauses sync, says why, keeps changes, and resumes after you paste a new one. The token never appears in the repository.
- [ ] **New device.** On a third browser (or after **Settings → Rebuild local cache**), sign in: the library and canvas list arrive first, canvases and books download when opened.

## Milestone 3: library

- [ ] **800-page PDF.** Import a real 800-page book: the first page shows in under 2 seconds; scrolling end to end stays smooth and Safari does not reload the page (a sign of memory pressure).
- [ ] **Five real articles offline.** Save five real articles with **New from link** (one an arXiv HTML paper, one with lots of images, one with maths), then turn on Airplane Mode and quit the app. Reopen: each opens in Reader and Original views, with images and maths.
- [ ] **Chatbot answers.** Copy an answer in the ChatGPT and Claude apps and use **New from clipboard**: Markdown and maths render correctly, the source label is right, it takes under half a second.
- [ ] **EPUB.** Read an EPUB in light and dark themes and at three font sizes; highlights and notes stay on their words.

## Milestone 4: lasso and source links

- [ ] **Split View drag and drop.** With Slate and Safari (or Files, or Photos) side by side in Split View and in Stage Manager, drag an image, a text selection, a link and a PDF into Slate's canvas: each lands as an image, a text box, a New from link offer and a book. Drag a selection out of Slate (the grip in the selection bar) into Notes: it arrives as an image and its text.
- [ ] **Badges offline.** For a clip from a PDF, an EPUB, a clipping (Reader and Original), a gym file and a second canvas: in Airplane Mode, tap the badge; the source opens at the place, flashed for 2 seconds.
- [ ] **Narrow.** In Slide Over, one pane shows at a time; a lasso sends the capture to the carry tray; drag it onto the canvas.

## Milestone 5: gym interface

- [ ] **Formalize round trip.** Mark a canvas region as a problem with a topic. After the next sync, `journal/queue.md` lists it. In the gym repository ask an agent to formalize it (the `formalize` skill); it writes the problem file and appends to `journal/formalized.md`. After Slate's next pull the mark shows a badge, and tapping it opens the new gym file at the right heading. CI stays green.
- [ ] **Dismiss.** Dismiss a mark in gym: Slate shows "dismissed".
- [ ] **Revision list and log.** The revision list matches gym's problems and log; `log-session` proposes entries from the day files.

## Milestone 6: finish

- [ ] **Install.** The Home Screen icon and name are Slate; it opens full screen without Safari's bars; the status bar area is not covered. With the network off, the installed app starts, books and clippings open, and the canvas works.
- [ ] **Closing mid-work.** Start a stroke and, with the Pencil still down, swipe up to the Home Screen and remove Slate from the app switcher; type in a text box and do the same. Reopen: the stroke and the text are there. Repeat on the Mac by closing the tab.
- [ ] **VoiceOver (iPad and Mac).** With VoiceOver on, the top bar, toolbar, selection actions, library items, dialogs and the To-dos page read with sensible names; the sync status is announced when it changes; dialogs keep VoiceOver inside until closed.
- [ ] **Keyboard (Mac, and iPad with a keyboard).** Without the mouse or touch: switch tools, start a text box (Enter), select objects (⌥→, ⇧⌥→), reach Mark for gym (Tab), open a book, lasso with the keyboard rectangle, open the To-dos page and the revision list. Focus is always visible. In Safari on the Mac turn on **Settings → Advanced → Press Tab to highlight each item on a webpage** first.
- [ ] **Themes and motion.** Switch the system to dark mode, then **Settings → Accessibility → Motion → Reduce Motion**: Slate follows both; flashes stay still and the view jumps instead of gliding. Text stays readable in both themes, including in bright sunlight on the iPad.
- [ ] **iPhone.** Install on the iPhone: read a book and a clipping, New from clipboard and New from link, the To-dos page and the revision list work one-handed; nothing is cut off at the edges or under the home indicator.
- [ ] **Network.** In Safari's Web Inspector **Network** tab during a working session, every request goes to the app's own address, `api.github.com` or your fetch helper.

## Acceptance

- [ ] W1 to W5 run end to end on the iPad and the Mac sharing one gym repository, each working offline in between, with nothing lost.
