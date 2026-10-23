#!/usr/bin/env node
/**
 * Adds the voice-over and music to the recorded demo (npm run demo:audio):
 *
 *   1. tts.py speaks every line of narration.json with Kokoro-82M (cached per line).
 *   2. Where a line is longer than its step, the step's frame is held (freeze frame) so the
 *      voice is never rushed; captions are part of the picture, so they stay in sync.
 *   3. The video is re-encoded with those holds, music.py composes music to its length and
 *      sections, mix.py places the voice and ducks the music under it, ffmpeg normalises the
 *      mix (measured gain, peak limiter) and muxes H.264 + AAC.
 *   4. The same for the trailer (its own lines), plus narration.srt and narration.txt.
 *
 *   options: --out <dir> (default ../slate-demo, which holds segments/ from demo:record),
 *            --work <dir> (default node_modules/.cache/slate-demo/audio), --voice <kokoro voice>,
 *            --only demo|trailer
 *   env: SLATE_DEMO_PYTHON (default <out>/.venv/bin/python, with kokoro, soundfile, scipy)
 *
 * See scripts/demo/README.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipParts, trailerPieces } from '../lib/assemble.mjs';
import { ffmpeg, FFMPEG, fmtTime, run } from '../lib/util.mjs';
import { SEGMENTS } from '../segments/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = resolve(opt('out', join(root, '..', 'slate-demo')));
const work = resolve(opt('work', join(root, 'node_modules', '.cache', 'slate-demo', 'audio')));
const only = opt('only', '');
const clips = join(out, 'segments');
const PY = process.env.SLATE_DEMO_PYTHON ?? join(out, '.venv', 'bin', 'python');
const FFPROBE = FFMPEG.replace(/ffmpeg$/, 'ffprobe');
const FPS = 30;
mkdirSync(work, { recursive: true });

const narrationFile = join(here, 'narration.json');
const narration = JSON.parse(readFileSync(narrationFile, 'utf8'));
const GAP = narration.gap ?? 0.35;
const MIX = narration.mix;

const py = (script, a) => run(PY, [join(here, script), ...a], { quiet: false });

/** Frame count of a clip (all clips are constant 30 fps). */
async function frames(file) {
  const o = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]);
  return Number(o.trim());
}

