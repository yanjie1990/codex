import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import https from 'node:https';
import { extname, join, normalize } from 'node:path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import { createDataStore, resolveDefaultDbPath } from './data-store.mjs';
import {
  normalizeBillingWebhookPayload,
  resolveBillingProvider,
  resolveCheckoutUrl,
  resolvePortalUrl,
  verifyBillingWebhookSignature
} from './billing.mjs';
import {
  createPayPalSubscription,
  normalizePayPalWebhookPayload,
  verifyPayPalWebhookSignature
} from './paypal.mjs';
import {
  createCheckoutSession as createStripeCheckoutSession,
  createBillingPortalSession as createStripeBillingPortalSession,
  getSubscription as getStripeSubscription,
  verifyStripeWebhookSignature
} from './stripe.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8'
};

const SESSION_COOKIE = 'imgcraft_session';
const OAUTH_COOKIE = 'imgcraft_oauth_state';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DEFAULT_SEEDREAM_MODEL_ID = 'doubao-seedream-4-0-250828';
const FREE_GENERATION_LIMIT = 3;
const GOOGLE_REQUEST_TIMEOUT_MS = 10000;

function resolveProxyFromEnv(env) {
  return (
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    ''
  ).trim();
}

function configureGlobalFetchProxy(env) {
  const proxyUrl = resolveProxyFromEnv(env);
  if (!proxyUrl) {
    return;
  }

  try {
    const { hostname } = new URL(proxyUrl);
    if (
      env.NODE_ENV === 'production' &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
    ) {
      console.warn(`[proxy] Ignoring local proxy in production: ${proxyUrl}`);
      return;
    }

    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log(`[proxy] Global fetch proxy enabled: ${proxyUrl}`);
  } catch (error) {
    console.error(`[proxy] Failed to configure proxy "${proxyUrl}":`, error?.message || error);
  }
}

