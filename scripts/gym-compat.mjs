// G9: runs gym's checker (tests/gym/check.py) on a repository produced by the app's sync
// code. The repository is written by the Vitest test `src/core/sync/gymCompat.test.ts`
// into $SLATE_GYM_OUT; this script runs that test, then the checker.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
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

// G9: also every app commit of the test's history (written by the test next to the repository)
const commits = `${out}-commits`;
if (existsSync(commits)) {
  const dirs = readdirSync(commits).sort();
  for (const d of dirs) {
    const dir = join(commits, d);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    try {
      execFileSync('python3', [join(dir, 'scripts', 'check.py')], { stdio: 'pipe', cwd: dir });
    } catch (err) {
      console.error(`[gym-compat] check.py failed on app commit ${d}:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
      process.exit(1);
    }
  }
  console.log(`[gym-compat] gym's check.py passed on each of ${dirs.length} app commits`);
}
