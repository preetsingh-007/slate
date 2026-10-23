/** Small helpers shared by the demo scripts. */
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const FFMPEG = process.env.FFMPEG ?? '/usr/bin/ffmpeg';

/** Runs a command, rejecting with its output when it fails. */
export function run(cmd, args, { cwd, env, quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      if (!quiet) process.stdout.write(d);
    });
    p.stderr.on('data', (d) => {
      out += d;
      if (!quiet) process.stderr.write(d);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}\n${out.slice(-3000)}`))));
  });
}

export const ffmpeg = (args) => run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

/** Duration of a media file in seconds. */
export async function duration(file) {
  const out = await run(FFMPEG, ['-hide_banner', '-i', file]).catch((e) => e.message);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Starts a long-running process and resolves once `ready` matches its output. */
export function serve(cmd, args, { cwd, env, ready, timeout = 60_000 }) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start:\n${out}`)), timeout);
    const on = (d) => {
      out += d;
      if (ready.test(out)) {
        clearTimeout(timer);
        resolve(p);
      }
    };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} exited with ${code}:\n${out}`));
    });
    // stops the whole process group (npx and the server it started)
    p.stop = () => {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        p.kill();
      }
    };
  });
}

export const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
