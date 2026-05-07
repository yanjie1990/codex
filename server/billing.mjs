import crypto from 'node:crypto';

function normalizeString(value) {
  return String(value ?? '').trim();
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function resolveBillingTemplate(env, legacyKey, primaryKey) {
  return pickFirstNonEmpty(env?.[primaryKey], env?.[legacyKey]);
}

function isLemonSqueezyProvider(provider) {
  return ['lemonsqueezy', 'lemon_squeezy', 'lemon', 'ls'].includes(normalizeString(provider).toLowerCase());
}

function isPaddleProvider(provider) {
  return ['paddle'].includes(normalizeString(provider).toLowerCase());
}

function isPayPalProvider(provider) {
  return ['paypal', 'pp'].includes(normalizeString(provider).toLowerCase());
}

function isHostedProvider(provider) {
  return ['hosted', 'manual'].includes(normalizeString(provider).toLowerCase());
}

function replaceTokens(template, params) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

export function resolveBillingProvider(env) {
  const configured = normalizeString(env.BILLING_PROVIDER).toLowerCase();
  if (configured) {
    if (configured === 'pp') {
      return 'paypal';
    }
    if (configured === 'lemon') {
      return 'lemonsqueezy';
    }
    if (configured === 'lemon_squeezy' || configured === 'lemonsqueezy' || configured === 'ls') {
      return 'lemonsqueezy';
    }
    return configured;
  }

  if (
    normalizeString(env.PAYPAL_CLIENT_ID) ||
    normalizeString(env.PAYPAL_CLIENT_SECRET) ||
    normalizeString(env.PAYPAL_PLAN_ID) ||
    normalizeString(env.PAYPAL_WEBHOOK_ID)
  ) {
    return 'paypal';
  }

  if (
    normalizeString(env.LEMONSQUEEZY_CHECKOUT_URL) ||
    normalizeString(env.LEMONSQUEEZY_PORTAL_URL) ||
    normalizeString(env.LEMONSQUEEZY_WEBHOOK_SECRET)
  ) {
    return 'lemonsqueezy';
  }

  if (normalizeString(env.PADDLE_CHECKOUT_URL) || normalizeString(env.PADDLE_PORTAL_URL) || normalizeString(env.PADDLE_WEBHOOK_SECRET)) {
    return 'paddle';
  }

  if (normalizeString(env.STRIPE_SECRET_KEY) || normalizeString(env.STRIPE_WEBHOOK_SECRET) || normalizeString(env.STRIPE_PRICE_ID)) {
    return 'stripe';
  }

  if (normalizeString(env.BILLING_CHECKOUT_URL) || normalizeString(env.BILLING_PORTAL_URL) || normalizeString(env.BILLING_WEBHOOK_SECRET)) {
    return 'hosted';
  }

  return 'manual';
}

export function buildUrlFromTemplate(template, params = {}, baseUrl = '') {
  const trimmedTemplate = normalizeString(template);
  if (!trimmedTemplate) {
    return '';
  }

  const substituted = replaceTokens(trimmedTemplate, params);
  const url = new URL(substituted, baseUrl || undefined);
  appendParams(url, params);
  return url.toString();
}

function buildUrlFromTemplateWithoutQuery(template, params = {}, baseUrl = '') {
  const trimmedTemplate = normalizeString(template);
  if (!trimmedTemplate) {
    return '';
  }

  const substituted = replaceTokens(trimmedTemplate, params);
  return new URL(substituted, baseUrl || undefined).toString();
}

export function resolveCheckoutUrl(env, { origin, user, priceId }) {
  const provider = resolveBillingProvider(env);
  if (provider === 'stripe' || isPayPalProvider(provider)) {
    return null;
  }

  const template =
    resolveBillingTemplate(env, 'BILLING_CHECKOUT_URL', provider === 'lemonsqueezy' ? 'LEMONSQUEEZY_CHECKOUT_URL' : 'PADDLE_CHECKOUT_URL');
  if (!template) {
    return null;
  }

  const resolvedPriceId =
    priceId ||
    resolveBillingTemplate(
      env,
      'BILLING_PRICE_ID',
      provider === 'lemonsqueezy'
        ? 'LEMONSQUEEZY_PRICE_ID'
        : provider === 'paddle'
          ? 'PADDLE_PRICE_ID'
          : 'BILLING_PRICE_ID'
    ) ||
    '';
  const resolvedPlan =
    resolveBillingTemplate(
      env,
      'BILLING_PLAN_CODE',
      provider === 'lemonsqueezy'
        ? 'LEMONSQUEEZY_PLAN_CODE'
        : provider === 'paddle'
          ? 'PADDLE_PLAN_CODE'
          : 'BILLING_PLAN_CODE'
    ) || 'subscription';

  if (isLemonSqueezyProvider(provider)) {
    return buildUrlFromTemplate(
      template,
      {
        email: user.email || '',
        name: user.name || user.email || '',
        price_id: resolvedPriceId,
        plan: resolvedPlan,
        checkout_email: user.email || '',
        checkout_name: user.name || user.email || '',
        'checkout[email]': user.email || '',
        'checkout[name]': user.name || user.email || '',
        'checkout[custom][user_id]': user.id,
        'checkout[custom][userId]': user.id,
        'checkout[custom][email]': user.email || '',
        'checkout[custom][customer_id]': user.stripeCustomerId || '',
        'checkout[custom][plan]': resolvedPlan,
        'checkout[custom][origin]': origin,
        success_url: `${origin}/index.html?billing=success`,
        cancel_url: `${origin}/index.html?billing=canceled`,
        return_url: `${origin}/index.html`,
        origin
      },
      origin
    );
  }

  return buildUrlFromTemplate(
    template,
    {
      user_id: user.id,
      userId: user.id,
      email: user.email || '',
      customer_email: user.email || '',
      price_id: resolvedPriceId,
      plan: resolvedPlan,
      success_url: `${origin}/index.html?billing=success`,
      cancel_url: `${origin}/index.html?billing=canceled`,
      return_url: `${origin}/index.html`,
      origin
    },
    origin
  );
}

export function resolvePortalUrl(env, { origin, user, subscription, customerId }) {
  const provider = resolveBillingProvider(env);
  if (provider === 'stripe' || isPayPalProvider(provider)) {
    return null;
  }

  const template =
    resolveBillingTemplate(env, 'BILLING_PORTAL_URL', provider === 'lemonsqueezy' ? 'LEMONSQUEEZY_PORTAL_URL' : 'PADDLE_PORTAL_URL');
  if (!template) {
    return null;
  }

  if (isLemonSqueezyProvider(provider)) {
    return buildUrlFromTemplateWithoutQuery(
      template,
      {
        user_id: user.id,
        userId: user.id,
        email: user.email || '',
        customer_id: customerId || subscription?.stripeCustomerId || user.stripeCustomerId || '',
        subscription_id: subscription?.stripeSubscriptionId || '',
        plan: subscription?.plan || resolveBillingTemplate(env, 'BILLING_PLAN_CODE', 'LEMONSQUEEZY_PLAN_CODE') || 'subscription',
        return_url: `${origin}/index.html`,
        origin
      },
      origin
    );
  }

  return buildUrlFromTemplate(
    template,
    {
      user_id: user.id,
      userId: user.id,
      email: user.email || '',
      customer_id: customerId || subscription?.stripeCustomerId || user.stripeCustomerId || '',
      subscription_id: subscription?.stripeSubscriptionId || '',
      plan:
        subscription?.plan ||
        resolveBillingTemplate(
          env,
          'BILLING_PLAN_CODE',
          provider === 'lemonsqueezy'
            ? 'LEMONSQUEEZY_PLAN_CODE'
            : provider === 'paddle'
              ? 'PADDLE_PLAN_CODE'
              : 'BILLING_PLAN_CODE'
        ) ||
        'subscription',
      return_url: `${origin}/index.html`,
      origin
    },
    origin
  );
}

function parseWebhookSignatureHeader(header) {
  const normalizedHeader = normalizeString(header);
  if (!normalizedHeader) {
    throw new Error('Missing billing signature');
  }

  const parts = normalizedHeader
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const values = new Map();
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    const key = normalizeString(rawKey);
    const value = normalizeString(rest.join('='));
    if (key && value) {
      values.set(key, value);
    }
  }

  return values;
}

