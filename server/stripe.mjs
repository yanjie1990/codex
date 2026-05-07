import crypto from 'node:crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function encodeForm(data, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) {
      continue;
    }
    const formKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeForm(item, `${formKey}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${formKey}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
      continue;
    }
    if (typeof value === 'object') {
      parts.push(encodeForm(value, formKey));
      continue;
    }
    parts.push(`${encodeURIComponent(formKey)}=${encodeURIComponent(String(value))}`);
  }
  return parts.filter(Boolean).join('&');
}

export async function stripeRequest(secretKey, method, path, body) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: body ? encodeForm(body) : undefined
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || `Stripe request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function createCheckoutSession(secretKey, { priceId, userId, successUrl, cancelUrl, customerEmail }) {
  return stripeRequest(secretKey, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    'line_items': [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
    subscription_data: {
      metadata: { userId }
    },
    ...(customerEmail ? { customer_email: customerEmail } : {})
  });
}

export async function createBillingPortalSession(secretKey, { customerId, returnUrl }) {
  return stripeRequest(secretKey, 'POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl
  });
}

export async function getSubscription(secretKey, subscriptionId) {
  return stripeRequest(secretKey, 'GET', `/subscriptions/${subscriptionId}`);
}

function parseStripeSignature(header) {
  const parsed = {};
  if (!header) {
    return parsed;
  }

  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    parsed[key] = value;
  }
  return parsed;
}

export function verifyStripeWebhookSignature({ payload, header, secret, toleranceMs = 5 * 60 * 1000 }) {
  const parsed = parseStripeSignature(header);
  const timestamp = Number(parsed.t);
  const signature = parsed.v1;

  if (!timestamp || !signature) {
    throw new Error('Missing Stripe signature');
  }

  const ageMs = Math.abs(Date.now() - timestamp * 1000);
  if (ageMs > toleranceMs) {
    throw new Error('Stripe signature timestamp outside tolerance');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    throw new Error('Invalid Stripe signature');
  }
}
