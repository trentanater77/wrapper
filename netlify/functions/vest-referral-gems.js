'use strict';

/**
 * Vest Referral Gems - Automated Time-Based Vesting
 * 
 * This function checks for referral gems that should be vested based on:
 * 1. Time passed (30+ days since referral activation)
 * 2. Activity level (referred user has 5+ conversations)
 * 
 * Can be called:
 * - Manually by admin
 * - Via scheduled cron job (e.g., daily)
 * - When a user logs in (to check their specific referrals)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

// Vesting requirements
const VESTING_REQUIREMENTS = {
  DAYS_REQUIRED: 30,
  CHATS_REQUIRED: 5,
};

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const { userId, checkAll } = params;

    let result;

    if (checkAll === 'true') {
      // Admin function: vest all eligible referrals
      result = await vestAllEligible();
    } else if (userId) {
      // Check specific user's referrals
      result = await vestUserReferrals(userId);
    } else {
      // Default: vest all eligible
      result = await vestAllEligible();
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('❌ Vest referral gems error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to vest referral gems',
        message: error.message 
      }),
    };
  }
};

/**
 * Vest all eligible referrals (for cron job or admin)
 */
async function vestAllEligible() {
  console.log('🔍 Checking for referrals eligible for time-based vesting...');
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - VESTING_REQUIREMENTS.DAYS_REQUIRED);
  
  // Find referrals that:
  // 1. Are rewarded but not vested
  // 2. Were activated more than 30 days ago
  const { data: eligibleReferrals, error: fetchError } = await supabase
    .from('referrals')
    .select(`
      id,
      referrer_user_id,
      referred_user_id,
      gems_awarded_referrer,
      updated_at,
      status
    `)
    .eq('status', 'rewarded')
    .eq('vested', false)
    .lt('updated_at', cutoffDate.toISOString());

  if (fetchError) {
    console.error('Error fetching referrals:', fetchError);
    throw fetchError;
  }

  if (!eligibleReferrals || eligibleReferrals.length === 0) {
    console.log('No referrals eligible for time-based vesting');
    return { success: true, vestedCount: 0, message: 'No eligible referrals found' };
  }

  console.log(`Found ${eligibleReferrals.length} referrals to check for activity requirement`);

  let vestedCount = 0;
  const vestedDetails = [];

  for (const referral of eligibleReferrals) {
    // Check if referred user has enough activity
    const { data: profile } = await supabase
      .from('profiles')
      .select('conversation_count')
      .eq('user_id', referral.referred_user_id)
      .single();

    const conversationCount = profile?.conversation_count || 0;

    if (conversationCount >= VESTING_REQUIREMENTS.CHATS_REQUIRED) {
      // Vest these gems!
      const result = await vestGems(
        referral.referrer_user_id,
        referral.referred_user_id,
        referral.gems_awarded_referrer,
        referral.id,
        `Time-based: 30+ days and ${conversationCount} conversations`
      );

      if (result.success) {
        vestedCount++;
        vestedDetails.push({
          referrerId: referral.referrer_user_id,
          gemsVested: referral.gems_awarded_referrer,
        });
      }
    } else {
      console.log(`Referral ${referral.id}: Only ${conversationCount}/${VESTING_REQUIREMENTS.CHATS_REQUIRED} conversations, skipping`);
    }
  }

  console.log(`✅ Vested ${vestedCount} referrals`);
  return { 
    success: true, 
    vestedCount, 
    details: vestedDetails,
    message: `Vested ${vestedCount} referrals` 
  };
}

/**
 * Vest referrals for a specific user (for login check)
 */
async function vestUserReferrals(userId) {
  console.log(`🔍 Checking referrals for user ${userId}...`);
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - VESTING_REQUIREMENTS.DAYS_REQUIRED);
  
  // Find this user's un-vested referrals that are old enough
  const { data: referrals, error: fetchError } = await supabase
    .from('referrals')
    .select(`
      id,
      referred_user_id,
      gems_awarded_referrer,
      updated_at
    `)
    .eq('referrer_user_id', userId)
    .eq('status', 'rewarded')
    .eq('vested', false)
    .lt('updated_at', cutoffDate.toISOString());

  if (fetchError) {
    console.error('Error fetching user referrals:', fetchError);
    throw fetchError;
  }

  if (!referrals || referrals.length === 0) {
    return { success: true, vestedCount: 0 };
  }

  let vestedCount = 0;
  let totalGemsVested = 0;

  for (const referral of referrals) {
    // Check activity of referred user
    const { data: profile } = await supabase
      .from('profiles')
      .select('conversation_count')
      .eq('user_id', referral.referred_user_id)
      .single();

    if ((profile?.conversation_count || 0) >= VESTING_REQUIREMENTS.CHATS_REQUIRED) {
      const result = await vestGems(
        userId,
        referral.referred_user_id,
        referral.gems_awarded_referrer,
        referral.id,
        `Time-based vesting: 30+ days active`
      );

      if (result.success) {
        vestedCount++;
        totalGemsVested += referral.gems_awarded_referrer;
      }
    }
  }

  return { 
    success: true, 
    vestedCount, 
    totalGemsVested 
  };
}

/**
 * Vest gems for a specific referral
 */
async function vestGems(referrerUserId, referredUserId, gemsAmount, referralId, reason) {
  console.log(`🔓 Vesting ${gemsAmount} gems for user ${referrerUserId}...`);

  // Get current balance
  const { data: balance, error: fetchError } = await supabase
    .from('gem_balances')
    .select('*')
    .eq('user_id', referrerUserId)
    .single();

  if (fetchError || !balance) {
    console.error('No balance found for user');
    return { success: false };
  }

  // Move gems from pending to cashable
  const newPending = Math.max(0, (balance.pending_referral_gems || 0) - gemsAmount);
  const newCashable = (balance.cashable_gems || 0) + gemsAmount;

  const { error: updateError } = await supabase
    .from('gem_balances')
    .update({
      pending_referral_gems: newPending,
      cashable_gems: newCashable,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', referrerUserId);

  if (updateError) {
    console.error('Error updating balance:', updateError);
    return { success: false };
  }

  // Mark referral as vested
  await supabase
    .from('referrals')
    .update({
      vested: true,
      vested_at: new Date().toISOString(),
      vested_reason: reason,
    })
    .eq('id', referralId);

  // Log transaction
  await supabase
    .from('gem_transactions')
    .insert({
      user_id: referrerUserId,
      transaction_type: 'vest',
      amount: gemsAmount,
      wallet_type: 'cashable',
      description: `Referral gems vested: ${reason}`,
    });

  console.log(`✅ Vested ${gemsAmount} gems for user ${referrerUserId}`);
  return { success: true, gemsVested: gemsAmount };
}