export function verifyBillingWebhookSignature({ payload, header, secret, toleranceMs = 5 * 60 * 1000 }) {
  const normalizedSecret = normalizeString(secret);
  if (!normalizedSecret) {
    return;
  }

  const values = parseWebhookSignatureHeader(header);

  const paddleTimestamp = values.get('ts');
  const paddleSignature = values.get('h1');
  if (paddleTimestamp && paddleSignature) {
    const timestamp = Number(paddleTimestamp);
    if (!timestamp) {
      throw new Error('Invalid billing signature');
    }

    const ageMs = Math.abs(Date.now() - timestamp * 1000);
    if (ageMs > toleranceMs) {
      throw new Error('Billing signature timestamp outside tolerance');
    }

    const signedPayload = `${paddleTimestamp}:${payload}`;
    const digest = crypto.createHmac('sha256', normalizedSecret).update(signedPayload).digest('hex');
    const left = Buffer.from(paddleSignature);
    const right = Buffer.from(digest);

    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error('Invalid billing signature');
    }

    return;
  }

  const stripeTimestamp = values.get('t');
  const stripeSignature = values.get('v1');
  if (stripeTimestamp && stripeSignature) {
    const timestamp = Number(stripeTimestamp);
    if (!timestamp) {
      throw new Error('Invalid billing signature');
    }

    const ageMs = Math.abs(Date.now() - timestamp * 1000);
    if (ageMs > toleranceMs) {
      throw new Error('Billing signature timestamp outside tolerance');
    }

    const signedPayload = `${timestamp}.${payload}`;
    const digest = crypto.createHmac('sha256', normalizedSecret).update(signedPayload).digest('hex');
    const left = Buffer.from(stripeSignature);
    const right = Buffer.from(digest);

    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error('Invalid billing signature');
    }

    return;
  }

  const lemonSignature = normalizeString(header);
  if (lemonSignature) {
    const digest = crypto.createHmac('sha256', normalizedSecret).update(payload).digest('hex');
    const left = Buffer.from(lemonSignature);
    const right = Buffer.from(digest);

    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error('Invalid billing signature');
    }

    return;
  }

  throw new Error('Invalid billing signature');
}

