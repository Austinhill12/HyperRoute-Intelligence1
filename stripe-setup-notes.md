# HyperRoute Stripe Production Billing Setup

## Supabase secrets needed

Set these in Supabase Edge Function secrets:

```text
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_from_stripe_webhook
APP_URL=https://your-live-hyperroute-domain.com
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_BUSINESS=price_...
```

Supabase normally provides these automatically to Edge Functions:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

## Stripe products/prices

Create recurring monthly prices in Stripe:

- Starter: 99 USD/month
- Professional: 199 USD/month
- Business: 399 USD/month

Copy each Stripe `price_...` ID into the matching Supabase secret.

## Edge Functions to deploy

Deploy:

```text
create-checkout-session
stripe-webhook
```

The browser calls `create-checkout-session`.
Stripe calls `stripe-webhook`.

## Stripe webhook endpoint

After deploying the webhook function, add its URL in Stripe:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Listen for these events:

```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

## Expected flow

1. Customer opens Subscription page.
2. Customer selects Starter, Professional, or Business.
3. HyperRoute calls the Supabase Edge Function.
4. Edge Function creates a Stripe Checkout Session.
5. Customer pays in Stripe Checkout.
6. Stripe webhook updates `company_subscriptions`.
7. Subscription becomes `active` and payment setup becomes `auto_billing_ready`.
