import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createAppServer } from '../server/app.mjs';

function buildProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BASE_URL: 'https://www.imgcraftai.com',
    DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/imgcraftai',
    DATABASE_FALLBACK_ON_ERROR: 'false',
    ADMIN_EMAILS: 'ops@imgcraftai.com',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    BILLING_PROVIDER: 'paypal',
    PAYPAL_MODE: 'live',
    PAYPAL_CLIENT_ID: 'paypal-client-id',
    PAYPAL_CLIENT_SECRET: 'paypal-client-secret',
    PAYPAL_PLAN_ID: 'P-1234567890',
    PAYPAL_WEBHOOK_ID: 'WH-1234567890',
    PAYPAL_PORTAL_URL: 'https://www.paypal.com/myaccount/autopay/',
    SEEDREAM_API_URL: 'https://ark.cn-beijing.volces.com/api/v3',
    SEEDREAM_API_KEY: 'seedream-key',
    ...overrides
  };
}

async function createFixtureRoot() {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(join(tmpdir(), 'imgcraftai-smoke-'));
  const entries = [
    ['index.html', 'file'],
    ['zh', 'dir'],
    ['product-angle-generator', 'dir'],
    ['image-to-3d-converter', 'dir'],
    ['admin', 'dir'],
    ['src', 'dir'],
    ['assets', 'dir'],
    ['robots.txt', 'file'],
    ['sitemap.xml', 'file']
  ];

  try {
    for (const [name, type] of entries) {
      await symlink(join(repoRoot, name), join(tempRoot, name), type);
    }
    return tempRoot;
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('serves the main pages and static assets', async () => {
  const fixtureRoot = await createFixtureRoot();
  const app = createAppServer({
    root: fixtureRoot,
    host: '127.0.0.1',
    port: 0,
    env: {
      NODE_ENV: 'test',
      BASE_URL: 'http://127.0.0.1:0'
    }
  });

  try {
    await app.listen();
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string', 'server address is available');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const [home, zhPage, productAnglePage, imageTo3dPage, adminPage, me, asset, robots, sitemap] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/zh/index.html`),
      fetch(`${baseUrl}/product-angle-generator/`),
      fetch(`${baseUrl}/image-to-3d-converter/`),
      fetch(`${baseUrl}/admin/index.html`),
      fetch(`${baseUrl}/api/me`),
      fetch(`${baseUrl}/assets/favicon_imgcraftai.svg`),
      fetch(`${baseUrl}/robots.txt`),
      fetch(`${baseUrl}/sitemap.xml`)
    ]);

    assert.equal(home.status, 200);
    assert.equal(zhPage.status, 200);
    assert.equal(productAnglePage.status, 200);
    assert.equal(imageTo3dPage.status, 200);
    assert.equal(adminPage.status, 200);
    assert.equal(me.status, 200);
    assert.equal(asset.status, 200);
    assert.equal(robots.status, 200);
    assert.equal(sitemap.status, 200);

    const homeHtml = await home.text();
    assert.match(homeHtml, /AI Product Angle Generator/);

    const robotsText = await robots.text();
    assert.match(robotsText, /Sitemap: https:\/\/www\.imgcraftai\.com\/sitemap\.xml/);

    const sitemapText = await sitemap.text();
    assert.match(sitemapText, /https:\/\/www\.imgcraftai\.com\/product-angle-generator\//);

    const meJson = await me.json();
    assert.equal(meJson.authenticated, false);
  } finally {
    await closeServer(app.server);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('production redirects bare domain requests to canonical www origin', async () => {
  const app = createAppServer({
    root: process.cwd(),
    env: buildProductionEnv()
  });

  const req = {
    method: 'GET',
    url: '/api/auth/google/start?source=smoke',
    headers: {
      host: 'imgcraftai.com',
      'x-forwarded-host': 'imgcraftai.com'
    }
  };
  let statusCode = 0;
  let headers = {};
  const res = {
    writeHead(status, nextHeaders) {
      statusCode = status;
      headers = nextHeaders;
    },
    end() {}
  };

  await app.handle(req, res);

  assert.equal(statusCode, 301);
  assert.equal(headers.Location, 'https://www.imgcraftai.com/api/auth/google/start?source=smoke');
});

test('production redirects canonical path aliases to their preferred URL', async () => {
  const app = createAppServer({
    root: process.cwd(),
    env: buildProductionEnv()
  });

  const req = {
    method: 'GET',
    url: '/zh/?source=smoke',
    headers: {
      host: 'www.imgcraftai.com',
      'x-forwarded-host': 'www.imgcraftai.com'
    }
  };
  let statusCode = 0;
  let headers = {};
  const res = {
    writeHead(status, nextHeaders) {
      statusCode = status;
      headers = nextHeaders;
    },
    end() {}
  };

  await app.handle(req, res);

  assert.equal(statusCode, 301);
  assert.equal(headers.Location, 'https://www.imgcraftai.com/zh/index.html?source=smoke');
});