function asIso(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeBillingWebhookPayload(payload) {
  const event = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
  const lemonEventName = normalizeString(event?.meta?.event_name || event?.meta?.eventName || event?.event_name || event?.eventName);
  const lemonData = event?.data;
  const lemonAttributes = lemonData?.attributes || {};
  const lemonCustomData = event?.meta?.custom_data || lemonAttributes?.custom_data || lemonData?.custom_data || {};

  if (lemonEventName && lemonData?.id && lemonAttributes) {
    const status = normalizeString(
      lemonAttributes.status ||
        event.status ||
        (lemonEventName.includes('cancel') || lemonEventName.includes('expired') || lemonEventName.includes('past_due')
          ? 'canceled'
          : lemonEventName.includes('create') || lemonEventName.includes('renew') || lemonEventName.includes('update')
            ? 'active'
            : '')
    ) || null;

    return {
      type: lemonEventName || null,
      userId: normalizeString(
        lemonCustomData.userId ||
          lemonCustomData.user_id ||
          lemonAttributes.user_id ||
          lemonAttributes.userId ||
          lemonData?.attributes?.custom_data?.user_id ||
          lemonData?.attributes?.custom_data?.userId ||
          event.userId ||
          event.user_id
      ) || null,
      customerId: normalizeString(
        lemonAttributes.customer_id ||
          lemonAttributes.customerId ||
          lemonData?.relationships?.customer?.data?.id ||
          event.customerId ||
          event.customer_id
      ) || null,
      subscriptionId: normalizeString(
        lemonData.id ||
          lemonAttributes.subscription_id ||
          lemonAttributes.subscriptionId ||
          event.subscriptionId ||
          event.subscription_id
      ) || null,
      status,
      plan: normalizeString(
        lemonAttributes.variant_id ||
          lemonAttributes.product_id ||
          lemonAttributes.variant?.id ||
          lemonAttributes.product?.id ||
          lemonCustomData.plan ||
          event.plan ||
          lemonAttributes.price_id
      ) || null,
      currentPeriodEnd: asIso(
        lemonAttributes.renews_at ||
          lemonAttributes.ends_at ||
          lemonAttributes.trial_ends_at ||
          lemonAttributes.current_period_end ||
          event.currentPeriodEnd ||
          event.current_period_end
      ),
      customerEmail: normalizeString(
        lemonAttributes.user_email ||
          lemonAttributes.email ||
          lemonAttributes.customer_email ||
          event.customerEmail ||
          lemonCustomData.email ||
          lemonCustomData.customer_email
      ) || null
    };
  }

  if (event.event_type && event.data?.id) {
    const data = event.data;
    const attributes = data.attributes || {};
    const customData = attributes.custom_data || data.custom_data || {};
    const nextStatus = normalizeString(attributes.status || event.status || (event.event_type.includes('canceled') ? 'canceled' : 'active')) || null;
    const currentPeriodEnd = asIso(
      attributes.current_billing_period?.ends_at ||
        attributes.next_billed_at ||
        attributes.canceled_at ||
        attributes.ends_at ||
        event.currentPeriodEnd ||
        event.current_period_end
    );

    return {
      type: normalizeString(event.event_type) || null,
      userId: normalizeString(
        customData.userId ||
          customData.user_id ||
          attributes.userId ||
          attributes.user_id ||
          data.user_id ||
          event.userId ||
          event.user_id
      ) || null,
      customerId: normalizeString(attributes.customer_id || data.customer_id || event.customerId || event.customer_id) || null,
      subscriptionId: normalizeString(data.id || attributes.subscription_id || event.subscriptionId || event.subscription_id) || null,
      status: nextStatus,
      plan: normalizeString(
        attributes.price_id ||
          attributes.items?.[0]?.price_id ||
          attributes.items?.[0]?.price?.id ||
          customData.plan ||
          event.plan ||
          event.priceId
      ) || null,
      currentPeriodEnd,
      customerEmail: normalizeString(
        attributes.email ||
          attributes.customer_email ||
          data.customer_email ||
          event.customerEmail ||
          customData.email
      ) || null
    };
  }

  const object = event.data?.object || event.subscription || event.object || event;
  const metadata = object?.metadata || event.metadata || {};
  const type = normalizeString(event.type || event.eventType || event.event_type || object?.eventType || object?.type);

  const status = normalizeString(
    object?.status || event.status || metadata.status || (type.includes('canceled') ? 'canceled' : type.includes('deleted') ? 'canceled' : type.includes('active') ? 'active' : '')
  ) || null;

  return {
    type: type || null,
    userId: normalizeString(metadata.userId || metadata.user_id || event.userId || event.user_id || object?.userId || object?.user_id) || null,
    customerId: normalizeString(
      object?.customer || object?.customer_id || event.customerId || event.customer_id || metadata.customerId || metadata.customer_id
    ) || null,
    subscriptionId: normalizeString(
      object?.subscription || object?.subscription_id || event.subscriptionId || event.subscription_id || object?.id
    ) || null,
    status,
    plan: normalizeString(
      object?.plan?.id || object?.price?.id || object?.items?.data?.[0]?.price?.id || event.plan || event.priceId || metadata.plan
    ) || null,
    currentPeriodEnd: asIso(object?.current_period_end || object?.currentPeriodEnd || event.current_period_end || event.currentPeriodEnd),
    customerEmail: normalizeString(
      object?.customer_email || object?.customerEmail || event.customerEmail || metadata.email || object?.email
    ) || null
  };
}
