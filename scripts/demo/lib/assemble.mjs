/**
 * Puts the recorded clips together: the full video (concatenated without re-encoding), the
 * chapter list, a trailer cut from each segment's highlights, and a poster frame.
 */
import { writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { duration, ffmpeg, fmtTime } from './util.mjs';

export async function assemble(parts, { out, work }) {
  // ---- full video
  let t = 0;
  const chapters = [];
  for (const p of parts) {
    p.duration = await duration(p.file);
    p.start = t;
    chapters.push({ t, title: p.title, level: 0 });
    for (const m of p.marks) chapters.push({ t: t + m.t, title: m.name, level: 1 });
    t += p.duration;
  }
  const list = join(work, 'full.ffconcat');
  writeFileSync(list, ['ffconcat version 1.0', ...parts.map((p) => `file '${p.file}'`)].join('\n') + '\n');
  const full = join(out, 'slate-demo.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', full]);

  // ---- chapters (YouTube-style list plus the sub-steps)
  const lines = [`Slate demo — ${fmtTime(t)} total`, ''];
  for (const c of chapters) lines.push(`${c.level ? '    ' : ''}${fmtTime(c.t)}  ${c.title}`);
  writeFileSync(join(out, 'chapters.txt'), lines.join('\n') + '\n');

  // ---- trailer: the first seconds of the title, each segment's highlights, the end card
  const tdir = join(work, 'trailer');
  rmSync(tdir, { recursive: true, force: true });
  mkdirSync(tdir, { recursive: true });
  const pieces = [];
  const cut = async (file, from, to, i) => {
    const f = join(tdir, `${String(i).padStart(3, '0')}.mp4`);
    const d = to - from;
    const fade = Math.min(0.25, d / 4);
    await ffmpeg(['-ss', from.toFixed(3), '-i', file, '-t', d.toFixed(3), '-vf', `fade=t=in:st=0:d=${fade}:color=0xfbfaf7,fade=t=out:st=${(d - fade).toFixed(3)}:d=${fade}:color=0xfbfaf7,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-an', f]);
    pieces.push(f);
  };
  let i = 0;
  for (const p of parts) {
    if (p.id === 'title') await cut(p.file, 0, Math.min(3.6, p.duration), i++);
    else if (p.id === 'end') await cut(p.file, 0, p.duration, i++);
    else
      for (const [a, b] of p.trailer) {
        // [mark name, seconds] or [from, to]
        const m = typeof a === 'string' ? p.marks.find((x) => x.name === a) : null;
        if (typeof a === 'string' && !m) continue;
        const from = m ? m.t + 0.2 : a;
        const to = m ? from + b : b;
        if (from < p.duration) await cut(p.file, from, Math.min(to, p.duration - 0.3), i++);
      }
  }
  const tlist = join(tdir, 'list.ffconcat');
  writeFileSync(tlist, ['ffconcat version 1.0', ...pieces.map((f) => `file '${f}'`)].join('\n') + '\n');
  const trailer = join(out, 'slate-trailer.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', tlist, '-c', 'copy', '-movflags', '+faststart', trailer]);

  // ---- poster: the paper beside the lecture, just after the clip's badge brought the figure back
  const posterPart = parts.find((p) => p.id === 'paper') ?? parts[1];
  const back = posterPart.marks.find((m) => m.name === 'Source badge back to the page');
  const posterAt = posterPart.start + (back ? posterPart.duration - 1.5 : posterPart.duration * 0.6);
  await ffmpeg(['-ss', posterAt.toFixed(2), '-i', full, '-frames:v', '1', join(out, 'poster.png')]);

  const size = (f) => `${(statSync(f).size / 1e6).toFixed(1)} MB`;
  console.log(`\n${full}  ${fmtTime(t)}  ${size(full)}`);
  console.log(`${trailer}  ${fmtTime(await duration(trailer))}  ${size(trailer)}`);
  console.log(`${join(out, 'chapters.txt')}\n${join(out, 'poster.png')}`);
  console.log(lines.join('\n'));
}
