import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createAppServer } from '../server/app.mjs';
import { loadDotEnv } from '../server/load-env.mjs';

function parseEnvFileArg(argv) {
  const index = argv.indexOf('--env-file');
  if (index === -1) {
    return '';
  }

  return argv[index + 1] || '';
}

const cwd = process.cwd();
const envFile = parseEnvFileArg(process.argv.slice(2));
const env = { ...process.env, NODE_ENV: 'production' };

if (envFile) {
  const resolved = join(cwd, envFile);
  if (!existsSync(resolved)) {
    console.error(`Env file not found: ${resolved}`);
    process.exit(1);
  }

  loadDotEnv(resolved, env, true);
}

try {
  createAppServer({
    root: cwd,
    env
  });
  console.log('production-env-ok');
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
