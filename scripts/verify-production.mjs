import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createAppServer } from '../server/app.mjs';
import { loadDotEnv } from '../server/load-env.mjs';
import { resolvePayPalApiBaseUrl } from '../server/paypal.mjs';

const REQUIRED_KEYS = [
  'BASE_URL',
  'DATABASE_URL',
  'ADMIN_EMAILS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'BILLING_PROVIDER',
  'PAYPAL_MODE',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_PLAN_ID',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_PORTAL_URL',
  'SEEDREAM_API_URL',
  'SEEDREAM_API_KEY'
];

const PLACEHOLDER_PATTERNS = [
  /^\.\.\.$/,
  /xxx/i,
  /xxxxxxxx/i,
  /google_client/i,
  /paypal_live_client/i,
  /paypal-client/i,
  /seedream_key/i,
  /USER:PASSWORD@HOST/,
  /^P-X+$/i,
  /^WH-X+$/i
];

function parseArgs(argv) {
  const args = {
    envFile: '',
    baseUrl: '',
    skipNetwork: false,
    timeoutMs: 10000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      args.envFile = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs);
      index += 1;
      continue;
    }
    if (arg === '--skip-network') {
      args.skipNetwork = true;
    }
  }

  return args;
}

function isPlaceholder(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assertNoPlaceholders(env) {
  const invalid = REQUIRED_KEYS.filter((key) => isPlaceholder(env[key]));
  if (invalid.length) {
    throw new Error(`Production env still has missing or placeholder values: ${invalid.join(', ')}`);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: options.redirect || 'manual'
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPublicEndpoint(baseUrl, pathname, timeoutMs) {
  const url = new URL(pathname, baseUrl);
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`${url.toString()} returned ${response.status}`);
  }
}

async function assertGoogleOAuthStart(baseUrl, env, timeoutMs) {
  const response = await fetchWithTimeout(new URL('/api/auth/google/start', baseUrl), {}, timeoutMs);
  if (response.status !== 302) {
    throw new Error(`/api/auth/google/start returned ${response.status}, expected 302`);
  }

  const location = response.headers.get('location') || '';
  if (!location.startsWith('https://accounts.google.com/')) {
    throw new Error('/api/auth/google/start did not redirect to Google');
  }

  const authUrl = new URL(location);
  if (authUrl.searchParams.get('client_id') !== env.GOOGLE_CLIENT_ID) {
    throw new Error('/api/auth/google/start used a different GOOGLE_CLIENT_ID');
  }
}

async function getPayPalAccessToken(env, timeoutMs) {
  const response = await fetchWithTimeout(
    `${resolvePayPalApiBaseUrl(env)}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials',
      redirect: 'follow'
    },
    timeoutMs
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `PayPal token request returned ${response.status}`);
  }

  return payload.access_token;
}

async function assertPayPalPlan(env, timeoutMs) {
  if (String(env.PAYPAL_MODE || '').trim().toLowerCase() !== 'live') {
    throw new Error('PAYPAL_MODE must be live for production verification');
  }

  const apiBase = resolvePayPalApiBaseUrl(env);
  if (/sandbox\.paypal\.com/i.test(apiBase)) {
    throw new Error('PayPal verification would hit sandbox, not live');
  }

  const accessToken = await getPayPalAccessToken(env, timeoutMs);
  const response = await fetchWithTimeout(
    `${apiBase}/v1/billing/plans/${encodeURIComponent(env.PAYPAL_PLAN_ID)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      redirect: 'follow'
    },
    timeoutMs
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || `PayPal plan request returned ${response.status}`);
  }
}

async function run() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, NODE_ENV: 'production' };

  if (!args.envFile) {
    throw new Error('Usage: npm run verify:prod -- --env-file .env.production.local');
  }

  const envPath = join(cwd, args.envFile);
  if (!existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`);
  }

  loadDotEnv(envPath, env, true);
  if (args.baseUrl) {
    env.BASE_URL = args.baseUrl;
  }

  assertNoPlaceholders(env);

  const app = createAppServer({
    root: cwd,
    env
  });

  try {
    await app.init();
    console.log('database-and-config-ok');
  } finally {
    await app.close();
  }

  if (args.skipNetwork) {
    console.log('network-checks-skipped');
    return;
  }

  const baseUrl = env.BASE_URL;
  await Promise.all([
    assertPublicEndpoint(baseUrl, '/', args.timeoutMs),
    assertPublicEndpoint(baseUrl, '/zh/index.html', args.timeoutMs),
    assertPublicEndpoint(baseUrl, '/admin/index.html', args.timeoutMs),
    assertPublicEndpoint(baseUrl, '/api/me', args.timeoutMs),
    assertPublicEndpoint(baseUrl, '/assets/favicon_imgcraftai.svg', args.timeoutMs)
  ]);
  console.log('public-endpoints-ok');

  await assertGoogleOAuthStart(baseUrl, env, args.timeoutMs);
  console.log('google-oauth-start-ok');

  await assertPayPalPlan(env, args.timeoutMs);
  console.log('paypal-live-plan-ok');

  console.log('production-verification-ok');
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
