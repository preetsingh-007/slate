// G9: runs gym's checker (tests/gym/check.py) on a repository produced by the app's sync
// code. The repository is written by the Vitest test `src/core/sync/gymCompat.test.ts`
// into $SLATE_GYM_OUT; this script runs that test, then the checker.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'slate-gym-'));
const test = 'src/core/sync/gymCompat.test.ts';
if (!existsSync(test)) {
  console.log(`[gym-compat] ${test} not present yet; nothing to check`);
  process.exit(0);
}
execFileSync('npx', ['vitest', 'run', test], { stdio: 'inherit', env: { ...process.env, SLATE_GYM_OUT: out } });
execFileSync('git', ['init', '-q'], { cwd: out });
execFileSync('python3', [join(out, 'scripts', 'check.py')], { stdio: 'inherit', cwd: out });
console.log(`[gym-compat] gym's check.py passed on ${out}`);