function parseAdminEmails(env) {
  return new Set(
    String(env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function assertProductionConfig(env) {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (String(env.DATABASE_FALLBACK_ON_ERROR || '').trim() === 'true') {
    throw new Error('DATABASE_FALLBACK_ON_ERROR must be false in production');
  }

  const required = [
    ['BASE_URL', env.BASE_URL],
    ['DATABASE_URL', env.DATABASE_URL],
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['SEEDREAM_API_URL', env.SEEDREAM_API_URL],
    ['SEEDREAM_API_KEY', env.SEEDREAM_API_KEY],
    ['ADMIN_EMAILS', env.ADMIN_EMAILS]
  ]
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name);

  if (required.length) {
    throw new Error(`Missing required production env vars: ${required.join(', ')}`);
  }

  try {
    const baseUrl = new URL(env.BASE_URL);
    if (baseUrl.protocol !== 'https:') {
      throw new Error('BASE_URL must use https in production');
    }
  } catch {
    throw new Error('BASE_URL must be a valid https URL in production');
  }

  const provider = resolveBillingProvider(env);
  if (provider === 'stripe') {
    const stripeRequired = [
      ['STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY],
      ['STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET],
      ['STRIPE_PRICE_ID', env.STRIPE_PRICE_ID]
    ]
      .filter(([, value]) => !String(value || '').trim())
      .map(([name]) => name);

    if (stripeRequired.length) {
      throw new Error(`Missing required Stripe env vars: ${stripeRequired.join(', ')}`);
    }
  }

  if (provider === 'paypal') {
    const paypalMode = String(env.PAYPAL_MODE || '').trim().toLowerCase();
    if (paypalMode !== 'live') {
      throw new Error('PAYPAL_MODE must be live in production');
    }

    const paypalApiBase = String(env.PAYPAL_API_BASE_URL || '').trim();
    if (paypalApiBase && /sandbox\.paypal\.com/i.test(paypalApiBase)) {
      throw new Error('PAYPAL_API_BASE_URL must not point to sandbox in production');
    }

    const paypalPortalUrl = String(env.PAYPAL_PORTAL_URL || '').trim();
    if (paypalPortalUrl && /sandbox\.paypal\.com/i.test(paypalPortalUrl)) {
      throw new Error('PAYPAL_PORTAL_URL must not point to sandbox in production');
    }

    const payPalRequired = [
      ['PAYPAL_CLIENT_ID', env.PAYPAL_CLIENT_ID],
      ['PAYPAL_CLIENT_SECRET', env.PAYPAL_CLIENT_SECRET],
      ['PAYPAL_PLAN_ID', env.PAYPAL_PLAN_ID],
      ['PAYPAL_WEBHOOK_ID', env.PAYPAL_WEBHOOK_ID],
      ['PAYPAL_PORTAL_URL', env.PAYPAL_PORTAL_URL]
    ]
      .filter(([, value]) => !String(value || '').trim())
      .map(([name]) => name);

    if (payPalRequired.length) {
      throw new Error(`Missing required PayPal env vars: ${payPalRequired.join(', ')}`);
    }
  }

  if (provider === 'hosted' || provider === 'paddle' || provider === 'lemonsqueezy') {
    const checkoutUrl =
      env.BILLING_CHECKOUT_URL ||
      env.PADDLE_CHECKOUT_URL ||
      env.LEMONSQUEEZY_CHECKOUT_URL;
    const portalUrl =
      env.BILLING_PORTAL_URL ||
      env.PADDLE_PORTAL_URL ||
      env.LEMONSQUEEZY_PORTAL_URL;
    const webhookSecret =
      env.BILLING_WEBHOOK_SECRET ||
      env.PADDLE_WEBHOOK_SECRET ||
      env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const hostedRequired = [
      ['BILLING_CHECKOUT_URL, PADDLE_CHECKOUT_URL, or LEMONSQUEEZY_CHECKOUT_URL', checkoutUrl],
      ['BILLING_PORTAL_URL, PADDLE_PORTAL_URL, or LEMONSQUEEZY_PORTAL_URL', portalUrl],
      ['BILLING_WEBHOOK_SECRET, PADDLE_WEBHOOK_SECRET, or LEMONSQUEEZY_WEBHOOK_SECRET', webhookSecret]
    ]
      .filter(([, value]) => !String(value || '').trim())
      .map(([name]) => name);

    if (hostedRequired.length) {
      throw new Error(`Missing required hosted billing env vars: ${hostedRequired.join(', ')}`);
    }
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(buffer) {
  if (!buffer.length) {
    return {};
  }
  return JSON.parse(buffer.toString('utf8'));
}

const staticRouteAliases = new Map([
  ['/', '/index.html'],
  ['/index.html', '/index.html'],
  ['/zh', '/zh/index.html'],
  ['/zh/', '/zh/index.html'],
  ['/zh/index.html', '/zh/index.html']
]);

const canonicalRouteRedirects = new Map([
  ['/index.html', '/'],
  ['/zh', '/zh/index.html'],
  ['/zh/', '/zh/index.html']
]);

function resolveStaticPath(root, urlPath) {
  const pathname = staticRouteAliases.get(urlPath) || urlPath;
  const normalizedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const normalized = normalize(normalizedPath).replace(/^\.+/, '');
  return join(root, normalized);
}

function getStaticCacheControl(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.html' || extension === '.xml' || extension === '.txt') {
    return 'public, max-age=0, must-revalidate';
  }

  if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg'].includes(extension)) {
    return 'public, max-age=2592000, stale-while-revalidate=31536000';
  }

  if (['.css', '.js', '.mjs', '.json'].includes(extension)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }

  return 'public, max-age=3600, must-revalidate';
}

function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateApiKey() {
  return `img_live_${crypto.randomBytes(24).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) {
      continue;
    }
    cookies[rawKey] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function buildCookie(name, value, { maxAge, secure = false, httpOnly = true, domain = '' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (domain) {
    parts.push(`Domain=${domain}`);
  }
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (secure) {
    parts.push('Secure');
  }
  if (typeof maxAge === 'number') {
    parts.push(`Max-Age=${maxAge}`);
  }
  return parts.join('; ');
}

function setCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', [current, cookie]);
}

function getOrigin(req, env) {
  if (env.NODE_ENV !== 'production') {
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost || req.headers.host;
    if (host) {
      return `${req.headers['x-forwarded-proto'] || 'http'}://${host}`;
    }
  }

  return env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
}

function resolveCookieDomain(env) {
  if (env.NODE_ENV !== 'production' || !env.BASE_URL) {
    return '';
  }

  try {
    const hostname = new URL(env.BASE_URL).hostname;
    if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.endsWith('.vercel.app')) {
      return '';
    }

    const labels = hostname.split('.');
    if (labels.length < 2) {
      return '';
    }

    return `.${labels.slice(-2).join('.')}`;
  } catch {
    return '';
  }
}

function getCanonicalRedirectLocation(req, url, env) {
  if (env.NODE_ENV !== 'production' || !env.BASE_URL || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return '';
  }

  try {
    const canonical = new URL(env.BASE_URL);
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    const normalizedHost = canonical.host.toLowerCase();
    const canonicalPathname = canonicalRouteRedirects.get(url.pathname) || url.pathname;
    const needsHostRedirect = Boolean(requestHost) && requestHost !== normalizedHost;
    const needsPathRedirect = canonicalPathname !== url.pathname;
    if (!needsHostRedirect && !needsPathRedirect) {
      return '';
    }

    canonical.pathname = canonicalPathname;
    canonical.search = url.search;
    return canonical.toString();
  } catch {
    return '';
  }
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function resolveCheckoutPriceId(env, provider, bodyPriceId = '') {
  const normalizedProvider = String(provider || '').trim().toLowerCase();

  if (normalizedProvider === 'stripe') {
    return pickFirstNonEmpty(bodyPriceId, env.STRIPE_PRICE_ID);
  }

  if (normalizedProvider === 'paypal') {
    return pickFirstNonEmpty(bodyPriceId, env.PAYPAL_PLAN_ID);
  }

  if (normalizedProvider === 'lemonsqueezy') {
    return pickFirstNonEmpty(bodyPriceId, env.LEMONSQUEEZY_PRICE_ID, env.BILLING_PRICE_ID);
  }

  if (normalizedProvider === 'paddle') {
    return pickFirstNonEmpty(bodyPriceId, env.PADDLE_PRICE_ID, env.BILLING_PRICE_ID);
  }

  return pickFirstNonEmpty(bodyPriceId, env.BILLING_PRICE_ID);
}

function resolveSeedreamEndpoint(url) {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/images/generations') ? trimmed : `${trimmed}/images/generations`;
}

function buildSeedreamPayload(body, env) {
  return {
    model: env.SEEDREAM_MODEL_ID || DEFAULT_SEEDREAM_MODEL_ID,
    prompt: body.prompt,
    image: body.image,
    response_format: body.responseFormat || 'url',
    size: body.size || '2k',
    seed: body.seed,
    guidance_scale: body.guidanceScale,
    watermark: body.watermark ?? true
  };
}

function isActiveSubscription(subscription) {
  return (
    Boolean(subscription) &&
    subscription.status === 'active' &&
    (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd).getTime() > Date.now())
  );
}

function findBillingUserByEmail(store, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return Promise.resolve(null);
  }

  return store.listUsers(normalizedEmail).then((users) =>
    users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null
  );
}

