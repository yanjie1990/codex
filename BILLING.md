# Billing and Usage

## Environment

Copy `.env.example` to your local environment and fill in the values that match your deployment target.

### Shared values

- `BASE_URL`
- `DATABASE_URL` for PostgreSQL in production, optional for local JSON fallback
- `DATABASE_FALLBACK_ON_ERROR=false` in production
- `ADMIN_EMAILS` for operator accounts that should see the admin area
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SEEDREAM_API_URL`
- `SEEDREAM_API_KEY`
- `SEEDREAM_MODEL_ID` is optional and defaults to `doubao-seedream-4-0-250828`

### Billing provider

Set one of these:

- `paypal` for PayPal subscriptions and webhook verification
- `lemonsqueezy` for Lemon Squeezy hosted checkout and portal flow
- `paddle` for legacy Paddle hosted checkout and portal flow
- `hosted` for a generic hosted checkout and portal flow
- `stripe` for direct Stripe Checkout and webhook handling

Then fill in the matching provider fields:

- `BILLING_PRICE_ID`
- `BILLING_PLAN_CODE`
- `BILLING_CHECKOUT_URL`
- `BILLING_PORTAL_URL`
- `BILLING_WEBHOOK_SECRET`
- `LEMONSQUEEZY_PRICE_ID`
- `LEMONSQUEEZY_PLAN_CODE`
- `LEMONSQUEEZY_CHECKOUT_URL`
- `LEMONSQUEEZY_PORTAL_URL`
- `LEMONSQUEEZY_WEBHOOK_SECRET`
- `PADDLE_PRICE_ID`
- `PADDLE_PLAN_CODE`
- `PADDLE_CHECKOUT_URL`
- `PADDLE_PORTAL_URL`
- `PADDLE_WEBHOOK_SECRET`
- `PAYPAL_MODE`
- `PAYPAL_API_BASE_URL`
- `PAYPAL_CLIENT_ID` when `BILLING_PROVIDER=paypal`
- `PAYPAL_CLIENT_SECRET` when `BILLING_PROVIDER=paypal`
- `PAYPAL_PLAN_ID` when `BILLING_PROVIDER=paypal`
- `PAYPAL_WEBHOOK_ID` when `BILLING_PROVIDER=paypal`
- `PAYPAL_PORTAL_URL` when `BILLING_PROVIDER=paypal`
- `PAYPAL_PLAN_CODE`
- `STRIPE_SECRET_KEY` when `BILLING_PROVIDER=stripe`
- `STRIPE_WEBHOOK_SECRET` when `BILLING_PROVIDER=stripe`
- `STRIPE_PRICE_ID` when `BILLING_PROVIDER=stripe`

### Production notes

- Production must use `https://` for `BASE_URL`
- Production should keep `DATABASE_FALLBACK_ON_ERROR=false`
- Production should keep `ADMIN_EMAILS` non-empty
- For PayPal production, switch `PAYPAL_MODE=live` and use live credentials plus a live webhook id
- Do not reuse sandbox billing ids in production

## Run

```bash
cp .env.example .env
npm run dev
```

The server serves static files from the project root and exposes service routes from the same origin.

## Storage

The app now supports two storage modes:

- No `DATABASE_URL`: local JSON fallback in `.data/app-db.json`
- With `DATABASE_URL`: PostgreSQL storage, recommended for production and suitable for Supabase

Production should keep `DATABASE_FALLBACK_ON_ERROR=false` so the app does not silently switch to local JSON storage if the database is unavailable.

For Supabase:

1. Create a project and open `SQL Editor`.
2. Run the schema in [server/schema.sql](/Users/yanjie/Downloads/coding/Codex/server/schema.sql).
3. Copy the project connection string into:

```text
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

4. Restart the app.

## Google OAuth setup

In Google Cloud Console:

1. Create or reuse a project.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 Client ID of type `Web application`.
4. Add these Authorized redirect URIs:

```text
http://127.0.0.1:5173/api/auth/google/callback
http://localhost:5173/api/auth/google/callback
https://your-domain.com/api/auth/google/callback
```

5. Copy the client ID and secret into `.env` as:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

If you use a custom production domain, set:

```text
BASE_URL=https://your-domain.com
```

Production must use `https://` so session cookies can be marked secure.

Also add these Authorized JavaScript origins for the browser-based Google sign-in flow:

```text
http://127.0.0.1:5173
http://localhost:5173
https://your-domain.com
```

The app uses a popup-based Google login flow in the browser. The server verifies the returned Google credential before creating a session.

