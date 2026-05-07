import { join } from 'node:path';

import { createAppServer } from '../server/app.mjs';
import { loadDotEnv } from '../server/load-env.mjs';

const cwd = process.cwd();
loadDotEnv(join(cwd, '.env'));
const appRoot = cwd;
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';

const app = createAppServer({
  root: appRoot,
  host,
  port,
  env: process.env
});

await app.listen();
