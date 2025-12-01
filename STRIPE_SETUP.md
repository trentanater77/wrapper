# 💳 Stripe Subscription Setup Guide

This guide walks you through setting up Stripe subscriptions for ChatSpheres.

---

## ✅ Step 1: Get Your Stripe Price IDs

You already created the products. Now you need the **Price IDs**:

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Click on each product (Host Pro, Ad-Free Premium)
3. Find the **Price ID** (starts with `price_`)
4. Copy each Price ID

Example:
- Host Pro Monthly: `price_1ABC123...`
- Host Pro Yearly: `price_1DEF456...`
- Ad-Free Premium Monthly: `price_1GHI789...`
- Ad-Free Premium Yearly: `price_1JKL012...`

---

## ✅ Step 2: Add Environment Variables to Netlify

Go to **Netlify → Site Settings → Environment Variables** and add these:

### Stripe Keys
| Key | Value | Notes |
|-----|-------|-------|
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_51SWelu7BKCnIRZddmEB...` | Your publishable key |
| `STRIPE_SECRET_KEY` | `sk_test_51SWelu7BKCnIRZddl5V...` | Your secret key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Step 3 below |

### Price IDs
| Key | Value |
|-----|-------|
| `STRIPE_PRICE_HOST_PRO_MONTHLY` | Your price ID for Host Pro Monthly |
| `STRIPE_PRICE_HOST_PRO_YEARLY` | Your price ID for Host Pro Yearly |
| `STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY` | Your price ID for Ad-Free Premium Monthly |
| `STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY` | Your price ID for Ad-Free Premium Yearly |

---

## ✅ Step 3: Create Stripe Webhook

Webhooks tell your app when subscriptions are created, renewed, or canceled.

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **+ Add endpoint**
3. Enter your endpoint URL:
   ```
   https://sphere.chatspheres.com/.netlify/functions/stripe-webhook
   ```
4. Click **Select events** and add these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Click **Reveal** next to "Signing secret"
7. Copy the `whsec_...` value → Add to Netlify as `STRIPE_WEBHOOK_SECRET`

---

## ✅ Step 4: Create Supabase Tables

Run the SQL in your Supabase dashboard:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Click **SQL Editor** in the sidebar
4. Click **+ New query**
5. Copy the entire contents of `supabase/migrations/001_subscriptions.sql`
6. Paste it into the SQL editor
7. Click **Run**

You should see these tables created:
- `user_subscriptions`
- `gem_balances`
- `gem_transactions`
- `stripe_events`

---

## ✅ Step 5: Test the Flow

1. Deploy to Netlify (it will auto-deploy on push)
2. Go to `https://sphere.chatspheres.com/pricing`
3. Sign in
4. Click "Upgrade to Pro"
5. Use Stripe test card: `4242 4242 4242 4242`
6. Complete checkout
7. Check your Supabase `user_subscriptions` table - your subscription should appear!

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `netlify/functions/create-checkout-session.js` | Creates Stripe checkout sessions |
| `netlify/functions/stripe-webhook.js` | Handles Stripe events |
| `netlify/functions/get-subscription.js` | Returns user's subscription status |
| `pricing.html` | Pricing page UI |
| `supabase/migrations/001_subscriptions.sql` | Database tables |

---

## 🔒 Environment Variables Summary

Add ALL of these to Netlify:

```
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
STRIPE_PRICE_HOST_PRO_MONTHLY=price_YOUR_PRICE_ID
STRIPE_PRICE_HOST_PRO_YEARLY=price_YOUR_PRICE_ID
STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY=price_YOUR_PRICE_ID
STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY=price_YOUR_PRICE_ID
```

---

## 🚨 Troubleshooting

### "Invalid price key" error
→ You haven't set the `STRIPE_PRICE_*` environment variables in Netlify

### Webhook not working
→ Check the webhook secret is correct in `STRIPE_WEBHOOK_SECRET`
→ Check webhook endpoint URL is exactly: `https://sphere.chatspheres.com/.netlify/functions/stripe-webhook`

### Subscription not showing in Supabase
→ Check if the SQL tables were created (run the SQL in Step 4)
→ Check Netlify function logs for errors

---

## 📧 Need Help?

If you run into issues, check:
1. Netlify Functions logs (Site → Functions → View logs)
2. Stripe Dashboard → Events (see webhook attempts)
3. Supabase → Logs

Good luck! 🚀
