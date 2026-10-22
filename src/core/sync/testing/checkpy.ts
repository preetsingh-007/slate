/** G9 in Vitest: runs gym's checker (tests/gym/check.py) on a fake repository (not used by the app). */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { FakeRepo } from '../git/fakeGitHub';

/** check.py's output and whether it passed, on the repository's current files. */
export function runCheckPy(repo: FakeRepo): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'slate-check-'));
  try {
    for (const [p, bytes] of repo.files()) {
      const dest = join(dir, p);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
    }
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(resolve('tests/gym/check.py'), join(dir, 'scripts', 'check.py'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    try {
      return { ok: true, output: execFileSync('python3', ['scripts/check.py'], { cwd: dir, stdio: 'pipe' }).toString() };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
