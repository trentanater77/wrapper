'use strict';

/**
 * Create Stripe Checkout Session
 * 
 * Creates a checkout session for:
 * - Subscription purchases (host_pro, ad_free_premium, pro_bundle)
 * - One-time gem pack purchases
 * 
 * User must be authenticated via Supabase.
 */

const https = require('https');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function loadGeneratedBillingConfig() {
  try {
    const mod = require('./_generated/function-config.js');
    return mod?.billing || {};
  } catch (_) {
    return {};
  }
}

// Validate Stripe configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not configured!');
}

// Warn if using test keys in production
const isTestMode = STRIPE_SECRET_KEY?.startsWith('sk_test_');
const isProduction = process.env.NODE_ENV === 'production' || 
                     process.env.CONTEXT === 'production' ||
                     !process.env.NETLIFY_DEV;

if (isTestMode && isProduction) {
  console.warn('⚠️ WARNING: Using Stripe TEST keys in production environment!');
  console.warn('⚠️ Payments will not be real. Update to live keys for production.');
}

const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SQUARE_ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

function getSquareApiBaseUrl() {
  return SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

function squareRequest({ path, method, body }) {
  return new Promise((resolve, reject) => {
    const baseUrl = getSquareApiBaseUrl();
    const url = `${baseUrl}${path}`;

    if (!SQUARE_ACCESS_TOKEN) {
      reject(new Error('SQUARE_ACCESS_TOKEN not configured'));
      return;
    }

    const payload = body ? JSON.stringify(body) : '';

    if (typeof fetch === 'function') {
      fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
        body: payload,
      })
        .then(async (resp) => {
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square error (${resp.status})`;
            throw new Error(message);
          }
          return data;
        })
        .then(resolve)
        .catch(reject);
      return;
    }

    const req = https.request(
      url,
      {
        method,
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (e) {
            reject(e);
            return;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square error (${res.statusCode})`;
            reject(new Error(message));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Subscription Price IDs from environment variables
const GENERATED_BILLING = loadGeneratedBillingConfig();
const GENERATED_STRIPE_PRICES = GENERATED_BILLING.stripePrices || {};
const GENERATED_SQUARE_ITEMVARS = GENERATED_BILLING.squareItemVariations || {};
const GENERATED_SQUARE_PLANVARS = GENERATED_BILLING.squarePlanVariations || {};

const SUBSCRIPTION_PRICE_IDS = {
  host_pro_monthly: process.env.STRIPE_PRICE_HOST_PRO_MONTHLY || GENERATED_STRIPE_PRICES.host_pro_monthly,
  host_pro_yearly: process.env.STRIPE_PRICE_HOST_PRO_YEARLY || GENERATED_STRIPE_PRICES.host_pro_yearly,
  ad_free_plus_monthly: process.env.STRIPE_PRICE_AD_FREE_PLUS_MONTHLY || GENERATED_STRIPE_PRICES.ad_free_plus_monthly,
  ad_free_plus_yearly: process.env.STRIPE_PRICE_AD_FREE_PLUS_YEARLY || GENERATED_STRIPE_PRICES.ad_free_plus_yearly,
  ad_free_premium_monthly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY || GENERATED_STRIPE_PRICES.ad_free_premium_monthly,
  ad_free_premium_yearly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY || GENERATED_STRIPE_PRICES.ad_free_premium_yearly,
  pro_bundle_monthly: process.env.STRIPE_PRICE_PRO_BUNDLE_MONTHLY || GENERATED_STRIPE_PRICES.pro_bundle_monthly,
  pro_bundle_yearly: process.env.STRIPE_PRICE_PRO_BUNDLE_YEARLY || GENERATED_STRIPE_PRICES.pro_bundle_yearly,
};

// Gem Pack definitions with price IDs from environment variables
const GEM_PACKS = {
  taste_test: { 
    gems: 150, 
    name: 'Taste Test',
    priceId: process.env.STRIPE_PRICE_GEM_TASTE_TEST || GENERATED_STRIPE_PRICES.gem_taste_test,
    squareItemVariationId: process.env.SQUARE_ITEMVAR_GEM_TASTE_TEST || GENERATED_SQUARE_ITEMVARS.gem_taste_test,
  },
  handful: { 
    gems: 500, 
    name: 'Handful',
    priceId: process.env.STRIPE_PRICE_GEM_HANDFUL || GENERATED_STRIPE_PRICES.gem_handful,
    squareItemVariationId: process.env.SQUARE_ITEMVAR_GEM_HANDFUL || GENERATED_SQUARE_ITEMVARS.gem_handful,
  },
  sack: { 
    gems: 1100, 
    name: 'Sack',
    priceId: process.env.STRIPE_PRICE_GEM_SACK || GENERATED_STRIPE_PRICES.gem_sack,
    squareItemVariationId: process.env.SQUARE_ITEMVAR_GEM_SACK || GENERATED_SQUARE_ITEMVARS.gem_sack,
  },
  chest: { 
    gems: 2500, 
    name: 'Chest',
    priceId: process.env.STRIPE_PRICE_GEM_CHEST || GENERATED_STRIPE_PRICES.gem_chest,
    squareItemVariationId: process.env.SQUARE_ITEMVAR_GEM_CHEST || GENERATED_SQUARE_ITEMVARS.gem_chest,
  },
  vault: { 
    gems: 7000, 
    name: 'Vault',
    priceId: process.env.STRIPE_PRICE_GEM_VAULT || GENERATED_STRIPE_PRICES.gem_vault,
    squareItemVariationId: process.env.SQUARE_ITEMVAR_GEM_VAULT || GENERATED_SQUARE_ITEMVARS.gem_vault,
  },
};

const SQUARE_SUBSCRIPTION_PLAN_VARIATION_IDS = {
  host_pro_monthly: process.env.SQUARE_PLANVAR_HOST_PRO_MONTHLY || process.env.SQUARE_PLAN_HOST_PRO_MONTHLY || GENERATED_SQUARE_PLANVARS.host_pro_monthly,
  host_pro_yearly: process.env.SQUARE_PLANVAR_HOST_PRO_YEARLY || process.env.SQUARE_PLAN_HOST_PRO_YEARLY || GENERATED_SQUARE_PLANVARS.host_pro_yearly,
  ad_free_plus_monthly: process.env.SQUARE_PLANVAR_AD_FREE_PLUS_MONTHLY || process.env.SQUARE_PLAN_AD_FREE_PLUS_MONTHLY || GENERATED_SQUARE_PLANVARS.ad_free_plus_monthly,
  ad_free_plus_yearly: process.env.SQUARE_PLANVAR_AD_FREE_PLUS_YEARLY || process.env.SQUARE_PLAN_AD_FREE_PLUS_YEARLY || GENERATED_SQUARE_PLANVARS.ad_free_plus_yearly,
  ad_free_premium_monthly: process.env.SQUARE_PLANVAR_AD_FREE_PREMIUM_MONTHLY || process.env.SQUARE_PLAN_AD_FREE_PREMIUM_MONTHLY || GENERATED_SQUARE_PLANVARS.ad_free_premium_monthly,
  ad_free_premium_yearly: process.env.SQUARE_PLANVAR_AD_FREE_PREMIUM_YEARLY || process.env.SQUARE_PLAN_AD_FREE_PREMIUM_YEARLY || GENERATED_SQUARE_PLANVARS.ad_free_premium_yearly,
  pro_bundle_monthly: process.env.SQUARE_PLANVAR_PRO_BUNDLE_MONTHLY || process.env.SQUARE_PLAN_PRO_BUNDLE_MONTHLY || GENERATED_SQUARE_PLANVARS.pro_bundle_monthly,
  pro_bundle_yearly: process.env.SQUARE_PLANVAR_PRO_BUNDLE_YEARLY || process.env.SQUARE_PLAN_PRO_BUNDLE_YEARLY || GENERATED_SQUARE_PLANVARS.pro_bundle_yearly,
};

const SQUARE_SUBSCRIPTION_PRICE_MONEY = {
  host_pro_monthly: { amount: 1999, currency: 'USD' },
  host_pro_yearly: { amount: 17991, currency: 'USD' },
  ad_free_plus_monthly: { amount: 499, currency: 'USD' },
  ad_free_plus_yearly: { amount: 4999, currency: 'USD' },
  ad_free_premium_monthly: { amount: 999, currency: 'USD' },
  ad_free_premium_yearly: { amount: 10136, currency: 'USD' },
  pro_bundle_monthly: { amount: 2499, currency: 'USD' },
  pro_bundle_yearly: { amount: 21999, currency: 'USD' },
};

function getPlanTypeFromPriceKey(priceKey) {
  if (!priceKey) return 'free';
  if (priceKey.includes('pro_bundle')) return 'pro_bundle';
  if (priceKey.includes('host_pro')) return 'host_pro';
  if (priceKey.includes('ad_free_premium')) return 'ad_free_premium';
  if (priceKey.includes('ad_free_plus')) return 'ad_free_plus';
  return 'free';
}

function getBillingPeriodFromPriceKey(priceKey) {
  if (!priceKey) return null;
  if (priceKey.endsWith('_yearly')) return 'yearly';
  if (priceKey.endsWith('_monthly')) return 'monthly';
  return null;
}

async function createSquareGemPaymentLink({ userId, gemPackKey, userEmail, successUrl }) {
  if (!SQUARE_LOCATION_ID) {
    throw new Error('SQUARE_LOCATION_ID not configured');
  }

  const gemPack = GEM_PACKS[gemPackKey];
  if (!gemPack) {
    throw new Error('Invalid gem pack key');
  }

  if (!gemPack.squareItemVariationId) {
    throw new Error(`Square gem pack variation not configured for ${gemPackKey}`);
  }

  const idempotencyKey = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

  const resp = await squareRequest({
    path: '/v2/online-checkout/payment-links',
    method: 'POST',
    body: {
      idempotency_key: idempotencyKey,
      order: {
        location_id: SQUARE_LOCATION_ID,
        line_items: [
          {
            quantity: '1',
            catalog_object_id: gemPack.squareItemVariationId,
          },
        ],
      },
      checkout_options: {
        redirect_url: successUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?success=true`,
      },
    },
  });

  const paymentLinkId = resp?.payment_link?.id;
  const orderId = resp?.payment_link?.order_id;
  const url = resp?.payment_link?.url || resp?.payment_link?.long_url;

  if (!paymentLinkId || !orderId || !url) {
    throw new Error('Square did not return a valid payment link');
  }

  const { error: insertError } = await supabase
    .from('square_pending_gem_purchases')
    .insert({
      user_id: userId,
      gem_pack_key: gemPackKey,
      gems: gemPack.gems,
      square_payment_link_id: paymentLinkId,
      square_order_id: orderId,
      idempotency_key: idempotencyKey,
    });

  if (insertError) {
    console.error('❌ Error creating pending Square gem purchase:', insertError);
    throw insertError;
  }

  console.log(`✅ Created Square gem pack payment link for user ${userId} pack=${gemPackKey} order=${orderId}`);
  if (userEmail) {
    console.log(`   buyer_email (not prefilled): ${userEmail}`);
  }

  return { url, orderId, paymentLinkId };
}

async function createSquareSubscriptionPaymentLink({ userId, priceKey, userEmail, successUrl }) {
  if (!SQUARE_LOCATION_ID) {
    throw new Error('SQUARE_LOCATION_ID not configured');
  }

  const planVariationId = SQUARE_SUBSCRIPTION_PLAN_VARIATION_IDS[priceKey];
  if (!planVariationId) {
    throw new Error(`Square subscription plan variation not configured for ${priceKey}`);
  }

  const priceMoney = SQUARE_SUBSCRIPTION_PRICE_MONEY[priceKey];
  if (!priceMoney) {
    throw new Error(`Square subscription price not configured for ${priceKey}`);
  }

  const planType = getPlanTypeFromPriceKey(priceKey);
  const billingPeriod = getBillingPeriodFromPriceKey(priceKey);
  const idempotencyKey = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

  const resp = await squareRequest({
    path: '/v2/online-checkout/payment-links',
    method: 'POST',
    body: {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: `${planType}_${billingPeriod || 'subscription'}`,
        price_money: priceMoney,
        location_id: SQUARE_LOCATION_ID,
      },
      subscription_plan_id: planVariationId,
      checkout_options: {
        redirect_url: successUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?success=true`,
      },
      pre_populated_data: {
        buyer_email: userEmail,
      },
    },
  });

  const paymentLinkId = resp?.payment_link?.id;
  const orderId = resp?.payment_link?.order_id;
  const url = resp?.payment_link?.url || resp?.payment_link?.long_url;

  if (!paymentLinkId || !orderId || !url) {
    throw new Error('Square did not return a valid payment link');
  }

  const { error: insertError } = await supabase
    .from('square_pending_subscriptions')
    .insert({
      user_id: userId,
      plan_type: planType,
      billing_period: billingPeriod,
      square_plan_variation_id: planVariationId,
      square_payment_link_id: paymentLinkId,
      square_order_id: orderId,
      idempotency_key: idempotencyKey,
    });

  if (insertError) {
    console.error('❌ Error creating pending Square subscription:', insertError);
    throw insertError;
  }

  console.log(`✅ Created Square subscription payment link for user ${userId} plan=${planType} period=${billingPeriod} order=${orderId}`);

  return { url, orderId, paymentLinkId };
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      priceKey,      // For subscriptions (e.g., 'host_pro_monthly')
      gemPackKey,    // For gem packs (e.g., 'taste_test', 'handful')
      mode,          // 'subscription' or 'payment'
      userId, 
      userEmail, 
      successUrl, 
      cancelUrl,
      metadata       // Optional additional metadata
    } = body;

    const gemsProvider = (process.env.GEMS_BILLING_PROVIDER || 'stripe').trim().toLowerCase();
    const subscriptionProvider = (process.env.SUBSCRIPTION_BILLING_PROVIDER || 'stripe').trim().toLowerCase();

    console.log('🔧 billing providers', {
      context: process.env.CONTEXT,
      gemsProvider,
      subscriptionProvider,
      hasGemPackKey: Boolean(gemPackKey),
      hasPriceKey: Boolean(priceKey),
    });

    // Validate required fields
    if (!userId || !userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['userId', 'userEmail', 'priceKey or gemPackKey']
        }),
      };
    }

    if (priceKey && subscriptionProvider === 'square') {
      console.log('➡️ routing to Square subscription checkout', { priceKey });
      const result = await createSquareSubscriptionPaymentLink({
        userId,
        priceKey,
        userEmail,
        successUrl,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          url: result.url,
        }),
      };
    }

    // Must have either priceKey (subscription) or gemPackKey (one-time gem purchase)
    if (!priceKey && !gemPackKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Must provide either priceKey (for subscriptions) or gemPackKey (for gem purchases)'
        }),
      };
    }

    // If this is a gem pack purchase and Square is selected, route to Square.
    if (gemPackKey && gemsProvider === 'square') {
      console.log('➡️ routing to Square gem checkout', { gemPackKey });
      const result = await createSquareGemPaymentLink({
        userId,
        gemPackKey,
        userEmail,
        successUrl,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          url: result.url,
        }),
      };
    }

    let finalPriceId;
    let checkoutMode = mode || (priceKey ? 'subscription' : 'payment');
    let sessionMetadata = { user_id: userId };

    // Only create Stripe session for non-Square flows
    if (!stripe) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Stripe not configured on server',
        }),
      };
    }

    // Handle subscription purchase (using priceKey)
    if (priceKey) {
      finalPriceId = SUBSCRIPTION_PRICE_IDS[priceKey];
      if (!finalPriceId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Invalid price key',
            validKeys: Object.keys(SUBSCRIPTION_PRICE_IDS)
          }),
        };
      }

      // Determine plan type from price key
      const planType = getPlanTypeFromPriceKey(priceKey);

      sessionMetadata.plan_type = planType;
      checkoutMode = 'subscription';
    }
    
    // Handle one-time gem purchase (using gemPackKey)
    if (gemPackKey) {
      // Validate it's a known gem pack key
      const gemPack = GEM_PACKS[gemPackKey];
      if (!gemPack) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Invalid gem pack key',
            validKeys: Object.keys(GEM_PACKS)
          }),
        };
      }

      // Check that the price ID is configured
      if (!gemPack.priceId) {
        console.error(`❌ Missing price ID for gem pack: ${gemPackKey}`);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Gem pack price not configured',
            message: `STRIPE_PRICE_GEM_${gemPackKey.toUpperCase()} environment variable is not set`
          }),
        };
      }

      finalPriceId = gemPack.priceId;
      checkoutMode = 'payment'; // One-time payment
      sessionMetadata.type = 'gem_purchase';
      sessionMetadata.gems = gemPack.gems;
      sessionMetadata.pack_name = gemPack.name;

      // Merge any additional metadata from request
      if (metadata) {
        sessionMetadata = { ...sessionMetadata, ...metadata };
      }
    }

    // Create Stripe checkout session
    const sessionConfig = {
      payment_method_types: ['card'],
      mode: checkoutMode,
      line_items: [
        {
          price: finalPriceId,
          quantity: 1,
        },
      ],
      metadata: sessionMetadata,
      customer_email: userEmail,
      success_url: successUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?success=true`,
      cancel_url: cancelUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?canceled=true`,
      allow_promotion_codes: true,
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);

    const logType = checkoutMode === 'payment' ? 'gem purchase' : 'subscription';
    console.log(`✅ Created ${logType} checkout session for user ${userId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url,
      }),
    };

  } catch (error) {
    console.error('❌ Checkout session error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create checkout session',
        message: error.message 
      }),
    };
  }
};
