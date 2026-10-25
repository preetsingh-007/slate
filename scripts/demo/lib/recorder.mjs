/**
 * Records a page with the DevTools screencast (JPEG frames at the device resolution, as fast
 * as the page paints) and turns the frames into a constant-frame-rate H.264 clip with ffmpeg.
 * pause()/resume() cut waiting out of the timeline; mark() notes chapter times.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ffmpeg } from './util.mjs';

export const FPS = 30;

export class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = []; // { file, t } with t in seconds on the clip's timeline
    this.marks = [];
    this.n = 0;
    this.offset = 0; // seconds cut out by pauses
    this.pausedAt = null;
    this.latest = null; // latest frame file (also while paused)
  }

  now() {
    return performance.now() / 1000 - this.t0 - this.offset;
  }

  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.t0 = performance.now() / 1000;
    this.cdp.on('Page.screencastFrame', (f) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      const file = join(this.dir, `f${String(++this.n).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.latest = file;
      if (this.pausedAt === null) this.frames.push({ file, t: Math.max(0, this.now()) });
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    // the first frame arrives after the next paint
    const deadline = Date.now() + 3000;
    while (!this.frames.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    if (this.frames.length) this.frames[0].t = 0;
  }

  /** Stops adding frames to the timeline (the time until resume() is cut). */
  pause() {
    if (this.pausedAt === null) this.pausedAt = performance.now() / 1000;
  }

  resume() {
    if (this.pausedAt === null) return;
    this.offset += performance.now() / 1000 - this.pausedAt;
    this.pausedAt = null;
    // the page as it is now starts the resumed part
    if (this.latest) this.frames.push({ file: this.latest, t: this.now() });
  }

  /** Runs fn with the recording paused (setup work the viewer need not watch). */
  async cut(fn) {
    this.pause();
    try {
      return await fn();
    } finally {
      // let the page paint its new state before frames count again
      await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await new Promise((r) => setTimeout(r, 120));
      this.resume();
    }
  }

  mark(name) {
    this.marks.push({ name, t: this.now() });
  }

  async stop() {
    this.resume();
    this.end = this.now();
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await this.cdp.detach().catch(() => {});
    return { frames: this.frames, end: this.end, marks: this.marks };
  }

  /** Encodes the recorded frames into `out` (1920×1080, FPS, H.264). */
  async encode(out, { size = [1920, 1080], pad = '#e9ebef', fadeIn = 0.3, fadeOut = 0.3, fadeColor = '0xfbfaf7' } = {}) {
    const lines = ['ffconcat version 1.0'];
    const fr = this.frames.filter((f, i, a) => i === 0 || f.t >= a[i - 1].t);
    for (let i = 0; i < fr.length; i++) {
      const next = i + 1 < fr.length ? fr[i + 1].t : this.end;
      const d = Math.max(0.001, next - fr[i].t);
      lines.push(`file '${fr[i].file}'`, `duration ${d.toFixed(4)}`);
    }
    if (fr.length) lines.push(`file '${fr[fr.length - 1].file}'`);
    const list = join(this.dir, 'frames.ffconcat');
    writeFileSync(list, lines.join('\n') + '\n');
    const [w, h] = size;
    const fades = [];
    if (fadeIn) fades.push(`fade=t=in:st=0:d=${fadeIn}:color=${fadeColor}`);
    if (fadeOut) fades.push(`fade=t=out:st=${Math.max(0, this.end - fadeOut).toFixed(3)}:d=${fadeOut}:color=${fadeColor}`);
    const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${pad}`, `fps=${FPS}`, ...fades, 'format=yuv420p'].join(',');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS), '-an', out]);
    return out;
  }
}
