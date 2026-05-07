# Deployment Checklist

This project runs in two billing modes:

- Local development with PayPal sandbox
- Production with PayPal live credentials on `https://www.imgcraftai.com`

## Local development

Use this in your local `.env`:

```bash
HOST=127.0.0.1
PORT=5173
BASE_URL=http://127.0.0.1:5173
DATABASE_FALLBACK_ON_ERROR=false

ADMIN_EMAILS=

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

BILLING_PROVIDER=paypal
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=...
PAYPAL_WEBHOOK_ID=2UH188855E6641627
PAYPAL_PORTAL_URL=https://www.paypal.com/myaccount/autopay/

SEEDREAM_API_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDREAM_API_KEY=...
```

## Production deployment

Use these values in Vercel or your production host:

```bash
BASE_URL=https://www.imgcraftai.com
DATABASE_URL=...
DATABASE_FALLBACK_ON_ERROR=false

ADMIN_EMAILS=ops@imgcraftai.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

BILLING_PROVIDER=paypal
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_PORTAL_URL=https://www.paypal.com/myaccount/autopay/

SEEDREAM_API_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDREAM_API_KEY=...
```

## PayPal webhook

Point the PayPal webhook to:

```text
https://www.imgcraftai.com/api/billing/webhook
```

Recommended subscription events:

- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.CREATED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
- `BILLING.SUBSCRIPTION.RE-ACTIVATED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.UPDATED`

## Notes

- Keep `PAYPAL_MODE=sandbox` only in local development or staging.
- Never reuse the sandbox `PAYPAL_WEBHOOK_ID` in production.
- Never point `PAYPAL_API_BASE_URL` or `PAYPAL_PORTAL_URL` at sandbox hosts in production.
- `PAYPAL_API_BASE_URL` can stay empty unless you need to override the default PayPal API host.
- The server requires `BASE_URL` to be an `https://` URL in production.

## Production check

After preparing a production env file, validate it locally with:

```bash
npm run check:prod -- --env-file .env.production.local
```

If the file passes, the server can initialize in production mode with those variables.

## Vercel flow

If you deploy on Vercel:

1. Link the project:

```bash
vercel link --project imgcraftai
```

2. Add production variables in the Vercel dashboard or with `vercel env add`.

3. Pull production envs locally for a dry run:

```bash
vercel env pull .env.production.local --environment=production --yes
```

4. Validate them:

```bash
npm run check:prod -- --env-file .env.production.local
```

5. Run the live verification after deploying:

```bash
npm run verify:prod -- --env-file .env.production.local
```

This verifies that:

- Production env values are real values, not placeholders.
- The production database can initialize.
- Public pages, `/api/me`, and a required static asset are reachable.
- Google OAuth start redirects to Google with the configured client id.
- PayPal live credentials can fetch the configured plan.

Use this while production DNS points to the deployed app. If you need to validate only local env and database before DNS is live:

```bash
npm run verify:prod -- --env-file .env.production.local --skip-network
```
