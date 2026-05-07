import assert from 'node:assert/strict';
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

test('production rejects database fallback in production', () => {
  assert.throws(
    () =>
      createAppServer({
        root: process.cwd(),
        env: buildProductionEnv({ DATABASE_FALLBACK_ON_ERROR: 'true' })
      }),
    /DATABASE_FALLBACK_ON_ERROR must be false in production/
  );
});

test('production requires PayPal live mode', () => {
  assert.throws(
    () =>
      createAppServer({
        root: process.cwd(),
        env: buildProductionEnv({ PAYPAL_MODE: 'sandbox' })
      }),
    /PAYPAL_MODE must be live in production/
  );
});

test('production rejects sandbox PayPal api base urls', () => {
  assert.throws(
    () =>
      createAppServer({
        root: process.cwd(),
        env: buildProductionEnv({ PAYPAL_API_BASE_URL: 'https://api-m.sandbox.paypal.com' })
      }),
    /PAYPAL_API_BASE_URL must not point to sandbox in production/
  );
});

test('production rejects sandbox PayPal portal urls', () => {
  assert.throws(
    () =>
      createAppServer({
        root: process.cwd(),
        env: buildProductionEnv({ PAYPAL_PORTAL_URL: 'https://www.sandbox.paypal.com/myaccount/autopay/' })
      }),
    /PAYPAL_PORTAL_URL must not point to sandbox in production/
  );
});

test('production config passes with the required live settings', () => {
  assert.doesNotThrow(() =>
    createAppServer({
      root: process.cwd(),
      env: buildProductionEnv()
    })
  );
});
