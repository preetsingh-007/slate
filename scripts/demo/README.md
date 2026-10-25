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

## Voice-over and music

`npm run demo:audio` turns the recorded segments into `slate-demo-narrated.mp4` and
`slate-trailer-narrated.mp4` (H.264 + AAC 192 kbps, faststart), with `narration.srt`,
`narration-trailer.srt`, `narration.txt` and `chapters-narrated.txt`, in the same `--out`
folder. It needs the segments from `demo:record` and a Python 3.12 virtual environment with
Kokoro (default `../slate-demo/.venv`, or `SLATE_DEMO_PYTHON`):

```sh
python3.12 -m venv ../slate-demo/.venv
../slate-demo/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
../slate-demo/.venv/bin/pip install kokoro soundfile scipy
npm run demo:audio                       # both videos
npm run demo:audio -- --only trailer     # or --only demo; --voice af_bella tries another voice
```

The first run downloads Kokoro-82M (about 330 MB) and spaCy's small English model into the
user's caches. Work files (speech, the re-timed video, stems) go to `--work` (default
`node_modules/.cache/slate-demo/audio`); speech and video are cached, so editing one line only
speaks that line again.

- `audio/narration.json`: the script. Each line belongs to a part (`title`, a segment id,
  `end`) and starts `at` seconds into that part's clip, just after its caption appears; the
  `lexicon` respells words for the voice (`/…/` is Kokoro phonemes); `trailer.lines` belong to
  the trailer's pieces. When a line is longer than its step, `build.mjs` holds the step's last
  frame (0.5 s before the next line, or at `holdAt`), so the captions, which are part of the
  picture, stay in sync and nothing is rushed.
- `audio/tts.py`: Kokoro-82M, voice `af_heart`, one clip per line; high-pass, gentle
  compression, −16 LUFS, peaks limited to −3 dBFS, silence trimmed.
- `audio/music.py`: original music synthesised with numpy and scipy (pad, plucked arpeggio,
  electric piano, bells, bass, soft drums at 84 BPM in C); the texture changes with each part
  and it ends on a held chord at the video's last frame.
- `audio/mix.py`: places the voice and ducks the music 8 dB under it; `build.mjs` normalises the
  mix to −16 LUFS (true peak below −1 dBTP) and muxes it.

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