/** Integrated loudness, true peak and LRA of an audio or video file. */
async function loudness(file) {
  const o = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-map', 'a:0', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']).catch((e) => e.message);
  const num = (re) => Number(re.exec(o)?.[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * Normalises to `I` LUFS with a linear gain (measured first), then a peak limiter at `peak`
 * dBFS that only touches the rare peak above it, so the true peak stays below about peak + 0.5.
 */
async function normalise(src, dst, I, peak) {
  const gain = I - (await loudness(src)).I;
  const limit = (10 ** (peak / 20)).toFixed(4);
  await ffmpeg(['-i', src, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:level=0:attack=4:release=60`, '-ar', '48000', '-c:a', 'pcm_f32le', dst]);
}

/**
 * Places `lines` ({ at, dur, holdAt? }) in a clip of `duration` s and returns the holds
 * ({ at, dur }) needed so that each line ends `GAP` s before the next one starts (the last one
 * before `end`), and the clip's time map.
 */
function planHolds(lines, duration, { end = duration - 0.2, lastHoldAt = duration - 0.6 } = {}) {
  const holds = [];
  lines.forEach((ln, i) => {
    const next = lines[i + 1];
    const limit = next ? next.at : end;
    const need = ln.at + ln.dur + GAP - limit;
    if (need <= 0.02) return;
    const at = ln.holdAt ?? (next ? next.at - 0.5 : lastHoldAt);
    if (at <= ln.at) throw new Error(`hold for "${ln.text}" at ${at} s is before the line starts`);
    holds.push({ at, dur: Math.ceil(need * FPS) / FPS });
  });
  const map = (t) => t + holds.filter((h) => h.at < t).reduce((s, h) => s + h.dur, 0);
  return { holds, map, extra: holds.reduce((s, h) => s + h.dur, 0) };
}

/**
 * Filter-graph pieces for one input: frames [from, to) with freeze frames at the holds, then
 * optional fades. Returns the graph text and the output label.
 */
function clipGraph(input, label, from, to, holds, fade = 0) {
  const f0 = Math.round(from * FPS);
  const f1 = Math.round(to * FPS);
  const cuts = holds.map((h) => ({ f: Math.min(f1 - 1, Math.max(f0, Math.round(h.at * FPS))), n: Math.round(h.dur * FPS) })).sort((a, b) => a.f - b.f);
  const g = [];
  const bounds = [f0, ...cuts.map((c) => c.f + 1), f1];
  const segs = [];
  g.push(`[${input}:v]split=${bounds.length - 1}${bounds.slice(1).map((_, i) => `[${label}s${i}]`).join('')}`);
  for (let i = 0; i < bounds.length - 1; i++) {
    const pad = cuts[i] ? `,tpad=stop_mode=clone:stop=${cuts[i].n}` : '';
    g.push(`[${label}s${i}]trim=start_frame=${bounds[i]}:end_frame=${bounds[i + 1]},setpts=PTS-STARTPTS${pad}[${label}p${i}]`);
    segs.push(`[${label}p${i}]`);
  }
  const total = (f1 - f0 + cuts.reduce((s, c) => s + c.n, 0)) / FPS;
  const fades = fade ? `,fade=t=in:st=0:d=${fade}:color=0xfbfaf7,fade=t=out:st=${(total - fade).toFixed(3)}:d=${fade}:color=0xfbfaf7` : '';
  g.push(`${segs.join('')}concat=n=${segs.length}:v=1:a=0,fps=${FPS},format=yuv420p${fades}[${label}]`);
  return { graph: g.join(';\n'), label: `[${label}]`, duration: total };
}

/** Renders the concatenation of `pieces` ({ file, from, to, holds, fade }), cached by content. */
async function renderVideo(pieces, file) {
  const inputs = [...new Set(pieces.map((p) => p.file))];
  const key = createHash('sha1')
    .update(JSON.stringify([pieces.map((p) => [p.file, p.from, p.to, p.holds, p.fade]), inputs.map((f) => statSync(f).mtimeMs)]))
    .digest('hex');
  if (existsSync(file) && existsSync(`${file}.key`) && readFileSync(`${file}.key`, 'utf8') === key) return;
  const parts = pieces.map((p, i) => clipGraph(inputs.indexOf(p.file), `v${i}`, p.from, p.to, p.holds, p.fade));
  const graph = `${parts.map((p) => p.graph).join(';\n')};\n${parts.map((p) => p.label).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
  const gfile = `${file}.filter`;
  writeFileSync(gfile, graph);
  console.log(`Rendering ${file} (${parts.length} pieces)…`);
  await ffmpeg([...inputs.flatMap((f) => ['-i', f]), '-filter_complex_script', gfile, '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', file]);
  writeFileSync(`${file}.key`, key);
}

/**
 * Splits a line into subtitle cues of at most two rows of 42 characters, at sentence ends
 * where it can, else at commas. Cue times come from Kokoro's word timings when they match the
 * text word for word, else they are shared out by length.
 */
function cues(text, start, dur, timings = []) {
  const max = 84;
  const words = text.trim().split(/\s+/);
  const groups = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    let len = words[i].length;
    while (j + 1 < words.length && len + 1 + words[j + 1].length <= max) len += 1 + words[++j].length;
    if (j + 1 < words.length) {
      // prefer to end the cue after a sentence, then after a comma, in its second half
      const ends = (re) => {
        for (let k = j; k > i; k--) if (re.test(words[k]) && words.slice(i, k + 1).join(' ').length >= max * 0.4) return k;
        return -1;
      };
      const k = Math.max(ends(/[.;:?!]$/), -1);
      j = k >= 0 ? k : ends(/,$/) >= 0 ? ends(/,$/) : j;
    }
    groups.push([i, j]);
    i = j + 1;
  }
  const timed = timings.length === words.length;
  const chars = words.join(' ').length;
  let t = start;
  return groups.map(([a, b]) => {
    const txt = words.slice(a, b + 1).join(' ');
    let s0 = t;
    let s1 = t + (dur * (txt.length + 1)) / (chars + 1);
    if (timed) {
      s0 = start + (a === 0 ? 0 : timings[a][1]);
      s1 = start + (b === words.length - 1 ? dur : timings[b][2]);
    }
    t = s1;
    return { start: s0, end: s1, text: wrap(txt) };
  });
}

function wrap(s, width = 42) {
  if (s.length <= width) return s;
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? s : `${s.slice(0, best)}\n${s.slice(best + 1)}`;
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

function writeSrt(file, placed) {
  const all = placed.flatMap((l) => cues(l.text, l.t, l.dur, l.words));
  all.forEach((c, i) => {
    const next = all[i + 1];
    c.end = Math.min(c.end + 0.25, next ? next.start - 0.04 : c.end + 0.25);
  });
  writeFileSync(file, all.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'));
}

/** Music to `duration` with texture changes at `sections`, normalised to the music loudness. */
async function music(name, duration, sections, seed) {
  const raw = join(work, `${name}-music.raw.wav`);
  const norm = join(work, `${name}-music.wav`);
  await py('music.py', ['--duration', duration.toFixed(3), '--sections', sections.map((s) => s.toFixed(2)).join(','), '--seed', String(seed), '--out', raw]);
  await normalise(raw, norm, MIX.musicLufs, -3);
  return norm;
}

/** Mixes voice and music, normalises the mix and muxes it with the video. */
async function finishAv(name, video, duration, placed, musicFile, dest) {
  const job = join(work, `${name}-mix.json`);
  const mixed = join(work, `${name}-mix.wav`);
  writeFileSync(job, JSON.stringify({ duration, music: musicFile, out: mixed, lines: placed.map((l) => ({ file: l.file, t: l.t })), duckDb: MIX.duckDb, duckAttack: MIX.duckAttack, duckRelease: MIX.duckRelease }));
  await py('mix.py', [job]);
  const final = join(work, `${name}-final.wav`);
  await normalise(mixed, final, MIX.targetLufs, MIX.peak);
  await ffmpeg(['-i', video, '-i', final, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', dest]);
  // how loud each stem ended up in the final mix (same gain as the mix)
  const mixL = await loudness(mixed);
  const finL = await loudness(dest);
  const gain = finL.I - mixL.I;
  const voiceL = await loudness(mixed.replace('.wav', '.voice.wav'));
  const musicL = await loudness(mixed.replace('.wav', '.music.wav'));
  return { final: finL, voice: voiceL.I + gain, music: musicL.I + gain };
}

const tts = (lid) => manifest.lines[lid] ?? (() => { throw new Error(`no speech for ${lid}`); })();
let manifest;

async function main() {
  console.log('Speaking the lines (Kokoro-82M)…');
  await py('tts.py', ['--narration', narrationFile, '--work', work, ...(opt('voice') ? ['--voice', opt('voice')] : [])]);
  manifest = JSON.parse(readFileSync(join(work, 'tts', 'manifest.json'), 'utf8'));

  const parts = clipParts(clips, SEGMENTS);
  for (const p of parts) {
    if (!existsSync(p.file)) throw new Error(`missing ${p.file}: run npm run demo:record first`);
    p.frames = await frames(p.file);
    p.duration = p.frames / FPS;
  }
  const report = {};

  if (only !== 'trailer') {
    // ---- the full video: holds per part, then everything on one timeline
    let t = 0;
    const placed = [];
    const chapters = [];
    const pieces = [];
    const starts = {};
    for (const p of parts) {
      const lines = (narration.parts[p.id] ?? []).map((ln, i) => ({ ...ln, lid: `${p.id}#${i}`, dur: tts(`${p.id}#${i}`).duration }));
      const plan = planHolds(lines, p.duration);
      starts[p.id] = t;
      chapters.push({ t, title: p.title, level: 0 });
      for (const m of p.marks) chapters.push({ t: t + plan.map(m.t), title: m.name, level: 1 });
      for (const ln of lines) placed.push({ ...ln, t: t + plan.map(ln.at), file: tts(ln.lid).file, words: tts(ln.lid).words, part: p.id });
      pieces.push({ file: p.file, from: 0, to: p.duration, holds: plan.holds, fade: 0 });
      p.holds = plan.holds;
      t += p.duration + plan.extra;
    }
    const total = t;
    const video = join(work, 'demo-video.mp4');
    await renderVideo(pieces, video);
    // the music changes texture with each part (the title and the live app share the intro)
    const sections = parts.filter((p) => p.id !== 'live').map((p) => starts[p.id]);
    const m = await music('demo', total, sections, 3);
    const dest = join(out, 'slate-demo-narrated.mp4');
    report.demo = await finishAv('demo', video, total, placed, m, dest);
    report.demo.duration = total;
    report.demo.holds = parts.flatMap((p) => p.holds.map((h) => ({ part: p.id, at: h.at, dur: h.dur })));

    writeSrt(join(out, 'narration.srt'), placed);
    writeFileSync(join(work, 'demo-timeline.json'), JSON.stringify({ duration: total, starts, chapters, lines: placed.map(({ lid, step, text, t, dur }) => ({ lid, step, text, t, dur })) }, null, 1));
    const txt = [`Slate demo — voice-over (${manifest.voice}, Kokoro-82M) — ${fmtTime(total)}`];
    let last = '';
    for (const l of placed) {
      if (l.part !== last) txt.push('', `## ${parts.find((p) => p.id === l.part).title}`, '');
      last = l.part;
      txt.push(`[${fmtTime(l.t)}] ${l.step}: ${l.text}`);
    }
    txt.push('', '', `## Trailer`, '');
    for (const ln of narration.trailer.lines) txt.push(`(${ln.piece}) ${ln.text}`);
    writeFileSync(join(out, 'narration.txt'), txt.join('\n').replace(/^\n+/, '') + '\n');
    const ch = [`Slate demo (narrated) — ${fmtTime(total)} total`, ''];
    for (const c of chapters) ch.push(`${c.level ? '    ' : ''}${fmtTime(c.t)}  ${c.title}`);
    writeFileSync(join(out, 'chapters-narrated.txt'), ch.join('\n') + '\n');
  }

  if (only !== 'demo') {
    // ---- the trailer: its pieces, each held where its line needs it, with its own lines
    const tp = trailerPieces(parts);
    let t = 0;
    const placed = [];
    const pieces = [];
    const sections = [];
    tp.forEach((piece, k) => {
      const lines = narration.trailer.lines
        .map((ln, i) => ({ ...ln, lid: `trailer#${i}` }))
        .filter((ln) => ln.piece === piece.key)
        .map((ln) => ({ ...ln, dur: tts(ln.lid).duration }));
      const d = piece.to - piece.from;
      const fade = Math.min(0.25, d / 4);
      // the frame is held before the fade-out, and the line may run into the fade a little
      const plan = planHolds(lines, d, { end: d + 0.1, lastHoldAt: d - fade - 0.1 });
      for (const ln of lines) placed.push({ ...ln, step: piece.key, t: t + plan.map(ln.at), file: tts(ln.lid).file, words: tts(ln.lid).words });
      pieces.push({ file: piece.part.file, from: piece.from, to: piece.to, holds: plan.holds.map((h) => ({ at: piece.from + h.at, dur: h.dur })), fade });
      if (k === 0 || k === 1 || piece.key === 'gym/Mark for gym' || piece.key === 'end') sections.push(t);
      t += d + plan.extra;
    });
    const total = t;
    const video = join(work, 'trailer-video.mp4');
    await renderVideo(pieces, video);
    const m = await music('trailer', total, sections, 11);
    report.trailer = await finishAv('trailer', video, total, placed, m, join(out, 'slate-trailer-narrated.mp4'));
    report.trailer.duration = total;
    writeSrt(join(out, 'narration-trailer.srt'), placed);
    writeFileSync(join(work, 'trailer-timeline.json'), JSON.stringify({ duration: total, lines: placed.map(({ lid, step, text, t, dur }) => ({ lid, step, text, t, dur })) }, null, 1));
  }

  writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 2));
  for (const [k, r] of Object.entries(report))
    console.log(`${k}: ${fmtTime(r.duration)} (${r.duration.toFixed(2)} s); mix ${r.final.I} LUFS, true peak ${r.final.TP} dBTP, LRA ${r.final.LRA} LU; voice ${r.voice.toFixed(1)} LUFS, music ${r.music.toFixed(1)} LUFS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