function describeError(error) {
  return error?.cause?.message || error?.message || String(error);
}

function readGoogleJson(raw) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function requestGoogleJsonViaHttps(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : String(body);
    const requestUrl = new URL(url);
    const request = https.request(
      requestUrl,
      {
        method,
        headers: {
          ...headers,
          ...(payload == null ? {} : { 'Content-Length': Buffer.byteLength(payload) })
        },
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            payload: readGoogleJson(raw)
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Google request timed out after ${GOOGLE_REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);

    if (payload != null) {
      request.write(payload);
    }
    request.end();
  });
}

async function requestGoogleJson(url, { method = 'GET', headers = {}, body = null, label }) {
  try {
    const response = await fetch(url, { method, headers, body });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    console.error(`[google] ${label} fetch failed; retrying with node:https: ${describeError(error)}`);
  }

  try {
    return await requestGoogleJsonViaHttps(url, { method, headers, body });
  } catch (error) {
    console.error(`[google] ${label} node:https fallback failed: ${describeError(error)}`);
    error.googleNetworkError = true;
    throw error;
  }
}

async function exchangeGoogleCode({ code, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  try {
    const result = await requestGoogleJson(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      label: 'token exchange'
    });

    if (!result.ok) {
      throw new Error(result.payload.error_description || result.payload.error || 'Google token exchange failed');
    }
    return result.payload;
  } catch (error) {
    if (!error.googleNetworkError) {
      throw error;
    }
    throw new Error(
      `Google token exchange failed: unable to reach ${GOOGLE_TOKEN_URL}. Check server network/DNS/proxy.`
    );
  }
}

async function fetchGoogleProfile(accessToken) {
  try {
    const result = await requestGoogleJson(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      label: 'profile fetch'
    });

    if (!result.ok) {
      throw new Error(result.payload.error_description || result.payload.error || 'Failed to fetch Google profile');
    }
    return result.payload;
  } catch (error) {
    if (!error.googleNetworkError) {
      throw error;
    }
    throw new Error(
      `Failed to fetch Google profile: unable to reach ${GOOGLE_USERINFO_URL}. Check server network/DNS/proxy.`
    );
  }
}

async function verifyGoogleCredential(idToken, expectedAud) {
  try {
    const result = await requestGoogleJson(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
      label: 'credential verification'
    });

    if (!result.ok) {
      throw new Error(result.payload.error_description || result.payload.error || 'Google credential verification failed');
    }

    return validateGoogleCredentialPayload(result.payload, expectedAud);
  } catch (error) {
    if (!error.googleNetworkError) {
      throw error;
    }
    throw new Error(
      `Google credential verification failed: unable to reach ${GOOGLE_TOKENINFO_URL}. Check server network/DNS/proxy.`
    );
  }
}

function validateGoogleCredentialPayload(payload, expectedAud) {
  if (payload.aud !== expectedAud) {
    throw new Error('Invalid Google audience');
  }

  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('Invalid Google issuer');
  }

  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
    throw new Error('Google credential expired');
  }

  if (payload.email_verified !== 'true') {
    throw new Error('Google email is not verified');
  }

  return payload;
}

