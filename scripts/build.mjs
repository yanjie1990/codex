import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cwd = process.cwd();
const steps = [
  [process.execPath, [join(cwd, 'scripts/lint.mjs')]],
  ['npm', ['test']],
  [process.execPath, [join(cwd, 'scripts/check-production-env.mjs'), '--env-file', '.env.production.example']]
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('build-ok');
