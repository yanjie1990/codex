const DEFAULT_API_BASE = 'https://api-m.paypal.com';
const DEFAULT_SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

function normalize(value) {
  if (value == null) {
    return '';
  }
  return String(value).trim();
}

export function resolvePayPalApiBaseUrl(env) {
  const explicit = normalize(env.PAYPAL_API_BASE_URL);
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const mode = normalize(env.PAYPAL_MODE).toLowerCase();
  return mode === 'sandbox' ? DEFAULT_SANDBOX_API_BASE : DEFAULT_API_BASE;
}

async function getPayPalAccessToken(env) {
  const clientId = normalize(env.PAYPAL_CLIENT_ID);
  const clientSecret = normalize(env.PAYPAL_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error('PayPal client credentials are not configured');
  }

  const response = await fetch(`${resolvePayPalApiBaseUrl(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Failed to obtain PayPal access token');
  }

  return payload.access_token;
}

async function paypalRequest(env, method, path, body, extraHeaders = {}) {
  const accessToken = await getPayPalAccessToken(env);
  const response = await fetch(`${resolvePayPalApiBaseUrl(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body == null ? undefined : JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || `PayPal request failed: ${response.status}`);
  }

  return payload;
}

export async function createPayPalSubscription(env, { planId, user, returnUrl, cancelUrl }) {
  const resolvedPlanId = normalize(planId) || normalize(env.PAYPAL_PLAN_ID);
  if (!resolvedPlanId) {
    throw new Error('PayPal plan ID is not configured');
  }

  const payload = await paypalRequest(env, 'POST', '/v1/billing/subscriptions', {
    plan_id: resolvedPlanId,
    custom_id: normalize(user?.id),
    subscriber: normalize(user?.email)
      ? {
          email_address: normalize(user.email),
          name: normalize(user?.name)
            ? {
                given_name: normalize(user.name).slice(0, 140)
              }
            : undefined
        }
      : undefined,
    application_context: {
      brand_name: 'ImgcraftAI',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl
    }
  });

  const approveLink = Array.isArray(payload.links) ? payload.links.find((link) => link?.rel === 'approve') : null;
  if (!approveLink?.href) {
    throw new Error('PayPal approval URL is missing');
  }

  return {
    id: payload.id,
    url: approveLink.href
  };
}

export async function verifyPayPalWebhookSignature(env, { payload, headers }) {
  const webhookId = normalize(env.PAYPAL_WEBHOOK_ID);
  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID is not configured');
  }

  const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const verification = await paypalRequest(env, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: normalize(headers['paypal-auth-algo']),
    cert_url: normalize(headers['paypal-cert-url']),
    transmission_id: normalize(headers['paypal-transmission-id']),
    transmission_sig: normalize(headers['paypal-transmission-sig']),
    transmission_time: normalize(headers['paypal-transmission-time']),
    webhook_id: webhookId,
    webhook_event: parsedPayload
  });

  if (normalize(verification.verification_status).toUpperCase() !== 'SUCCESS') {
    throw new Error('Invalid PayPal webhook signature');
  }
}

function asIso(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapStatus(type, resourceStatus) {
  const normalizedStatus = normalize(resourceStatus).toLowerCase();
  if (normalizedStatus) {
    if (['active', 'approved'].includes(normalizedStatus)) {
      return 'active';
    }
    if (['cancelled', 'canceled', 'suspended', 'expired'].includes(normalizedStatus)) {
      return 'canceled';
    }
    if (normalizedStatus === 'past_due') {
      return 'past_due';
    }
    return normalizedStatus;
  }

  const normalizedType = normalize(type).toUpperCase();
  if (normalizedType.includes('CANCELLED') || normalizedType.includes('EXPIRED') || normalizedType.includes('SUSPENDED')) {
    return 'canceled';
  }
  if (normalizedType.includes('ACTIVATED')) {
    return 'active';
  }
  return null;
}

export function normalizePayPalWebhookPayload(payload) {
  const event = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
  const type = normalize(event.event_type);
  const resource = event.resource || {};

  if (!type.startsWith('BILLING.SUBSCRIPTION.')) {
    throw new Error('Unsupported PayPal billing event');
  }

  return {
    type: type || null,
    userId: normalize(resource.custom_id) || null,
    customerId: normalize(resource.subscriber?.payer_id || resource.subscriber_id) || null,
    subscriptionId: normalize(resource.id) || null,
    status: mapStatus(type, resource.status),
    plan: normalize(resource.plan_id) || normalize(resource.plan?.id) || null,
    currentPeriodEnd:
      asIso(resource.billing_info?.next_billing_time) ||
      asIso(resource.billing_info?.final_payment_time) ||
      asIso(resource.status_update_time),
    customerEmail: normalize(resource.subscriber?.email_address) || null
  };
}
