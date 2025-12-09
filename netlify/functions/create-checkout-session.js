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

const stripe = require('stripe')(STRIPE_SECRET_KEY);

// Subscription Price IDs from environment variables
const SUBSCRIPTION_PRICE_IDS = {
  host_pro_monthly: process.env.STRIPE_PRICE_HOST_PRO_MONTHLY,
  host_pro_yearly: process.env.STRIPE_PRICE_HOST_PRO_YEARLY,
  ad_free_premium_monthly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY,
  ad_free_premium_yearly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY,
  pro_bundle_monthly: process.env.STRIPE_PRICE_PRO_BUNDLE_MONTHLY,
  pro_bundle_yearly: process.env.STRIPE_PRICE_PRO_BUNDLE_YEARLY,
};

// Gem Pack definitions with price IDs from environment variables
const GEM_PACKS = {
  taste_test: { 
    gems: 150, 
    name: 'Taste Test',
    priceId: process.env.STRIPE_PRICE_GEM_TASTE_TEST
  },
  handful: { 
    gems: 500, 
    name: 'Handful',
    priceId: process.env.STRIPE_PRICE_GEM_HANDFUL
  },
  sack: { 
    gems: 1100, 
    name: 'Sack',
    priceId: process.env.STRIPE_PRICE_GEM_SACK
  },
  chest: { 
    gems: 2500, 
    name: 'Chest',
    priceId: process.env.STRIPE_PRICE_GEM_CHEST
  },
  vault: { 
    gems: 7000, 
    name: 'Vault',
    priceId: process.env.STRIPE_PRICE_GEM_VAULT
  },
};

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

    let finalPriceId;
    let checkoutMode = mode || 'subscription';
    let sessionMetadata = { user_id: userId };

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
      let planType = 'free';
      if (priceKey.includes('pro_bundle')) {
        planType = 'pro_bundle';
      } else if (priceKey.includes('host_pro')) {
        planType = 'host_pro';
      } else if (priceKey.includes('ad_free_premium')) {
        planType = 'ad_free_premium';
      } else if (priceKey.includes('ad_free_plus')) {
        planType = 'ad_free_plus';
      }

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
      mode: checkoutMode,
      payment_method_types: ['card'],
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
