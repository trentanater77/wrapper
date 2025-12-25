# 🚀 Stripe: Going Live Checklist

## Overview
This document helps you switch from Stripe **Test Mode** (sandbox) to **Live Mode** (real payments).

Note: This repo can route billing through **Square and/or Stripe** depending on Netlify environment variables:

```
SUBSCRIPTION_BILLING_PROVIDER=square|stripe
GEMS_BILLING_PROVIDER=square|stripe
```

If you are using **Square** for subscriptions and gem purchases, you do not need to complete this Stripe checklist.

Creator payouts are manual and do not use Stripe Connect.

---

## Step 1: Complete Stripe Account Activation

1. Log into [dashboard.stripe.com](https://dashboard.stripe.com)
2. Click **"Activate your account"** (or Settings → Account details)
3. Complete the required information:

### Required Information:
- [ ] **Business Type**: Individual / Sole proprietor (simplest)
- [ ] **Legal Name**: Your full legal name
- [ ] **Date of Birth**: Your DOB
- [ ] **Last 4 of SSN**: For US accounts (or equivalent for other countries)
- [ ] **Home Address**: Where you live (used for verification)
- [ ] **Phone Number**: For account recovery

### Banking Information:
- [ ] **Bank Account Number**: Where payouts will go
- [ ] **Routing Number**: Your bank's routing number
- [ ] **Account Holder Name**: Name on the bank account

---

## Step 2: Get Live API Keys

1. In Stripe Dashboard, toggle **"Test mode"** to **OFF** (top right corner)
2. Go to **Developers → API Keys**
3. Copy your keys:
   - **Publishable key**: `pk_live_...` (safe for frontend)
   - **Secret key**: `sk_live_...` (keep secret!)

---

## Step 3: Create Live Webhook Endpoint

1. Go to **Developers → Webhooks**
2. Click **"Add endpoint"**
3. Configure:
   - **URL**: `https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook`
   - **Events to send**:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
4. Click **"Add endpoint"**
5. Copy the **Signing secret**: `whsec_...`

---

## Step 4: Create Live Price IDs

Your test price IDs won't work in live mode. Create new ones:

### For Subscriptions:
1. Go to **Products** → **Add product**
2. Create each subscription:
   - **Host Pro Monthly**: $9.99/month
   - **Host Pro Yearly**: $99.99/year
   - **Ad-Free Premium Monthly**: $4.99/month
   - **Ad-Free Premium Yearly**: $49.99/year
   - **Pro Bundle Monthly**: $12.99/month
   - **Pro Bundle Yearly**: $129.99/year

3. Copy each **Price ID** (starts with `price_`)

### For Gem Packs:
1. Create one-time payment products:
   - **Taste Test**: $1.99 (150 gems)
   - **Handful**: $4.99 (500 gems)
   - **Sack**: $9.99 (1100 gems)
   - **Chest**: $19.99 (2500 gems)
   - **Vault**: $49.99 (7000 gems)

2. Copy each **Price ID**

---

## Step 5: Update Environment Variables

In **Netlify Dashboard** → **Site settings** → **Environment variables**:

### Required Updates:
```
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

### Subscription Price IDs:
```
STRIPE_PRICE_HOST_PRO_MONTHLY=price_xxxxxx
STRIPE_PRICE_HOST_PRO_YEARLY=price_xxxxxx
STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY=price_xxxxxx
STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY=price_xxxxxx
STRIPE_PRICE_PRO_BUNDLE_MONTHLY=price_xxxxxx
STRIPE_PRICE_PRO_BUNDLE_YEARLY=price_xxxxxx
```

### Gem Pack Price IDs:
```
STRIPE_PRICE_GEM_TASTE_TEST=price_xxxxxx
STRIPE_PRICE_GEM_HANDFUL=price_xxxxxx
STRIPE_PRICE_GEM_SACK=price_xxxxxx
STRIPE_PRICE_GEM_CHEST=price_xxxxxx
STRIPE_PRICE_GEM_VAULT=price_xxxxxx
```

---

## Step 6: Redeploy

After updating environment variables:
1. Go to **Netlify Dashboard** → **Deploys**
2. Click **"Trigger deploy"** → **"Deploy site"**

---

## Step 7: Test Live Mode

1. Make a **real purchase** with a real card (can refund immediately)
2. Verify:
   - [ ] Checkout completes successfully
   - [ ] Webhook receives the event
   - [ ] Database is updated
   - [ ] Gems/subscription is applied

---

## Payout Schedule

- **First payout**: 7-14 days after first successful charge
- **After established**: 2-day rolling payouts
- **Minimum payout**: $0.50 (automatic, no minimum to set up)

---

## Important Notes

### Keep Test Keys for Development
Don't delete your test keys! Use them for local development:
```bash
# Local development (.env.local)
STRIPE_SECRET_KEY=sk_test_xxxxx

# Production (Netlify env vars)
STRIPE_SECRET_KEY=sk_live_xxxxx
```

### Monitor for Issues
- Check **Stripe Dashboard → Payments** for failed charges
- Check **Netlify Functions** logs for webhook errors
- Set up Stripe email notifications for disputes/chargebacks

### Refunds
- Full refunds: Stripe Dashboard → Payments → Click payment → Refund
- Partial refunds: Same process, enter amount
- Refund policy: Update your Terms of Service!

---

## Checklist Summary

- [ ] Stripe account activated
- [ ] Live API keys obtained
- [ ] Live webhook endpoint created
- [ ] Live price IDs created
- [ ] Environment variables updated
- [ ] Site redeployed
- [ ] Test purchase completed
- [ ] Webhook working
- [ ] Payout account verified

---

## Need Help?

- **Stripe Docs**: https://stripe.com/docs
- **Stripe Support**: https://support.stripe.com
- **Webhook Testing**: Use Stripe CLI for local testing

Good luck! 🎉
