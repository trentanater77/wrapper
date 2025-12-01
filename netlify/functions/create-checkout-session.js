'use strict';

/**
 * Create Stripe Checkout Session
 * 
 * Creates a checkout session for subscription purchases.
 * User must be authenticated via Supabase.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Price IDs from environment variables
const PRICE_IDS = {
  host_pro_monthly: process.env.STRIPE_PRICE_HOST_PRO_MONTHLY,
  host_pro_yearly: process.env.STRIPE_PRICE_HOST_PRO_YEARLY,
  ad_free_premium_monthly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY,
  ad_free_premium_yearly: process.env.STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY,
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
    const { priceKey, userId, userEmail, successUrl, cancelUrl } = body;

    // Validate required fields
    if (!priceKey || !userId || !userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['priceKey', 'userId', 'userEmail']
        }),
      };
    }

    // Get the price ID
    const priceId = PRICE_IDS[priceKey];
    if (!priceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid price key',
          validKeys: Object.keys(PRICE_IDS)
        }),
      };
    }

    // Determine plan type from price key
    let planType = 'free';
    if (priceKey.includes('host_pro')) {
      planType = 'host_pro';
    } else if (priceKey.includes('ad_free_premium')) {
      planType = 'ad_free_premium';
    } else if (priceKey.includes('ad_free_plus')) {
      planType = 'ad_free_plus';
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // Store user info in metadata for webhook
      metadata: {
        user_id: userId,
        plan_type: planType,
      },
      customer_email: userEmail,
      success_url: successUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?success=true`,
      cancel_url: cancelUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/pricing.html?canceled=true`,
      // Allow promotion codes
      allow_promotion_codes: true,
    });

    console.log(`✅ Created checkout session for user ${userId}, plan: ${planType}`);

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