export function createAppServer({
  root,
  host = '127.0.0.1',
  port = 5173,
  env = process.env
} = {}) {
  configureGlobalFetchProxy(env);
  assertProductionConfig(env);
  const appRoot = root;
  const store = createDataStore({
    filePath: resolveDefaultDbPath(appRoot),
    databaseUrl: env.DATABASE_URL,
    fallbackOnError: String(env.DATABASE_FALLBACK_ON_ERROR || '').trim() === 'true'
  });
  const isSecureCookie = env.NODE_ENV === 'production' || (env.BASE_URL || '').startsWith('https://');
  const cookieDomain = resolveCookieDomain(env);
  const adminEmails = parseAdminEmails(env);
  const allowLocalAdminFallback = env.NODE_ENV !== 'production' && adminEmails.size === 0 && !isSecureCookie;

  async function getSessionUser(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies[SESSION_COOKIE];
    if (!sessionId) {
      return null;
    }

    const result = await store.getSessionWithUser(sessionId);
    if (!result) {
      return null;
    }
    const subscription = await store.getSubscription(result.user.id);
    return { sessionId, session: result.session, user: result.user, subscription };
  }

  async function requireSessionUser(req) {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      const error = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    return sessionUser;
  }

  function isAdminUser(user) {
    if (!user?.email) {
      return false;
    }

    if (allowLocalAdminFallback) {
      return true;
    }

    return adminEmails.has(String(user.email).toLowerCase());
  }

  async function requireAdminSession(req) {
    const sessionUser = await requireSessionUser(req);
    if (!isAdminUser(sessionUser.user)) {
      const error = new Error('Admin access required');
      error.status = 403;
      throw error;
    }
    return sessionUser;
  }

  async function createSession(res, userId) {
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30;
    await store.createSession({
      id: sessionId,
      userId,
      createdAt: nowIso(),
      expiresAt
    });
    setCookie(
      res,
      buildCookie(SESSION_COOKIE, sessionId, {
        maxAge: 60 * 60 * 24 * 30,
        secure: isSecureCookie,
        domain: cookieDomain
      })
    );
  }

  async function clearSession(req, res) {
    const cookies = parseCookies(req);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      await store.deleteSession(sessionId);
    }
    setCookie(
      res,
      buildCookie(SESSION_COOKIE, '', {
        maxAge: 0,
        secure: isSecureCookie,
        domain: cookieDomain
      })
    );
  }

  async function requireActiveSubscription(userId) {
    const subscription = await store.getSubscription(userId);

    if (!isActiveSubscription(subscription)) {
      const error = new Error('Active subscription required');
      error.status = 403;
      throw error;
    }

    return { subscription };
  }

  async function recordUsage({ userId, action, apiKeyId = null, meta = {} }) {
    await store.recordUsage({
      id: crypto.randomUUID(),
      userId,
      apiKeyId,
      action,
      meta,
      createdAt: nowIso()
    });
  }

  async function getGenerationStats(userId) {
    const generationEvents = await store.listUsageEvents(userId, 'generate_angle');
    const totalGenerations = generationEvents.length;
    const freeUsesLeft = Math.max(0, FREE_GENERATION_LIMIT - totalGenerations);
    return {
      totalGenerations,
      freeLimit: FREE_GENERATION_LIMIT,
      freeUsesLeft
    };
  }

  async function syncBillingSubscription({
    userId,
    customerId = null,
    subscriptionId = null,
    status = null,
    plan = null,
    currentPeriodEnd = null,
    email = null,
    name = null,
    avatarUrl = null,
    provider = null,
    providerUserId = null
  }) {
    if (!userId) {
      throw new Error('userId is required to sync billing subscription');
    }

    const existingUser = await store.getUserById(userId);
    if (!existingUser && !email) {
      throw new Error(`User not found: ${userId}`);
    }

    await store.upsertSubscription({
      userId,
      stripeCustomerId: customerId || existingUser?.stripeCustomerId || null,
      stripeSubscriptionId: subscriptionId || null,
      status: status || null,
      plan: plan || null,
      currentPeriodEnd: currentPeriodEnd || null,
      updatedAt: nowIso()
    });

    await store.upsertUser({
      id: userId,
      email: email || existingUser?.email || null,
      name: name || existingUser?.name || email || null,
      avatarUrl: avatarUrl || existingUser?.avatarUrl || null,
      provider: provider || existingUser?.provider || null,
      providerUserId: providerUserId || existingUser?.providerUserId || null,
      stripeCustomerId: customerId || existingUser?.stripeCustomerId || null,
      isWhitelisted: existingUser?.isWhitelisted ?? false,
      createdAt: existingUser?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
  }

  async function resolveUserForBillingEvent(event) {
    if (event.userId) {
      return await store.getUserById(event.userId);
    }

    if (event.customerEmail) {
      return await findBillingUserByEmail(store, event.customerEmail);
    }

    return null;
  }

  async function syncBillingEvent(event) {
    const user = await resolveUserForBillingEvent(event);
    if (!user) {
      throw new Error('Unable to resolve billing event user');
    }

    await syncBillingSubscription({
      userId: user.id,
      customerId: event.customerId || user.stripeCustomerId || null,
      subscriptionId: event.subscriptionId || null,
      status: event.status || null,
      plan: event.plan || null,
      currentPeriodEnd: event.currentPeriodEnd || null,
      email: user.email || event.customerEmail || null,
      name: user.name || null,
      avatarUrl: user.avatarUrl || null,
      provider: user.provider || null,
      providerUserId: user.providerUserId || null
    });
  }

  async function getAdminUserRows(query = '') {
    const users = await store.listUsers(query);
    return Promise.all(
      users.map(async (user) => {
        const subscription = await store.getSubscription(user.id);
        const usage = await getGenerationStats(user.id);
        const generationEvents = await store.listUsageEvents(user.id, 'generate_angle');
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          provider: user.provider,
          providerUserId: user.providerUserId,
          isWhitelisted: Boolean(user.isWhitelisted),
          subscriptionActive: isActiveSubscription(subscription),
          totalGenerations: usage.totalGenerations,
          freeUsesLeft: usage.freeUsesLeft,
          lastGeneratedAt: generationEvents.at(-1)?.createdAt || null,
          updatedAt: user.updatedAt
        };
      })
    );
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return json(res, 200, {
          authenticated: false,
          user: null,
          subscription: null,
          isWhitelisted: false,
          usage: {
            freeLimit: FREE_GENERATION_LIMIT,
            totalGenerations: 0,
            freeUsesLeft: FREE_GENERATION_LIMIT
          }
        });
      }

      const subscription = sessionUser.subscription || null;
      const active = isActiveSubscription(subscription);
      const usage = await getGenerationStats(sessionUser.user.id);

      return json(res, 200, {
        authenticated: true,
        user: {
          id: sessionUser.user.id,
          email: sessionUser.user.email,
          name: sessionUser.user.name,
          avatarUrl: sessionUser.user.avatarUrl,
          provider: sessionUser.user.provider,
          isWhitelisted: Boolean(sessionUser.user.isWhitelisted),
          isAdmin: isAdminUser(sessionUser.user)
        },
        subscription: {
          active,
          plan: subscription?.plan || null,
          expiresAt: subscription?.currentPeriodEnd || null
        },
        usage
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/me') {
      try {
        const sessionUser = await requireAdminSession(req);
        return json(res, 200, {
          authenticated: true,
          isAdmin: true,
          user: {
            id: sessionUser.user.id,
            email: sessionUser.user.email,
            name: sessionUser.user.name,
            avatarUrl: sessionUser.user.avatarUrl
          }
        });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/google/start') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return json(res, 500, { error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required' });
      }

      const state = crypto.randomUUID();
      const origin = getOrigin(req, env);
      const redirectUri = `${origin}/api/auth/google/callback`;

      await store.storeOauthState(state, Date.now());

      setCookie(
        res,
        buildCookie(OAUTH_COOKIE, state, {
          maxAge: 60 * 10,
          secure: isSecureCookie,
          domain: cookieDomain
        })
      );

      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      res.writeHead(302, { Location: authUrl.toString() });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/google/credential') {
      if (!env.GOOGLE_CLIENT_ID) {
        return json(res, 500, { error: 'GOOGLE_CLIENT_ID is required' });
      }

      const body = parseJsonBody(await readBody(req));
      if (!body.credential) {
        return json(res, 400, { error: 'credential is required' });
      }

      try {
        const profile = await verifyGoogleCredential(body.credential, env.GOOGLE_CLIENT_ID);

        const existing = await store.findUserByGoogleSubject(profile.sub);
        const userId = existing?.id || crypto.randomUUID();
        await store.upsertUser({
          id: userId,
          email: profile.email,
          name: profile.name || profile.email,
          avatarUrl: profile.picture || null,
          provider: 'google',
          providerUserId: profile.sub,
          updatedAt: nowIso(),
          createdAt: existing?.createdAt || nowIso(),
          stripeCustomerId: existing?.stripeCustomerId || null
        });

        await createSession(res, userId);
        const user = await store.getUserById(userId);
        const subscription = await store.getSubscription(userId);
        const active = isActiveSubscription(subscription);
        const usage = await getGenerationStats(userId);

        return json(res, 200, {
          authenticated: true,
          user: {
            id: user?.id || userId,
            email: user?.email || profile.email,
            name: user?.name || profile.name || profile.email,
            avatarUrl: user?.avatarUrl || profile.picture || null,
            provider: user?.provider || 'google',
            isWhitelisted: Boolean(user?.isWhitelisted)
          },
          subscription: {
            active,
            plan: subscription?.plan || null,
            expiresAt: subscription?.currentPeriodEnd || null
          },
          usage
        });
      } catch (error) {
        return json(res, 401, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return json(res, 500, { error: 'Google OAuth is not configured' });
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookies = parseCookies(req);
      const storedState = cookies[OAUTH_COOKIE];

      if (!code || !state || !storedState || state !== storedState) {
        return json(res, 400, { error: 'Invalid OAuth state' });
      }

      if (!(await store.hasOauthState(state))) {
        return json(res, 400, { error: 'OAuth state expired' });
      }

      const origin = getOrigin(req, env);
      const redirectUri = `${origin}/api/auth/google/callback`;
      const token = await exchangeGoogleCode({
        code,
        redirectUri,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET
      });
      const profile = await fetchGoogleProfile(token.access_token);

      const existing = await store.findUserByGoogleSubject(profile.sub);
      const userId = existing?.id || crypto.randomUUID();
      await store.upsertUser({
        id: userId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        provider: 'google',
        providerUserId: profile.sub,
        updatedAt: nowIso(),
        createdAt: existing?.createdAt || nowIso(),
        stripeCustomerId: existing?.stripeCustomerId || null
      });
      await store.deleteOauthState(state);

      setCookie(
        res,
        buildCookie(OAUTH_COOKIE, '', {
          maxAge: 0,
          secure: isSecureCookie,
          domain: cookieDomain
        })
      );
      await createSession(res, userId);

      res.writeHead(302, { Location: `${origin}/index.html?auth=success` });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      await clearSession(req, res);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/check-subscription') {
      const sessionUser = await getSessionUser(req);
      const subscription = sessionUser?.subscription || null;
      const active = isActiveSubscription(subscription);

      return json(res, 200, {
        subscribed: active,
        expiresAt: subscription?.currentPeriodEnd || null,
        plan: subscription?.plan || null,
        authenticated: Boolean(sessionUser),
        isWhitelisted: Boolean(sessionUser?.user?.isWhitelisted),
        usage: sessionUser ? await getGenerationStats(sessionUser.user.id) : {
          freeLimit: FREE_GENERATION_LIMIT,
          totalGenerations: 0,
          freeUsesLeft: FREE_GENERATION_LIMIT
        }
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/usage-summary') {
      const sessionUser = await requireSessionUser(req);
      const userEvents = await store.listUsageEvents(sessionUser.user.id, 'generate_angle');
      const lastGeneratedAt = userEvents.length ? userEvents[userEvents.length - 1].createdAt : null;
      const usage = await getGenerationStats(sessionUser.user.id);

      return json(res, 200, {
        totalGenerations: usage.totalGenerations,
        freeLimit: usage.freeLimit,
        freeUsesLeft: usage.freeUsesLeft,
        lastGeneratedAt
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      try {
        await requireAdminSession(req);
        const query = url.searchParams.get('query') || '';
        const users = await getAdminUserRows(query);
        return json(res, 200, { users });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/users/')) {
      try {
        await requireAdminSession(req);
        const userId = url.pathname.split('/').pop();
        const body = parseJsonBody(await readBody(req));
        if (typeof body.isWhitelisted !== 'boolean') {
          return json(res, 400, { error: 'isWhitelisted must be a boolean' });
        }
        await store.setUserWhitelist(userId, body.isWhitelisted);
        return json(res, 200, { ok: true });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/record-usage') {
      const body = parseJsonBody(await readBody(req));
      if (!body.action) {
        return json(res, 400, { error: 'action is required' });
      }

      let userId = body.userId;
      if (!userId) {
        const sessionUser = await getSessionUser(req);
        userId = sessionUser?.user.id;
      }

      if (!userId) {
        return json(res, 401, { error: 'Authentication required' });
      }

      await recordUsage({ userId, action: body.action, meta: body.meta || {} });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/create-checkout-session') {
      const body = parseJsonBody(await readBody(req));
      const sessionUser = await requireSessionUser(req);
      const origin = getOrigin(req, env);
      const provider = resolveBillingProvider(env);
      const priceId = resolveCheckoutPriceId(env, provider, body.priceId);
      const planId = pickFirstNonEmpty(body.planId, env.PAYPAL_PLAN_ID) || null;

      if (provider === 'stripe' && env.STRIPE_SECRET_KEY) {
        if (!priceId) {
          return json(res, 400, { error: 'priceId is required' });
        }

        const session = await createStripeCheckoutSession(env.STRIPE_SECRET_KEY, {
          priceId,
          userId: sessionUser.user.id,
          successUrl: `${origin}?success=true`,
          cancelUrl: `${origin}?canceled=true`,
          customerEmail: sessionUser.user.email
        });

        return json(res, 200, { url: session.url, id: session.id, provider: 'stripe' });
      }

      if (provider === 'paypal') {
        if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !planId) {
          return json(res, 503, { error: 'PayPal billing is not configured' });
        }

        const session = await createPayPalSubscription(env, {
          planId,
          user: sessionUser.user,
          returnUrl: `${origin}/index.html?billing=success`,
          cancelUrl: `${origin}/index.html?billing=canceled`
        });

        return json(res, 200, { url: session.url, id: session.id, provider: 'paypal' });
      }

      const checkoutUrl = resolveCheckoutUrl(env, {
        origin,
        user: sessionUser.user,
        priceId
      });

      if (!checkoutUrl) {
        return json(res, 503, { error: 'Billing checkout is not configured' });
      }

      return json(res, 200, {
        url: checkoutUrl,
        provider: provider === 'lemonsqueezy' ? 'lemonsqueezy' : provider === 'paddle' ? 'paddle' : provider === 'hosted' ? 'hosted' : 'manual'
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/create-portal-session') {
      const sessionUser = await requireSessionUser(req);
      if (sessionUser.user.isWhitelisted && !isActiveSubscription(sessionUser.subscription)) {
        return json(res, 200, {
          skipped: true,
          provider: 'whitelist',
          message: 'Whitelisted accounts do not need billing'
        });
      }
      const origin = getOrigin(req, env);
      const provider = resolveBillingProvider(env);

      if (provider === 'stripe' && env.STRIPE_SECRET_KEY) {
        const customerId = sessionUser.subscription?.stripeCustomerId || sessionUser.user.stripeCustomerId;

        if (!customerId) {
          return json(res, 400, { error: 'Stripe customer is not available yet' });
        }

        const portal = await createStripeBillingPortalSession(env.STRIPE_SECRET_KEY, {
          customerId,
          returnUrl: `${origin}/index.html`
        });

        return json(res, 200, { url: portal.url, id: portal.id, provider: 'stripe' });
      }

      if (provider === 'paypal') {
        const portalUrl = String(env.PAYPAL_PORTAL_URL || '').trim();
        if (!portalUrl) {
          return json(res, 503, { error: 'PayPal billing portal is not configured' });
        }

        return json(res, 200, { url: portalUrl, provider: 'paypal' });
      }

      const portalUrl = resolvePortalUrl(env, {
        origin,
        user: sessionUser.user,
        subscription: sessionUser.subscription || null,
        customerId: sessionUser.subscription?.stripeCustomerId || sessionUser.user.stripeCustomerId || null
      });

      if (!portalUrl) {
        return json(res, 503, { error: 'Billing portal is not configured' });
      }

      return json(res, 200, {
        url: portalUrl,
        provider: provider === 'lemonsqueezy' ? 'lemonsqueezy' : provider === 'paddle' ? 'paddle' : provider === 'hosted' ? 'hosted' : 'manual'
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/stripe-webhook') {
      if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
        return json(res, 500, { error: 'Stripe webhook is not configured' });
      }

      const rawBody = await readBody(req);
      const payload = rawBody.toString('utf8');

      try {
        verifyStripeWebhookSignature({
          payload,
          header: req.headers['stripe-signature'],
          secret: env.STRIPE_WEBHOOK_SECRET
        });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }

      const event = JSON.parse(payload);
      const object = event.data?.object;

      if (event.type === 'checkout.session.completed' && object?.metadata?.userId && object.subscription) {
        const subscription = await getStripeSubscription(env.STRIPE_SECRET_KEY, object.subscription);
        await syncBillingSubscription({
          userId: object.metadata.userId,
          customerId: object.customer || null,
          subscriptionId: subscription.id,
          status: subscription.status === 'active' ? 'active' : subscription.status,
          plan: subscription.items?.data?.[0]?.price?.id || null,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
          email: object.customer_details?.email || null
        });
      }

      if (
        (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') &&
        object?.metadata?.userId
      ) {
        await syncBillingSubscription({
          userId: object.metadata.userId,
          customerId: object.customer || null,
          subscriptionId: object.id,
          status: object.status,
          plan: object.items?.data?.[0]?.price?.id || null,
          currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null
        });
      }

      return json(res, 200, { received: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
      const rawBody = await readBody(req);
      const payload = rawBody.toString('utf8');
      const provider = resolveBillingProvider(env);

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return json(res, 400, { error: 'Billing webhook payload must be JSON' });
      }

      if (
        provider === 'paypal' ||
        req.headers['paypal-transmission-id'] ||
        req.headers['paypal-transmission-sig']
      ) {
        try {
          await verifyPayPalWebhookSignature(env, {
            payload: parsed,
            headers: req.headers
          });

          const event = normalizePayPalWebhookPayload(parsed);
          if (!event.userId && !event.customerEmail) {
            return json(res, 400, { error: 'userId or customerEmail is required' });
          }

          await syncBillingEvent(event);
          return json(res, 200, { received: true, provider: 'paypal' });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      try {
        const signature =
          req.headers['paddle-signature'] ||
          req.headers['x-paddle-signature'] ||
          req.headers['x-signature'] ||
          req.headers['billing-signature'] ||
          req.headers['x-billing-signature'];
        const webhookSecret =
          env.BILLING_WEBHOOK_SECRET ||
          env.PADDLE_WEBHOOK_SECRET ||
          env.LEMONSQUEEZY_WEBHOOK_SECRET ||
          env.STRIPE_WEBHOOK_SECRET;
        if (webhookSecret) {
          verifyBillingWebhookSignature({
            payload,
            header: signature,
            secret: webhookSecret
          });
        }
      } catch (error) {
        return json(res, 400, { error: error.message });
      }

      try {
        const event = normalizeBillingWebhookPayload(parsed);
        if (!event.userId && !event.customerEmail) {
          return json(res, 400, { error: 'userId or customerEmail is required' });
        }

        await syncBillingEvent(event);
        return json(res, 200, { received: true, provider });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/create-api-key') {
      const body = parseJsonBody(await readBody(req));
      const sessionUser = await requireSessionUser(req);
      const userId = sessionUser.user.id;
      const name = body.name || 'Default key';

      try {
        await requireActiveSubscription(userId);
      } catch (error) {
        return json(res, 403, { error: error.message });
      }

      const rawKey = generateApiKey();
      const keyId = crypto.randomUUID();
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 16);

      await store.createApiKey({
        id: keyId,
        userId,
        name,
        keyPrefix,
        keyHash,
        status: 'active',
        createdAt: nowIso(),
        lastUsedAt: null
      });

      return json(res, 201, {
        id: keyId,
        key: rawKey,
        keyPrefix,
        name
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/list-api-keys') {
      const sessionUser = await requireSessionUser(req);
      const userId = sessionUser.user.id;

      const keys = (await store.listApiKeys(userId))
        .map((key) => ({
          id: key.id,
          name: key.name,
          keyPrefix: key.keyPrefix,
          status: key.status,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt
        }));

      return json(res, 200, { keys });
    }

    if (req.method === 'POST' && url.pathname === '/api/revoke-api-key') {
      const body = parseJsonBody(await readBody(req));
      const sessionUser = await requireSessionUser(req);
      if (!body.keyId) {
        return json(res, 400, { error: 'keyId is required' });
      }

      await store.revokeApiKey(body.keyId, sessionUser.user.id, nowIso());

      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/seedream-proxy') {
      if (!env.SEEDREAM_API_URL || !env.SEEDREAM_API_KEY) {
        return json(res, 500, { error: 'SEEDREAM_API_URL and SEEDREAM_API_KEY are required' });
      }

      const sessionUser = await requireSessionUser(req);
      const body = parseJsonBody(await readBody(req));
      if (!body.prompt || !body.image) {
        return json(res, 400, { error: 'prompt and image are required' });
      }

      const subscription = sessionUser.subscription || null;
      const isSubscribed = isActiveSubscription(subscription);
      const isWhitelisted = Boolean(sessionUser.user.isWhitelisted);
      const usage = await getGenerationStats(sessionUser.user.id);

      if (!isSubscribed && !isWhitelisted && usage.freeUsesLeft <= 0) {
        return json(res, 402, { error: 'Free quota exhausted. Subscribe to continue generating.' });
      }

      const upstream = await fetch(resolveSeedreamEndpoint(env.SEEDREAM_API_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SEEDREAM_API_KEY}`
        },
        body: JSON.stringify(buildSeedreamPayload(body, env))
      });

      const responseText = await upstream.text();
      if (upstream.ok) {
        await recordUsage({
          userId: sessionUser.user.id,
          action: 'generate_angle',
          meta: {
            x: body.meta?.x || null,
            y: body.meta?.y || null,
            z: body.meta?.z || null,
            status: upstream.status
          }
        });
      }
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      res.end(responseText);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/qwen-proxy') {
      if (!env.QWEN_API_URL || !env.QWEN_API_KEY) {
        return json(res, 500, { error: 'QWEN_API_URL and QWEN_API_KEY are required' });
      }

      const body = parseJsonBody(await readBody(req));
      const upstream = await fetch(env.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.QWEN_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const responseText = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      res.end(responseText);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/generate-angle') {
      if (!env.SEEDREAM_API_URL || !env.SEEDREAM_API_KEY) {
        return json(res, 500, { error: 'SEEDREAM_API_URL and SEEDREAM_API_KEY are required' });
      }

      const authHeader = req.headers.authorization || '';
      const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!rawKey) {
        return json(res, 401, { error: 'Bearer access token required' });
      }

      const keyHash = hashApiKey(rawKey);
      const apiKey = await store.findActiveApiKeyByHash(keyHash);
      if (!apiKey) {
        return json(res, 401, { error: 'Invalid access token' });
      }

      const subscription = await store.getSubscription(apiKey.userId);
      if (!isActiveSubscription(subscription)) {
        return json(res, 403, { error: 'Active plan required for generation access' });
      }

      const body = parseJsonBody(await readBody(req));
      if (!body.prompt || !body.image) {
        return json(res, 400, { error: 'prompt and image are required' });
      }

      const upstream = await fetch(resolveSeedreamEndpoint(env.SEEDREAM_API_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SEEDREAM_API_KEY}`
        },
        body: JSON.stringify(buildSeedreamPayload(body, env))
      });

      const upstreamText = await upstream.text();

      const usedAt = nowIso();
      await store.touchApiKey(apiKey.id, usedAt);
      await store.recordUsage({
        id: crypto.randomUUID(),
        userId: apiKey.userId,
        apiKeyId: apiKey.id,
        action: 'api_generate_angle',
        meta: { status: upstream.status },
        createdAt: usedAt
      });

      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json'
      });
      res.end(upstreamText);
      return;
    }

    json(res, 404, { error: 'Not Found' });
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const canonicalRedirect = getCanonicalRedirectLocation(req, url, env);
      if (canonicalRedirect) {
        res.writeHead(301, { Location: canonicalRedirect });
        res.end();
        return;
      }

      if (url.pathname === '/admin') {
        res.writeHead(302, { Location: '/admin/' });
        res.end();
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        return await handleApi(req, res, url);
      }

      const filePath = resolveStaticPath(appRoot, url.pathname);
      const data = await readFile(filePath);
      const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': getStaticCacheControl(filePath)
      });
      res.end(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return text(res, 404, 'Not Found');
      }
      if (error.status) {
        return json(res, error.status, { error: error.message });
      }
      console.error(error);
      return json(res, 500, { error: error.message || 'Internal Server Error' });
    }
  }

  const server = createServer(handle);

  return {
    server,
    init() {
      return store.init();
    },
    handle,
    async close() {
      if (server.listening) {
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
      if (typeof store.close === 'function') {
        await store.close();
      }
    },
    listen() {
      return new Promise((resolve, reject) => {
        Promise.resolve(store.init())
          .then(() => {
            server.listen(port, host, () => {
              const address = server.address();
              if (address && typeof address !== 'string') {
                console.log(`App running at http://${address.address}:${address.port}`);
              } else {
                console.log(`App running at http://${host}:${port}`);
              }
              resolve();
            });
          })
          .catch(reject);
      });
    }
  };
}
