import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const requiredFiles = [
  'index.html',
  'zh/index.html',
  'product-angle-generator/index.html',
  'image-to-3d-converter/index.html',
  'admin/index.html',
  'robots.txt',
  'sitemap.xml',
  'src/styles.css',
  'src/site.js',
  'server/app.mjs',
  'server/billing.mjs',
  'server/data-store.mjs',
  'server/load-env.mjs',
  'scripts/dev-server.mjs',
  'scripts/check-production-env.mjs',
  'scripts/verify-production.mjs',
  '.env.example',
  '.env.production.example',
  'DEPLOYMENT.md'
];
const syntaxFiles = [
  'scripts/dev-server.mjs',
  'scripts/check-production-env.mjs',
  'scripts/verify-production.mjs',
  'scripts/lint.mjs',
  'scripts/build.mjs',
  'server/app.mjs',
  'server/billing.mjs',
  'server/data-store.mjs',
  'server/load-env.mjs',
  'src/site.js',
  'admin/src/admin.js'
];

let hasError = false;

for (const pathname of requiredFiles) {
  const resolved = join(cwd, pathname);
  if (!existsSync(resolved)) {
    console.error(`Missing required file: ${pathname}`);
    hasError = true;
  }
}

const packageJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
for (const name of ['dev', 'check:prod', 'verify:prod', 'lint', 'test', 'build']) {
  if (!packageJson.scripts?.[name]) {
    console.error(`Missing package.json script: ${name}`);
    hasError = true;
  }
}

for (const pathname of syntaxFiles) {
  const resolved = join(cwd, pathname);
  const result = spawnSync(process.execPath, ['--check', resolved], {
    cwd,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log('lint-ok');
