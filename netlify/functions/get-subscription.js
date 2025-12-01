'use strict';

/**
 * Get User Subscription
 * 
 * Returns the current user's subscription status and gem balance.
 * Requires user to be authenticated.
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // Get user ID from query params or body
    let userId;
    
    if (event.httpMethod === 'GET') {
      userId = event.queryStringParameters?.userId;
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      userId = body.userId;
    }

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get gem balance
    const { data: gemBalance, error: gemError } = await supabase
      .from('gem_balances')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Build response
    const response = {
      subscription: subscription || {
        plan_type: 'free',
        status: 'active',
        billing_period: null,
        current_period_end: null,
      },
      gems: gemBalance || {
        spendable_gems: 0,
        cashable_gems: 0,
        promo_gems: 0,
      },
      // Convenience fields
      plan: subscription?.plan_type || 'free',
      isActive: subscription?.status === 'active' || !subscription,
      isPro: subscription?.plan_type === 'host_pro',
      isAdFree: ['ad_free_plus', 'ad_free_premium'].includes(subscription?.plan_type),
      totalGems: (gemBalance?.spendable_gems || 0) + (gemBalance?.cashable_gems || 0),
      // Limits based on plan
      limits: getPlanLimits(subscription?.plan_type || 'free'),
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('❌ Error getting subscription:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get subscription',
        message: error.message 
      }),
    };
  }
};

/**
 * Get plan limits based on subscription type
 */
function getPlanLimits(planType) {
  switch (planType) {
    case 'host_pro':
      return {
        roomTimeMinutes: 180, // 3 hours
        canRecord: true,
        canCustomBrand: true,
        canChargeEntry: true, // Green Room
        showAds: true, // Still shows ads to non-paying viewers
        watermark: 'custom', // Can upload own logo
      };

    case 'ad_free_plus':
    case 'ad_free_premium':
      return {
        roomTimeMinutes: 60, // Same as free for hosting
        canRecord: false,
        canCustomBrand: false,
        canChargeEntry: false,
        showAds: false, // No ads for this user
        watermark: 'chatspheres',
      };

    case 'free':
    default:
      return {
        roomTimeMinutes: 60, // 60 minutes
        canRecord: false,
        canCustomBrand: false,
        canChargeEntry: false,
        showAds: true,
        watermark: 'chatspheres',
      };
  }
}
