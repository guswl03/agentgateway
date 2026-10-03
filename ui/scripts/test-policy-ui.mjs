import { spawn, spawnSync } from 'node:child_process';

// Own the direct Vite process; a nested package-manager shell can hang on Windows teardown.
const cwd = '.';
let server;
try {
  for (const args of [
    ['scripts/generate-schema.mjs'],
    ['node_modules/typescript/bin/tsc', '-b'],
    ['node_modules/vite/bin/vite.js', 'build', '--mode', 'e2e'],
  ]) {
    const build = spawnSync(process.execPath, args, {cwd, encoding: 'utf8', timeout: 90000});
    process.stdout.write(build.stdout ?? ''); process.stderr.write(build.stderr ?? '');
    if (build.status !== 0) throw new Error(`Readiness UI build failed: ${args[0]}`);
  }
  let live = false;
  try { live = (await fetch('http://127.0.0.1:19100/')).ok; } catch { /* start a local preview */ }
  if (!live) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--mode', 'e2e', '--host', '127.0.0.1'], {cwd, stdio: 'ignore'});
    for (let attempt = 0; attempt < 50 && !live; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try { live = (await fetch('http://127.0.0.1:19100/')).ok; } catch { /* wait for startup */ }
    }
    if (!live) throw new Error('Local readiness preview did not start');
  }
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/policy-readiness.spec.ts', 'tests/e2e/policy-import.spec.ts', '--workers=1'], {
    cwd, encoding: 'utf8', env: {...process.env, PLAYWRIGHT_EXTERNAL_SERVER: '1'}, timeout: 170000,
  });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.status !== 0) process.exitCode = run.status ?? 1;
  else {
    const count = /\b(\d+) passed\b/.exec(run.stdout);
    if (!count || Number(count[1]) === 0) throw new Error('No readiness browser tests executed');
    console.log(`HARNESS_TEST_COUNT=${count[1]}`);
  }
} finally {
  server?.kill();
}
