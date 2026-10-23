# Demo video

`record.mjs` records the Slate demo: a title card, the live app, a tour of the five workflows,
panes, the iPhone layout and set-up, and an end card. It drives the test build (`SLATE_E2E=1`)
in Chromium with real pen, mouse and keyboard input and records it with the DevTools
screencast at 1920 × 1080 (a 1440 × 810 layout at 4/3 scale).

```sh
npm run demo:record                              # build, record every segment, assemble
npm run demo:record -- --no-build --only canvas  # re-record one segment (comma-separated list)
npm run demo:record -- --assemble                # only put the recorded segments together
```

Options: `--out <dir>` (default `../slate-demo`), `--work <dir>` (default
`node_modules/.cache/slate-demo`: the build, frames and generated content), `--app-port 4310`,
`--api-port 4610`. `DEMO_PACE` scales every pause (default `0.75`; `1` is the nominal pace).
Needs Node 22.18 or later (it loads TypeScript test helpers), ffmpeg (`FFMPEG`, default
`/usr/bin/ffmpeg`) and Chromium (`SLATE_CHROMIUM`, default `/opt/pw-browsers/chromium`).

Output, in `--out`:

| File | Content |
| --- | --- |
| `slate-demo.mp4` | the full video (H.264, yuv420p, faststart) |
| `slate-trailer.mp4` | about 50 s of highlights |
| `poster.png` | a still |
| `chapters.txt` | chapter and step timestamps |
| `segments/` | each segment as recorded (kept, so one segment can be re-recorded) |

## How it works

- `lib/server.mjs`: one local server with the mocked GitHub (`src/core/sync/git/fakeGitHub.ts`)
  holding `preetsingh-007/gym` on branch `claude/stoic-pascal-tk33n8` and accepting only an
  obviously fake token, and the fake fetch helper of the e2e tests plus the demo's own article.
  The app's fetch helper address (`https://slate-fetch.demo.workers.dev/`) is routed to it by
  Playwright. Nothing but the opening shot of the live site touches the internet.
- `lib/content.mjs`: the gym repository (the e2e fixture with richer eigenvalue notes), a paper
  printed to PDF by Chromium, an EPUB, a photo of a board, a web article and a chatbot answer.
- `lib/overlay.js`: injected into the page while recording: the pointer and pen indicator, tap
  ripples, captions, keycaps and section titles. It also turns off the browser's predicted
  pointer points, which overshoot with synthetic pen input.
- `lib/input.mjs`: the pointer glides to targets, typing has a rhythm, pen strokes are pen
  pointer events with pressure; `lib/handwriting.mjs` is a small single-stroke font for them.
- `lib/recorder.mjs`: screencast frames → constant-rate clip; `cut()` removes waiting.
- `segments/*.mjs`: one file per segment, each starting from empty storage with what it needs
  seeded through the test hooks; `segments/index.mjs` sets the order.
- `lib/assemble.mjs`: concatenation, chapters, trailer (each segment's `trailer` entries) and
  poster.

After changing the app, re-record the segments that show the change and run `--assemble`.