## Billing setup

### PayPal subscriptions

Use this when you want PayPal subscriptions with webhook-backed subscription sync.

#### Local development and sandbox

```text
BILLING_PROVIDER=paypal
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=P-XXXXXXXXXXXX
PAYPAL_WEBHOOK_ID=WH-XXXXXXXXXXXX
PAYPAL_PORTAL_URL=https://www.paypal.com/myaccount/autopay/
PAYPAL_PLAN_CODE=subscription
```

Point the sandbox webhook to:

```text
https://your-domain.com/api/billing/webhook
```

#### Production

```text
BILLING_PROVIDER=paypal
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=P-XXXXXXXXXXXX
PAYPAL_WEBHOOK_ID=WH-XXXXXXXXXXXX
PAYPAL_PORTAL_URL=https://www.paypal.com/myaccount/autopay/
PAYPAL_PLAN_CODE=subscription
```

Point the live webhook to:

```text
https://www.imgcraftai.com/api/billing/webhook
```

The server will create a PayPal subscription approval link from
`POST /api/create-checkout-session`, carry the current user id in `custom_id`,
and verify PayPal signatures before syncing subscription state from
`POST /api/billing/webhook`.

### Lemon Squeezy hosted flow

Use this when you want the fastest path to launch without a direct Stripe account.

1. Set:

```text
BILLING_PROVIDER=lemonsqueezy
LEMONSQUEEZY_CHECKOUT_URL=https://your-lemon.example/checkout
LEMONSQUEEZY_PORTAL_URL=https://your-lemon.example/portal
```

2. Optionally configure:

```text
LEMONSQUEEZY_PRICE_ID=price_xxx
LEMONSQUEEZY_PLAN_CODE=subscription
LEMONSQUEEZY_WEBHOOK_SECRET=whsec_xxx
```

3. Point your provider webhook to:

```text
https://your-domain.com/api/billing/webhook
```

The server accepts Lemon Squeezy webhook JSON payloads and maps them into the internal subscription state.

If you already have a generic hosted billing endpoint, the app also accepts the legacy `BILLING_*` environment names as aliases.

### Paddle hosted flow

If you still prefer Paddle, keep the same app flow and set:

```text
BILLING_PROVIDER=paddle
PADDLE_CHECKOUT_URL=https://your-paddle.example/checkout?user_id={user_id}&price_id={price_id}
PADDLE_PORTAL_URL=https://your-paddle.example/portal?user_id={user_id}
PADDLE_PRICE_ID=price_xxx
PADDLE_PLAN_CODE=subscription
PADDLE_WEBHOOK_SECRET=whsec_xxx
```

### Stripe compatibility

If you already have a working Stripe setup, keep:

```text
BILLING_PROVIDER=stripe
STRIPE_PRICE_ID=price_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_SECRET_KEY=sk_test_xxx
```

Then point Stripe webhooks to:

```text
https://your-domain.com/api/stripe-webhook
```

For local testing with Stripe CLI:

```bash
stripe listen --forward-to http://127.0.0.1:5173/api/stripe-webhook
```

## Commercial endpoints

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/google/credential`
- `POST /api/logout`
- `GET /api/me`
- `POST /api/create-checkout-session`
  - body: `{ "priceId": "price_xxx" }`
- `POST /api/create-portal-session`
- `POST /api/billing/webhook`
- `POST /api/stripe-webhook`
- `GET /api/check-subscription`
- `GET /api/usage-summary`
- `POST /api/record-usage`
- `POST /api/seedream-proxy`
  - body: `{ "prompt": "...", "image": "data:image/jpeg;base64,..." }`
  - forwards to `${SEEDREAM_API_URL}/images/generations`
  - uses `SEEDREAM_MODEL_ID` if provided, otherwise defaults to `doubao-seedream-4-0-250828`
  - sends `size: 2k` unless you override it in the request body
  - requires a logged-in user
  - allows 3 free generations per user before subscription is required

## Notes

- Production should use PostgreSQL or Supabase via `DATABASE_URL`.
- Local development can continue using `.data/app-db.json` if no database is configured.
- Seedream image generation uses the Volcengine Ark `images/generations` endpoint.
- Google OAuth plus an HttpOnly session cookie identifies the account that buys generations and views usage.
- The product is a generation service with 3 free generations per user and one subscription plan.
- `ADMIN_EMAILS` is the production mechanism for whitelisting operators. The local fallback is development-only.
- PayPal sandbox and PayPal live are separate setups and must use different webhook ids.
