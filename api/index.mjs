import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppServer } from '../server/app.mjs';
import { loadDotEnv } from '../server/load-env.mjs';

const functionDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(functionDir, '..');
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  loadDotEnv(join(appRoot, '.env'));
}

const app = createAppServer({
  root: appRoot,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  env: process.env
});

let initPromise;

async function ensureReady() {
  if (!initPromise) {
    initPromise = Promise.resolve(app.init());
  }
  return initPromise;
}

export default async function handler(req, res) {
  await ensureReady();
  return app.handle(req, res);
}
