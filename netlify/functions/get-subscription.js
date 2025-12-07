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

    // Get user profile (badge & branding)
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get main profile (display_name, bio, avatar)
    const { data: mainProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get pending payout requests
    const { data: pendingPayouts } = await supabase
      .from('payout_requests')
      .select('id, gems_amount, usd_amount, status, requested_at')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: false });

    // Calculate cashable balance and payout eligibility
    const cashableGems = gemBalance?.cashable_gems || 0;
    const minPayoutGems = 500; // 500 gems = $4.95 minimum
    const canRequestPayout = cashableGems >= minPayoutGems && (!pendingPayouts || pendingPayouts.length === 0);
    const cashableUsd = Math.round((cashableGems / 100) * 0.99 * 100) / 100;

    // Determine badge based on plan (auto-assign if not set or set to 'none')
    const planType = subscription?.plan_type || 'free';
    const autoBadge = getBadgeForPlan(planType);
    // Use auto-badge if user profile badge is not set or is 'none'
    const profileBadge = userProfile?.badge_type;
    const badgeType = (profileBadge && profileBadge !== 'none') ? profileBadge : autoBadge;
    const badgeVisible = userProfile?.badge_visible !== false;

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
        pending_referral_gems: 0,
      },
      // Main Profile (from profiles table)
      mainProfile: {
        username: mainProfile?.username || null,
        displayName: mainProfile?.display_name || null,
        bio: mainProfile?.bio || null,
        avatarUrl: mainProfile?.avatar_url || null,
      },
      // Branding Profile (from user_profiles table)
      profile: {
        displayName: userProfile?.display_name || mainProfile?.display_name || null,
        bio: userProfile?.bio || mainProfile?.bio || null,
        customLogoUrl: userProfile?.custom_logo_url || null,
        logoUpdatedAt: userProfile?.logo_updated_at || null,
      },
      // Badge info
      badge: {
        type: badgeVisible ? badgeType : 'none',
        visible: badgeVisible,
        emoji: getBadgeEmoji(badgeType),
        label: getBadgeLabel(badgeType),
        color: getBadgeColor(badgeType),
      },
      // Payout info
      payout: {
        cashableGems,
        cashableUsd,
        minPayoutGems,
        minPayoutUsd: 4.95,
        canRequestPayout,
        pendingRequests: pendingPayouts || [],
        payoutEmail: gemBalance?.payout_email || null,
        payoutMethod: gemBalance?.payout_method || 'paypal',
      },
      // Convenience fields
      plan: planType,
      isActive: subscription?.status === 'active' || !subscription,
      isPro: planType === 'host_pro' || planType === 'pro_bundle',
      isAdFree: ['ad_free_plus', 'ad_free_premium', 'pro_bundle'].includes(planType),
      isBundle: planType === 'pro_bundle',
      totalGems: (gemBalance?.spendable_gems || 0) + (gemBalance?.cashable_gems || 0),
      // Limits based on plan
      limits: getPlanLimits(planType),
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
 * Get badge type based on plan
 */
function getBadgeForPlan(planType) {
  switch (planType) {
    case 'pro_bundle': return 'bundle';
    case 'host_pro': return 'pro';
    case 'ad_free_premium': return 'premium';
    case 'ad_free_plus': return 'premium';
    default: return 'none';
  }
}

/**
 * Get badge emoji
 */
function getBadgeEmoji(badgeType) {
  switch (badgeType) {
    case 'bundle': return '👑';
    case 'pro': return '⭐';
    case 'premium': return '💎';
    case 'verified': return '✓';
    case 'og': return '🏆';
    default: return '';
  }
}

/**
 * Get badge label
 */
function getBadgeLabel(badgeType) {
  switch (badgeType) {
    case 'bundle': return 'Pro Bundle';
    case 'pro': return 'Host Pro';
    case 'premium': return 'Premium';
    case 'verified': return 'Verified';
    case 'og': return 'OG';
    default: return '';
  }
}

/**
 * Get badge color (CSS color value)
 */
function getBadgeColor(badgeType) {
  switch (badgeType) {
    case 'bundle': return '#FFD166';   // Gold crown
    case 'pro': return '#FFD166';      // Gold star  
    case 'premium': return '#a855f7';  // Purple diamond
    case 'verified': return '#22c55e'; // Green check
    case 'og': return '#e63946';       // Red trophy
    default: return '#6b7280';         // Gray
  }
}

/**
 * Get plan limits based on subscription type
 */
function getPlanLimits(planType) {
  switch (planType) {
    case 'pro_bundle':
      return {
        roomTimeMinutes: 180, // 3 hours
        canRecord: true,
        canCustomBrand: true,
        canChargeEntry: true, // Green Room
        showAds: false, // No ads (has Ad-Free)
        watermark: 'custom', // Can upload own logo
        monthlyGems: 1200, // From Ad-Free Premium
        // Forum limits
        canCreatePrivateForums: true,
        canCustomizeForumBranding: true,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };

    case 'host_pro':
      return {
        roomTimeMinutes: 180, // 3 hours
        canRecord: true,
        canCustomBrand: true,
        canChargeEntry: true, // Green Room
        showAds: true, // Still shows ads to non-paying viewers
        watermark: 'custom', // Can upload own logo
        monthlyGems: 0,
        // Forum limits
        canCreatePrivateForums: true,
        canCustomizeForumBranding: true,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
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
        monthlyGems: planType === 'ad_free_premium' ? 1200 : 500,
        // Forum limits
        canCreatePrivateForums: false,
        canCustomizeForumBranding: false,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
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
        monthlyGems: 0,
        // Forum limits
        canCreatePrivateForums: false,
        canCustomizeForumBranding: false,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };
  }
}
